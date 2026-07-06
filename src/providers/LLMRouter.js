export class LLMRouter {
  constructor(kernel) {
    this.kernel = kernel;
    this.providers = ['openai', 'anthropic', 'ollama', '9router'];
  }

  get stateManager() {
    return this.kernel.getService('stateManager');
  }

  async getProviderConfig() {
    const provider = await this.stateManager.getConfig('llm_provider', 'openai');
    const apiKey = await this.stateManager.getConfig('llm_api_key', '');
    let baseURL = await this.stateManager.getConfig('llm_base_url', '');
    const model = await this.stateManager.getConfig('llm_model', 'gpt-4o');
    
    // Override untuk 9Router (Local Proxy)
    if (provider === '9router') {
      baseURL = 'http://localhost:20128/v1';
    }

    return { provider, apiKey, baseURL, model };
  }

  getEffortSettings(effort) {
    if (effort === 'High') {
      return { maxIterations: 15, enableSelfReflection: true };
    }
    return { maxIterations: 5, enableSelfReflection: false };
  }

  getModeSettings(mode) {
    switch (mode) {
      case 'Precise': return { temperature: 0.1, topP: 0.9 };
      case 'Creative': return { temperature: 0.8, topP: 0.95 };
      case 'Balanced':
      default: return { temperature: 0.4, topP: 0.9 };
    }
  }

  async routePrompt(prompt, options = {}) {
    return this.executeRequest({
      messages: [{ role: 'user', content: prompt }],
      ...options
    });
  }

  async executeRequest(options) {
    const config = await this.getProviderConfig();
    const effort = options.effort || 'Balanced';
    const mode = options.mode || 'Balanced';
    
    const effortSettings = this.getEffortSettings(effort);
    const modeSettings = this.getModeSettings(mode);
    
    const routingOptions = {
      ...config,
      ...effortSettings,
      ...modeSettings,
      messages: options.messages,
      tools: options.tools,
      onProgress: options.onProgress
    };

    const { provider, apiKey, baseURL, model, messages, tools, temperature, onProgress } = routingOptions;

    if (provider === '9router' || provider === 'openai') {
      const endpoint = baseURL || (provider === 'openai' ? 'https://api.openai.com/v1' : '');
      return this._fetchOpenAICompatible(endpoint, apiKey, model, messages, tools, temperature, onProgress);
    } else if (provider === 'anthropic') {
      throw new Error('Anthropic implementation pending');
    } else if (provider === 'ollama') {
      throw new Error('Ollama implementation pending');
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  async _fetchOpenAICompatible(endpoint, apiKey, model, messages, tools, temperature, onProgress) {
    const url = `${endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint}/chat/completions`;
    
    const bodyPayload = {
      model,
      messages,
      temperature,
      stream: true // WAJIB STREAMING
    };

    if (tools && tools.length > 0) {
      bodyPayload.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.parameters || { type: 'object', properties: {} }
        }
      }));
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(bodyPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
    }

    return this._parseSSEStream(response, onProgress);
  }

  async _parseSSEStream(response, onProgress) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;
    let fullText = '';
    const toolCallsMap = new Map();

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split(/\r?\n/);
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
            const dataStr = trimmedLine.slice(6).trim();
            if (!dataStr) continue;
            
            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices[0]?.delta;
              
              if (!delta) continue;

              if (delta.content) {
                fullText += delta.content;
                if (onProgress) {
                  onProgress({ type: 'stream', chunk: delta.content });
                }
              }

              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index;
                  if (!toolCallsMap.has(idx)) {
                    toolCallsMap.set(idx, {
                      id: tc.id,
                      type: 'function',
                      function: { name: tc.function.name, arguments: tc.function.arguments || '' }
                    });
                  } else {
                    const existing = toolCallsMap.get(idx);
                    if (tc.function?.arguments) {
                      existing.function.arguments += tc.function.arguments;
                    }
                  }
                }
              }
            } catch (err) {
              console.error('Error parsing stream chunk', err);
            }
          }
        }
      }
    }

    const toolCalls = Array.from(toolCallsMap.values()).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      input: tc.function.arguments
    }));

    const assistantMessage = {
      role: 'assistant',
      content: fullText,
      ...(toolCalls.length > 0 ? { tool_calls: Array.from(toolCallsMap.values()) } : {})
    };

    return {
      textOutput: fullText,
      toolCalls,
      assistantMessage
    };
  }
}
