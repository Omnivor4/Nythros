// tests/helpers.js
// Shared test helpers for desktop-chain.test.js and provider-error.test.js
// Jalanin bareng: di-import oleh test file, nggak standalone

import http from 'node:http';

// ── Mock Server Setup ────────────────────────────────────────

export function createMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve(server));
  });
}

export function sendSSEChunk(res, data) {
  res.write('data: ' + JSON.stringify(data) + '\n\n');
}

export function sendSSEResponse(res, content, usage) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // Role announcement
  sendSSEChunk(res, {
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  });

  // Content
  sendSSEChunk(res, {
    choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }],
  });

  // Usage
  const u = usage || { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  sendSSEChunk(res, { usage: u });

  // Done
  res.write('data: [DONE]\n\n');
  res.end();
}

export function sendSSEToolCall(res, toolCalls, usage) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // Role announcement
  sendSSEChunk(res, {
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  });

  // Tool calls — send each as a separate delta chunk
  toolCalls.forEach((tc, idx) => {
    sendSSEChunk(res, {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: idx,
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.input) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
  });

  // Finish with tool_calls reason
  sendSSEChunk(res, {
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  });

  // Usage
  const u = usage || { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 };
  sendSSEChunk(res, { usage: u });

  res.write('data: [DONE]\n\n');
  res.end();
}

export function sendModelsResponse(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: [{ id: 'gpt-4o', object: 'model' }] }));
}

/** Send a JSON HTTP error response (500, 502, etc). */
export function sendHttpErrorResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      error: { message: body, type: 'server_error', code: status },
    }),
  );
}

// ── Fetch Mocks ──────────────────────────────────────────────

/** Mock globalThis.fetch to throw a specific error. Returns cleanup. */
export function mockFetch(error) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw error;
  };
  return () => {
    globalThis.fetch = original;
  };
}

/** Mock fetch returning HTTP 200 with invalid JSON body. Returns cleanup. */
export function mockJsonResponse(invalidBody) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => JSON.parse(invalidBody),
    text: async () => invalidBody,
  });
  return () => {
    globalThis.fetch = original;
  };
}

/** Mock fetch returning an HTTP error. Returns cleanup. */
export function mockHttpError(status, body) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status,
    headers: new Map([['content-type', 'application/json']]),
    text: async () => body,
  });
  return () => {
    globalThis.fetch = original;
  };
}

// ── Test Runner ──────────────────────────────────────────────

export async function runWithServer(handler, testFn) {
  const server = await createMockServer(handler);
  const port = server.address().port;
  const baseURL = `http://localhost:${port}`;
  try {
    await testFn(baseURL);
  } finally {
    await new Promise((r) => setTimeout(r, 100));
    server.close();
  }
}

// ── Config ───────────────────────────────────────────────────

export function makeConfig(baseURL) {
  return {
    endpoints: [
      {
        id: 'test',
        name: 'Test',
        base_url: baseURL,
        api_key: 'sk-test',
        model: 'gpt-4o',
        supports_vision: true,
        supports_tools: true,
        priority: 1,
      },
    ],
    routing: { default_model: 'test' },
  };
}
