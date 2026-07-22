// Provider generic buat endpoint apa pun yang ngomong format OpenAI
// chat/completions + tool calling. Ini yang bikin Nythros bisa nyambung ke
// OpenRouter, 9router, gateway lokal (LiteLLM), atau Ollama — cukup ganti
// baseURL di config, nggak perlu nulis adapter baru.

function toOpenAITools(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

export class OpenAICompatibleProvider {
  constructor({ apiKey, model, baseURL }) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseURL = baseURL.replace(/\/$/, '');
  }

  async verify() {
    try {
      const res = await fetch(`${this.baseURL}/models`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
        },
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`HTTP ${res.status}: ${errBody}`);
      }
    } catch (err) {
      throw new Error(`Koneksi ke endpoint gagal: ${err.message}`, { cause: err });
    }
  }

  async send({ system, messages, tools, onProgress, effort = 'Medium' }) {
    const fullMessages = [{ role: 'system', content: system }, ...messages];
    const useStream = typeof onProgress === 'function';

    const body = {
      model: this.model,
      messages: fullMessages,
      stream: useStream,
    };
    if (useStream) {
      body.stream_options = { include_usage: true };
    }

    if (effort === 'Low') {
      body.max_tokens = 1024;
    } else if (effort === 'Medium') {
      body.max_tokens = 4096;
    } else if (effort === 'High') {
      body.max_tokens = 16384;
    }

    // Only attach tools if we actually have some — some endpoints
    // reject an empty tools array or tool_choice without tools.
    if (tools && tools.length > 0) {
      body.tools = toOpenAITools(tools);
      body.tool_choice = 'auto';
    }

    // Timeout API calls (120s for streaming)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    let res;
    try {
      res = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error('API call timed out after 60 detik.', { cause: e });
      }
      if (e.name === 'TypeError' && e.message.includes('fetch')) {
        throw new Error(
          'Network error: Tidak bisa menyambung ke AI Gateway. Cek koneksi atau URL.',
          { cause: e },
        );
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      // Bug 45: Generic 401 Error
      if (res.status === 401) {
        throw new Error(`❌ API Key Anda Salah / Expired! (HTTP 401)`);
      }
      const errBody = await res.text();
      const err = new Error(`Gateway error ${res.status}: ${errBody}`);
      err.status = res.status;
      throw err;
    }

    if (useStream) {
      try {
        return await this._handleStream(res, onProgress);
      } catch (streamErr) {
        throw new Error(
          `Streaming failed: ${streamErr.message}. Coba set stream: false di config.`,
          { cause: streamErr },
        );
      }
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('API returned empty choices array');
    }
    const msg = choice.message;

    const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments || '{}'),
    }));

    // Feature 5 & Bug 12: Extract token usage
    const usage = data.usage || null;

    return {
      // dipush balik mentah-mentah ke `messages` di giliran berikutnya
      assistantMessage: { role: 'assistant', content: msg.content, tool_calls: msg.tool_calls },
      toolCalls,
      // Bug 44: Dead Code Streaming (Removed SSE parser chunks entirely, simplified since stream: false)
      textOutput: toolCalls.length === 0 ? (msg.content ?? '') : null,
      usage,
    };
  }

  buildToolResultMessage(toolCall, outputString) {
    return {
      role: 'tool',
      tool_call_id: toolCall.id,
      content: outputString,
    };
  }

  async _handleStream(res, onProgress) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let toolCallsAccumulator = {};
    let usage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        if (chunk.usage) {
          usage = chunk.usage;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          fullContent += delta.content;
          onProgress({ type: 'stream', chunk: delta.content, isSystem: false });
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallsAccumulator[idx]) {
              toolCallsAccumulator[idx] = {
                id: tc.id || '',
                name: tc.function?.name || '',
                arguments_str: '',
              };
            }
            if (tc.id) toolCallsAccumulator[idx].id = tc.id;
            if (tc.function?.name) toolCallsAccumulator[idx].name = tc.function.name;
            if (tc.function?.arguments)
              toolCallsAccumulator[idx].arguments_str += tc.function.arguments;
          }
        }
      }
    }

    const toolCalls = Object.values(toolCallsAccumulator)
      .filter((tc) => tc.name)
      .map((tc) => ({
        id: tc.id,
        name: tc.name,
        input: (() => {
          try {
            return JSON.parse(tc.arguments_str || '{}');
          } catch {
            return {};
          }
        })(),
      }));

    const rawToolCalls =
      toolCalls.length > 0
        ? toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          }))
        : undefined;

    return {
      assistantMessage: {
        role: 'assistant',
        content: fullContent || null,
        tool_calls: rawToolCalls,
      },
      toolCalls,
      textOutput: toolCalls.length === 0 ? fullContent : null,
      usage: usage,
    };
  }
}
