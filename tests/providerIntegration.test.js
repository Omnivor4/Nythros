// tests/providerIntegration.test.js
// Integration test untuk OpenAICompatibleProvider — pake mock HTTP server lokal
// Jalanin: node tests/providerIntegration.test.js
//
// Test tanpa koneksi API beneran — semua response di-mock lewat localhost.

import assert from 'node:assert/strict';
import http from 'node:http';
import { OpenAICompatibleProvider } from '../src/providers/openaiCompatible.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

// === Mock HTTP Server ===
function createMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve(server));
  });
}

async function withServer(handler, testFn) {
  const server = await createMockServer(handler);
  const port = server.address().port;
  const baseURL = `http://localhost:${port}`;
  try {
    await testFn(baseURL, server);
  } finally {
    server.close();
  }
}

console.log('\n🧪 Provider Integration Tests (Mock HTTP Server)\n');

// ============================================================
// NON-STREAMING TESTS
// ============================================================

testAsync('non-streaming: simple text response', async () => {
  await withServer((req, res) => {
    if (req.url === '/chat/completions' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'cmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4o',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hello from mock!' },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }));
    } else if (req.url === '/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] }));
    }
  }, async (baseURL) => {
    const provider = new OpenAICompatibleProvider({ apiKey: 'sk-test', model: 'gpt-4o', baseURL });
    const result = await provider.send({
      system: 'You are a test bot.',
      messages: [{ role: 'user', content: 'Hi' }]
    });

    assert.equal(result.textOutput, 'Hello from mock!');
    assert.equal(result.toolCalls.length, 0);
    assert.ok(result.assistantMessage, 'Should have assistant message');
    assert.equal(result.usage.prompt_tokens, 10);
    assert.equal(result.usage.total_tokens, 15);
  });
});

testAsync('non-streaming: tool call response', async () => {
  await withServer((req, res) => {
    if (req.url === '/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'cmpl-tc',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_abc',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"test.txt"}' }
            }]
          },
          finish_reason: 'tool_calls'
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
      }));
    }
  }, async (baseURL) => {
    const provider = new OpenAICompatibleProvider({ apiKey: 'sk-test', model: 'gpt-4o', baseURL });
    const result = await provider.send({
      system: '',
      messages: [{ role: 'user', content: 'read file' }],
      tools: [{ name: 'read_file', description: 'Read file', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }]
    });

    assert.equal(result.textOutput, null, 'textOutput null when tool calls');
    assert.equal(result.toolCalls.length, 1, 'Should have 1 tool call');
    assert.equal(result.toolCalls[0].name, 'read_file');
    assert.equal(result.toolCalls[0].input.path, 'test.txt');
    assert.equal(result.usage.total_tokens, 30);
  });
});

// ============================================================
// STREAMING TESTS
// ============================================================

testAsync('streaming: accumulates text chunks', async () => {
  await withServer((req, res) => {
    if (req.url === '/chat/completions') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const chunks = [
        'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":" World"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":"!"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      req.on('data', () => {
        // Client sudah konek — kirim chunks sekarang (TCP buffer handle sisanya)
        for (const chunk of chunks) res.write(chunk);
        res.end();
      });
    }
  }, async (baseURL) => {
    const provider = new OpenAICompatibleProvider({ apiKey: 'sk-test', model: 'gpt-4o', baseURL });

    let accumulatedText = '';
    const result = await provider.send({
      system: '',
      messages: [{ role: 'user', content: 'hi' }],
      onProgress: (evt) => {
        if (evt.type === 'stream') accumulatedText += evt.chunk;
      }
    });

    assert.equal(accumulatedText, 'Hello World!', 'Streaming chunks should accumulate');
    assert.equal(result.textOutput, 'Hello World!', 'textOutput should have full content');
  });
});

testAsync('streaming: tool calls accumulate from delta chunks', async () => {
  await withServer((req, res) => {
    if (req.url === '/chat/completions') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });

      // Tunggu sampai seluruh body request diterima baru kirim response
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        res.write('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":""}}]},"finish_reason":null}]}\n\n');
        res.write('data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]},"finish_reason":null}]}\n\n');
        res.write('data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"test.txt\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      });
    }
  }, async (baseURL) => {
    const provider = new OpenAICompatibleProvider({ apiKey: 'sk-test', model: 'gpt-4o', baseURL });

    const result = await provider.send({
      system: '',
      messages: [{ role: 'user', content: 'read file' }],
      onProgress: () => {}
    });

    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].name, 'read_file');
    assert.equal(result.toolCalls[0].input.path, 'test.txt');
    assert.equal(result.textOutput, null, 'No text output when streaming tool calls');
  });
});

// ============================================================
// ERROR HANDLING TESTS
// ============================================================

testAsync('HTTP 401 throws specific "API Key Salah" message', async () => {
  await withServer((req, res) => {
    if (req.url === '/chat/completions') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid authentication', code: 'invalid_api_key' } }));
    }
  }, async (baseURL) => {
    const provider = new OpenAICompatibleProvider({ apiKey: 'sk-wrong', model: 'gpt-4o', baseURL });

    try {
      await provider.send({ system: '', messages: [] });
      assert.fail('Should have thrown on 401');
    } catch (e) {
      assert.ok(e.message.includes('401'), 'Should mention 401');
      assert.ok(e.message.includes('API Key'), 'Should mention API Key');
    }
  });
});

testAsync('HTTP 429 has .status property for retry', async () => {
  await withServer((req, res) => {
    if (req.url === '/chat/completions') {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Rate limit exceeded' } }));
    }
  }, async (baseURL) => {
    const provider = new OpenAICompatibleProvider({ apiKey: 'sk-test', model: 'gpt-4o', baseURL });

    try {
      await provider.send({ system: '', messages: [] });
      assert.fail('Should have thrown on 429');
    } catch (e) {
      assert.equal(e.status, 429, 'Error should have .status = 429');
    }
  });
});

testAsync('HTTP 500 has .status property', async () => {
  await withServer((req, res) => {
    if (req.url === '/chat/completions') {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }, async (baseURL) => {
    const provider = new OpenAICompatibleProvider({ apiKey: 'sk-test', model: 'gpt-4o', baseURL });

    try {
      await provider.send({ system: '', messages: [] });
      assert.fail('Should have thrown on 500');
    } catch (e) {
      assert.equal(e.status, 500, 'Error should have .status = 500');
    }
  });
});

// ============================================================
// VERIFY ENDPOINT TESTS
// ============================================================

testAsync('verify() succeeds when /models returns 200', async () => {
  await withServer((req, res) => {
    if (req.url === '/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] }));
    }
  }, async (baseURL) => {
    const provider = new OpenAICompatibleProvider({ apiKey: 'sk-test', model: 'gpt-4o', baseURL });
    await provider.verify();
  });
});

testAsync('verify() throws when /models fails', async () => {
  await withServer((req, res) => {
    if (req.url === '/models') {
      res.writeHead(403);
      res.end('Forbidden');
    }
  }, async (baseURL) => {
    const provider = new OpenAICompatibleProvider({ apiKey: 'sk-test', model: 'gpt-4o', baseURL });

    try {
      await provider.verify();
      assert.fail('Should have thrown on 403');
    } catch (e) {
      assert.ok(e.message.includes('gagal'), 'Should say connection failed');
    }
  });
});

// ============================================================
// BUILD TOOL RESULT MESSAGE (standalone — no server needed)
// ============================================================

test('buildToolResultMessage returns correct format', () => {
  const provider = new OpenAICompatibleProvider({ apiKey: 'sk-test', model: 'gpt-4o', baseURL: 'http://localhost:1' });
  const result = provider.buildToolResultMessage({ id: 'call_xyz' }, 'output content');
  assert.equal(result.role, 'tool');
  assert.equal(result.tool_call_id, 'call_xyz');
  assert.equal(result.content, 'output content');
});

// ============================================================
// SUMMARY
// ============================================================

console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
