// tests/agent-desktop.integration.test.js
// Integration test: mock LLM + mock PowerShell, verify desktop tools in agent loop
// Jalanin: node tests/agent-desktop.integration.test.js
//
// CATATAN:
// - Mock HTTP server simulate OpenAI-compatible chat/completions API
// - Desktop tools PowerShell di-mock via _setPSMock (tidak panggil PowerShell beneran)
// - Aman dijalankan di Windows maupun non-Windows

import assert from 'node:assert/strict';
import process from 'node:process';

import {
  runWithServer,
  sendSSEToolCall,
  sendModelsResponse,
  sendHttpErrorResponse,
  mockFetch,
  mockJsonResponse,
  mockHttpError,
  makeConfig,
} from './helpers.js';

let passed = 0;
let failed = 0;

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

console.log('\n🧪 Agent Integration — Desktop Tools Tests\n');

// ── Import sekaligus ───────────────────────────────────────────
const { Agent } = await import('../src/agent/Agent.js');
const desktop = await import('../src/tooling/desktopTools.js');
const { recordSuccess } = await import('../src/infrastructure/state/errorWatchdog.js');

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════
// ── 17. HTTP 500 mid-chain ───────────────────────────────────
await testAsync('Agent throws gateway error when LLM returns HTTP 500 mid-chain', async () => {
  recordSuccess(); // Reset circuit breaker before this error test
  let requestCount = 0;
  desktop._setPSMock(() => {
    return JSON.stringify({ pid: 8888, process: 'notepad', success: true });
  });

  try {
    let caughtError = null;

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            requestCount++;
            if (requestCount === 1) {
              // First request succeeds: send tool_call
              sendSSEToolCall(res, [
                { id: 'call_500_1', name: 'launch_app', input: { target: 'notepad.exe' } },
              ]);
            } else {
              // Second request: HTTP 500 — model overloaded / server error
              sendHttpErrorResponse(res, 500, 'Model is overloaded. Please try again later.');
            }
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        try {
          await agent.process('Buka notepad lalu lanjut', {
            effort: 'Low',
            mode: 'general',
            onProgress: () => {},
          });
          assert.fail('Harus throw error karena HTTP 500 di tengah chain');
        } catch (err) {
          caughtError = err;
        }
      },
    );

    assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
    if (caughtError) {
      const msg =
        typeof caughtError === 'string' ? caughtError : caughtError.message || String(caughtError);
      assert.ok(msg.includes('500'), `Error harus mention HTTP 500: ${msg.slice(0, 200)}`);
      assert.ok(
        msg.includes('Gateway error') || msg.includes('overloaded') || msg.includes('server'),
        `Error harus mention gateway: ${msg.slice(0, 200)}`,
      );
    }
  } finally {
    desktop._clearPSMock();
  }
});

// ── 18. HTTP 502 mid-chain with error body ────────────────────
await testAsync(
  'Agent throws gateway error when LLM returns HTTP 502 mid-chain with error body',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    let requestCount = 0;
    desktop._setPSMock(() => {
      return JSON.stringify({ pid: 9999, process: 'notepad', success: true });
    });

    try {
      let caughtError = null;

      await runWithServer(
        (req, res) => {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            if (req.url === '/chat/completions' && req.method === 'POST') {
              requestCount++;
              if (requestCount === 1) {
                // First request succeeds: send tool_call
                sendSSEToolCall(res, [
                  { id: 'call_502_1', name: 'launch_app', input: { target: 'notepad.exe' } },
                ]);
              } else {
                // Second request: HTTP 502 — Bad Gateway (upstream failure)
                sendHttpErrorResponse(
                  res,
                  502,
                  'Upstream model provider returned an error: rate limit exceeded',
                );
              }
            } else if (req.url === '/models') {
              sendModelsResponse(res);
            }
          });
        },
        async (baseURL) => {
          const agent = new Agent(makeConfig(baseURL));
          try {
            await agent.process('Buka notepad lalu lanjut', {
              effort: 'Low',
              mode: 'general',
              onProgress: () => {},
            });
            assert.fail('Harus throw error karena HTTP 502 di tengah chain');
          } catch (err) {
            caughtError = err;
          }
        },
      );

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
      if (caughtError) {
        const msg =
          typeof caughtError === 'string'
            ? caughtError
            : caughtError.message || String(caughtError);
        assert.ok(msg.includes('502'), `Error harus mention HTTP 502: ${msg.slice(0, 200)}`);
        // The provider reads the error body and includes it in the message
        assert.ok(
          msg.includes('Gateway error'),
          `Error harus format 'Gateway error 502: ...': ${msg.slice(0, 200)}`,
        );
        // The error body from the mock server
        assert.ok(
          msg.includes('rate limit') || msg.includes('upstream') || msg.includes('Upstream'),
          `Error harus mention penyebab dari body: ${msg.slice(0, 200)}`,
        );
      }
    } finally {
      desktop._clearPSMock();
    }
  },
);

// ── 19. HTTP error on FIRST request ───────────────────────────
await testAsync(
  'Agent throws error when FIRST LLM request returns HTTP 500 (no tool calls yet)',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    let caughtError = null;
    let chatCompletionsCalled = false;

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            chatCompletionsCalled = true;
            // First (and only) request: HTTP 500 — server error on initial call
            sendHttpErrorResponse(res, 500, 'Internal server error: inference engine crashed');
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        try {
          await agent.process('Tulis cerita pendek', {
            effort: 'Low',
            mode: 'general',
            onProgress: () => {},
          });
          assert.fail('Harus throw error karena HTTP 500 di request pertama');
        } catch (err) {
          caughtError = err;
        }
      },
    );

    assert.ok(chatCompletionsCalled, 'Server harus menerima request /chat/completions');
    assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');

    if (caughtError) {
      const msg =
        typeof caughtError === 'string' ? caughtError : caughtError.message || String(caughtError);
      assert.ok(msg.includes('500'), `Error harus mention HTTP 500: ${msg.slice(0, 200)}`);
      assert.ok(
        msg.includes('Gateway error') || msg.includes('server error'),
        `Error harus tentang gateway: ${msg.slice(0, 200)}`,
      );

      // Should NOT be circuit breaker or max iterations
      assert.ok(
        !msg.includes('Circuit Breaker'),
        'Error BUKAN circuit breaker — harus langsung dari provider',
      );
      assert.ok(
        !msg.includes('Max iterations'),
        'Error BUKAN max iterations — harus langsung dari provider',
      );
    }
  },
);

// ── 20. AbortController timeout in provider.send() ────────────
await testAsync(
  'Provider throws timeout error when fetch is aborted (AbortController)',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const cleanup = mockFetch(abortError);

    let caughtError = null;
    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'sk-test',
        model: 'gpt-4o',
        baseURL: 'http://localhost:19999',
      });

      try {
        await provider.send({
          system: 'test',
          messages: [{ role: 'user', content: 'halo' }],
          onProgress: () => {},
        });
        assert.fail('Harus throw timeout error karena fetch di-abort');
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
      if (caughtError) {
        const msg = caughtError.message || String(caughtError);
        assert.ok(
          msg.includes('timed out') || msg.includes('60 detik'),
          `Error harus tentang timeout: ${msg}`,
        );
        assert.ok(
          !msg.includes('Network error'),
          'Error BUKAN network error — harus spesifik timeout',
        );
        assert.ok(
          !msg.includes('Gateway error'),
          'Error BUKAN gateway error — harus spesifik timeout',
        );
      }
    } finally {
      cleanup();
    }
  },
);

// ── 21. AbortError via Agent.process() — propagates through agent loop ─
await testAsync(
  'Agent.process() propagates AbortError timeout from provider to caller',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const cleanup = mockFetch(abortError);

    let caughtError = null;
    try {
      const agent = new Agent({
        endpoints: [
          {
            id: 'test',
            name: 'Test',
            base_url: 'http://localhost:19999',
            api_key: 'sk-test',
            model: 'gpt-4o',
            supports_vision: true,
            supports_tools: true,
            priority: 1,
          },
        ],
        routing: { default_model: 'test' },
      });

      try {
        await agent.process('Tulis sesuatu', {
          effort: 'Low',
          mode: 'general',
          onProgress: () => {},
        });
        assert.fail('Harus throw error karena fetch timeout');
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
      if (caughtError) {
        const msg = caughtError.message || String(caughtError);
        assert.ok(
          msg.includes('timed out') || msg.includes('60 detik'),
          `Error harus tentang timeout: ${msg}`,
        );
      }
    } finally {
      cleanup();
    }
  },
);

// ── 22. TypeError 'fetch failed' in provider.send() — Network error ──
await testAsync(
  'Provider throws Network error when fetch fails with TypeError (fetch failed)',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

    const typeError = new TypeError('fetch failed');
    const cleanup = mockFetch(typeError);

    let caughtError = null;
    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'sk-test',
        model: 'gpt-4o',
        baseURL: 'http://localhost:19999',
      });

      try {
        await provider.send({
          system: 'test',
          messages: [{ role: 'user', content: 'halo' }],
          onProgress: () => {},
        });
        assert.fail('Harus throw Network error karena fetch gagal (TypeError)');
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
      if (caughtError) {
        const msg = caughtError.message || String(caughtError);
        assert.ok(msg.includes('Network error'), `Error harus Network error: ${msg}`);
        assert.ok(
          msg.includes('Tidak bisa menyambung') || msg.includes('koneksi') || msg.includes('URL'),
          `Error harus tentang koneksi: ${msg}`,
        );

        // Pastikan BUKAN timeout atau gateway error
        assert.ok(!msg.includes('timed out'), 'Error BUKAN timeout — harus spesifik network error');
        assert.ok(
          !msg.includes('Gateway error'),
          'Error BUKAN gateway error — harus spesifik network error',
        );
      }
    } finally {
      cleanup();
    }
  },
);

// ── 23. TypeError 'fetch failed' via Agent.process() ──────────
await testAsync(
  'Agent.process() propagates TypeError fetch failed as Network error to caller',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test

    const typeError = new TypeError('fetch failed');
    const cleanup = mockFetch(typeError);

    let caughtError = null;
    try {
      const agent = new Agent({
        endpoints: [
          {
            id: 'test',
            name: 'Test',
            base_url: 'http://localhost:19999',
            api_key: 'sk-test',
            model: 'gpt-4o',
            supports_vision: true,
            supports_tools: true,
            priority: 1,
          },
        ],
        routing: { default_model: 'test' },
      });

      try {
        await agent.process('Tulis sesuatu', {
          effort: 'Low',
          mode: 'general',
          onProgress: () => {},
        });
        assert.fail('Harus throw Network error karena fetch gagal lewat agent');
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap dari agent.process()');
      if (caughtError) {
        const msg = caughtError.message || String(caughtError);
        assert.ok(
          msg.includes('Network error'),
          `Error harus Network error setelah propagasi: ${msg}`,
        );
        assert.ok(
          msg.includes('Tidak bisa menyambung') ||
            msg.includes('koneksi') ||
            msg.includes('URL') ||
            msg.includes('Gateway'),
          `Error harus tentang koneksi/gateway: ${msg}`,
        );

        // Pastikan BUKAN timeout
        assert.ok(
          !msg.includes('timed out'),
          'Error BUKAN timeout — harus Network error dari provider',
        );
      }
    } finally {
      cleanup();
    }
  },
);

// ── 24. AbortError without onProgress (stream: false) ─────────
await testAsync(
  'Provider throws timeout error even without onProgress (stream: false path)',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const cleanup = mockFetch(abortError);

    let caughtError = null;
    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'sk-test',
        model: 'gpt-4o',
        baseURL: 'http://localhost:19999',
      });

      // KIRIM TANPA onProgress → body.stream = false, lewat path res.json(),
      // TAPI AbortController tetap aktif di kedua path (stream:true/false).
      // AbortError di-throw sebelum fetch selesai, jadi stream vs non-stream
      // sama-sama kena catch block yang sama: 'API call timed out after 60 detik.'
      try {
        await provider.send({
          system: 'test',
          messages: [{ role: 'user', content: 'halo' }],
          // onProgress TIDAK dikirim — stream: false path
        });
        assert.fail('Harus throw timeout error meskipun tanpa onProgress');
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
      if (caughtError) {
        const msg = caughtError.message || String(caughtError);
        assert.ok(
          msg.includes('timed out') || msg.includes('60 detik'),
          `Error harus tentang timeout: ${msg}`,
        );
        // Pastikan BUKAN network error — harus persis dari catch AbortError
        assert.ok(
          !msg.includes('Network error'),
          'Error BUKAN network error — harus spesifik timeout dari AbortController',
        );
        assert.ok(
          !msg.includes('Gateway error'),
          'Error BUKAN gateway error — harus spesifik timeout',
        );
      }
    } finally {
      cleanup();
    }
  },
);

// ── 25. HTTP 503 mid-chain (Service Unavailable) ──────────────
await testAsync(
  'Agent throws gateway error when LLM returns HTTP 503 (Service Unavailable) mid-chain',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    let requestCount = 0;
    desktop._setPSMock(() => {
      return JSON.stringify({ pid: 8888, process: 'notepad', success: true });
    });

    try {
      let caughtError = null;

      await runWithServer(
        (req, res) => {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            if (req.url === '/chat/completions' && req.method === 'POST') {
              requestCount++;
              if (requestCount === 1) {
                // First request succeeds: send tool_call
                sendSSEToolCall(res, [
                  { id: 'call_503_1', name: 'launch_app', input: { target: 'notepad.exe' } },
                ]);
              } else {
                // Second request: HTTP 503 — Service Unavailable (model overloaded)
                sendHttpErrorResponse(
                  res,
                  503,
                  'Model is overloaded. Please try again later. Upstream rate limited.',
                );
              }
            } else if (req.url === '/models') {
              sendModelsResponse(res);
            }
          });
        },
        async (baseURL) => {
          const agent = new Agent(makeConfig(baseURL));
          try {
            await agent.process('Buka notepad lalu lanjut', {
              effort: 'Low',
              mode: 'general',
              onProgress: () => {},
            });
            assert.fail('Harus throw error karena HTTP 503 di tengah chain');
          } catch (err) {
            caughtError = err;
          }
        },
      );

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
      if (caughtError) {
        const msg =
          typeof caughtError === 'string'
            ? caughtError
            : caughtError.message || String(caughtError);
        // Status code harus ada
        assert.ok(msg.includes('503'), `Error harus mention HTTP 503: ${msg.slice(0, 200)}`);
        // Format gateway error
        assert.ok(
          msg.includes('Gateway error'),
          `Error harus format 'Gateway error 503: ...': ${msg.slice(0, 200)}`,
        );
        // Error body dari mock server
        assert.ok(
          msg.includes('overloaded') || msg.includes('rate limited'),
          `Error harus mention penyebab dari body: ${msg.slice(0, 200)}`,
        );
      }
    } finally {
      desktop._clearPSMock();
    }
  },
);

// ── 26. HTTP 503 on FIRST request ─────────────────────────────
await testAsync(
  'Agent throws Gateway error when FIRST LLM request returns HTTP 503 (Service Unavailable)',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    let caughtError = null;
    let chatCompletionsCalled = false;

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            chatCompletionsCalled = true;
            // First (and only) request: HTTP 503 — Service Unavailable
            sendHttpErrorResponse(res, 503, 'Service Unavailable: model is temporarily overloaded');
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        try {
          await agent.process('Tulis cerita pendek', {
            effort: 'Low',
            mode: 'general',
            onProgress: () => {},
          });
          assert.fail('Harus throw error karena HTTP 503 di request pertama');
        } catch (err) {
          caughtError = err;
        }
      },
    );

    assert.ok(chatCompletionsCalled, 'Server harus menerima request /chat/completions');
    assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');

    if (caughtError) {
      const msg =
        typeof caughtError === 'string' ? caughtError : caughtError.message || String(caughtError);
      assert.ok(msg.includes('503'), `Error harus mention HTTP 503: ${msg.slice(0, 200)}`);
      assert.ok(
        msg.includes('Gateway error'),
        `Error harus format 'Gateway error 503: ...': ${msg.slice(0, 200)}`,
      );

      // Should NOT be circuit breaker or max iterations
      assert.ok(
        !msg.includes('Circuit Breaker'),
        'Error BUKAN circuit breaker — harus langsung dari provider',
      );
      assert.ok(
        !msg.includes('Max iterations'),
        'Error BUKAN max iterations — harus langsung dari provider',
      );
    }
  },
);

// ── 27. Invalid JSON response (stream: false path — res.json() throws) ──
await testAsync(
  'Provider throws JSON parse error when server returns invalid JSON (stream: false path)',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

    // Mock fetch to return HTTP 200 with invalid JSON body
    // This triggers the non-streaming path: res.ok → res.json() throws SyntaxError
    const cleanup = mockJsonResponse('{invalid');

    let caughtError = null;
    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'sk-test',
        model: 'gpt-4o',
        baseURL: 'http://localhost:19999',
      });

      // KIRIM TANPA onProgress → body.stream = false → lewat res.json() path
      try {
        await provider.send({
          system: 'test',
          messages: [{ role: 'user', content: 'halo' }],
          // onProgress TIDAK dikirim — stream: false, pakai res.json()
        });
        assert.fail('Harus throw error karena response JSON tidak valid');
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
      if (caughtError) {
        const msg = caughtError.message || String(caughtError);
        // res.json() throws SyntaxError dari real JSON.parse — message tergantung
        // Node.js version: 'Unexpected token ...' atau 'Expected ... in JSON at position 0'
        assert.ok(
          msg.includes('JSON') ||
            msg.includes('token') ||
            msg.includes('parse') ||
            msg.includes('not valid'),
          `Error harus tentang JSON parsing: ${msg.slice(0, 200)}`,
        );
        // Pastikan BUKAN network error, timeout, atau gateway error
        assert.ok(
          !msg.includes('Network error'),
          'Error BUKAN network error — harus dari res.json() failure',
        );
        assert.ok(
          !msg.includes('timed out'),
          'Error BUKAN timeout — harus dari res.json() failure',
        );
        assert.ok(
          !msg.includes('Gateway error'),
          'Error BUKAN gateway error — harus dari res.json() failure',
        );
      }
    } finally {
      cleanup();
    }
  },
);

// ── 28. Invalid JSON via Agent.process() — server returns 200 with malformed body ─
await testAsync(
  'Agent.process() propagates JSON parse error when server returns malformed body',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    let caughtError = null;
    let chatCompletionsCalled = false;

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            chatCompletionsCalled = true;
            // Return HTTP 200 dengan body INVALID JSON — bukan error HTTP,
            // tapi res.json() di provider bakal throw SyntaxError
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{invalid json body}');
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        try {
          await agent.process('Tulis cerita pendek', {
            effort: 'Low',
            mode: 'general',
            onProgress: () => {},
          });
          assert.fail('Harus throw error karena response JSON tidak valid');
        } catch (err) {
          caughtError = err;
        }
      },
    );

    assert.ok(chatCompletionsCalled, 'Server harus menerima request /chat/completions');
    assert.ok(caughtError !== null, 'Harus ada error yang ditangkap dari agent.process()');

    if (caughtError) {
      const msg =
        typeof caughtError === 'string' ? caughtError : caughtError.message || String(caughtError);
      // Error harus tentang JSON parsing — dari res.json() yang gagal
      assert.ok(
        msg.includes('JSON') ||
          msg.includes('token') ||
          msg.includes('parse') ||
          msg.includes('not valid'),
        `Error harus tentang JSON parsing: ${msg.slice(0, 200)}`,
      );
      // Pastikan BUKAN circuit breaker atau max iterations
      assert.ok(
        !msg.includes('Circuit Breaker'),
        'Error BUKAN circuit breaker — harus dari res.json() failure',
      );
      assert.ok(
        !msg.includes('Max iterations'),
        'Error BUKAN max iterations — harus dari res.json() failure',
      );
    }
  },
);

// ── 29. TypeError 'fetch failed' without onProgress (stream: false) ──
await testAsync(
  'Provider throws Network error on TypeError even without onProgress (stream: false path)',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

    const typeError = new TypeError('fetch failed');
    const cleanup = mockFetch(typeError);

    let caughtError = null;
    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'sk-test',
        model: 'gpt-4o',
        baseURL: 'http://localhost:19999',
      });

      // KIRIM TANPA onProgress → body.stream = false → lewat path res.json(),
      // TAPI catch TypeError tetap dijalankan SEBELUM fetch selesai — jadi
      // stream vs non-stream sama-sama kena: "Network error: ..."
      try {
        await provider.send({
          system: 'test',
          messages: [{ role: 'user', content: 'halo' }],
          // onProgress TIDAK dikirim — stream: false path
        });
        assert.fail('Harus throw Network error meskipun tanpa onProgress');
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
      if (caughtError) {
        const msg = caughtError.message || String(caughtError);
        assert.ok(msg.includes('Network error'), `Error harus Network error: ${msg}`);
        assert.ok(
          msg.includes('Tidak bisa menyambung') || msg.includes('koneksi') || msg.includes('URL'),
          `Error harus tentang koneksi: ${msg}`,
        );

        // Pastikan BUKAN timeout atau gateway error
        assert.ok(!msg.includes('timed out'), 'Error BUKAN timeout — harus spesifik network error');
        assert.ok(
          !msg.includes('Gateway error'),
          'Error BUKAN gateway error — harus spesifik network error',
        );
      }
    } finally {
      cleanup();
    }
  },
);

// ── 30. HTTP 502 via provider.send() with onProgress (stream: true path) ──
await testAsync(
  'Provider throws Gateway error on HTTP 502 even with onProgress (stream: true path)',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

    // Mock fetch to return HTTP 502 with JSON error body
    // This simulates upstream failure in the streaming path
    const errBody = JSON.stringify({
      error: {
        message: 'Upstream provider error: model temporarily unavailable',
        type: 'server_error',
        code: 502,
      },
    });
    const cleanup = mockHttpError(502, errBody);

    let caughtError = null;
    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'sk-test',
        model: 'gpt-4o',
        baseURL: 'http://localhost:19999',
      });

      // KIRIM DENGAN onProgress → body.stream = true → useStream = true,
      // TAPI HTTP error check (!res.ok) jalan SEBELUM percabangan stream.
      // Jadi Gateway error harus muncul sama persis seperti non-streaming.
      try {
        await provider.send({
          system: 'test',
          messages: [{ role: 'user', content: 'halo' }],
          onProgress: () => {}, // stream: true path
        });
        assert.fail('Harus throw Gateway error karena HTTP 502 meskipun streaming');
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
      if (caughtError) {
        const msg = caughtError.message || String(caughtError);
        assert.ok(msg.includes('502'), `Error harus mention HTTP 502: ${msg.slice(0, 200)}`);
        assert.ok(
          msg.includes('Gateway error'),
          `Error harus format 'Gateway error 502: ...': ${msg.slice(0, 200)}`,
        );
        // Error body dari mock server harus termuat
        assert.ok(
          msg.includes('unavailable') || msg.includes('Upstream'),
          `Error harus mention penyebab dari body: ${msg.slice(0, 200)}`,
        );
        // Pastikan BUKAN timeout atau network error — harus Gateway error spesifik
        assert.ok(
          !msg.includes('timed out'),
          'Error BUKAN timeout — harus Gateway error dari HTTP status',
        );
        assert.ok(
          !msg.includes('Network error'),
          'Error BUKAN Network error — harus Gateway error dari HTTP status',
        );
      }
    } finally {
      cleanup();
    }
  },
);

// ── 31. HTTP 401 (Unauthorized) — special error message ───────
await testAsync(
  'Provider throws special error message on HTTP 401 (API Key Salah/Expired)',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

    // Mock fetch to return HTTP 401 — special branch di provider
    // Provider punya if (res.status === 401) yang THROW SEBELUM Gateway error generic
    const cleanup = mockHttpError(
      401,
      JSON.stringify({
        error: { message: 'Invalid API key', type: 'auth_error', code: 401 },
      }),
    );

    let caughtError = null;
    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'sk-salah', // API key sengaja salah
        model: 'gpt-4o',
        baseURL: 'http://localhost:19999',
      });

      try {
        await provider.send({
          system: 'test',
          messages: [{ role: 'user', content: 'halo' }],
          onProgress: () => {}, // path tidak penting — 401 dicek SEBELUM streaming/non-streaming
        });
        assert.fail('Harus throw error API Key Salah karena HTTP 401');
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
      if (caughtError) {
        const msg = caughtError.message || String(caughtError);
        // Special 401 format: ❌ API Key Anda Salah / Expired! (HTTP 401)
        assert.ok(
          msg.includes('401') || msg.includes('API Key'),
          `Error harus mention 401 atau API Key: ${msg.slice(0, 200)}`,
        );
        assert.ok(
          msg.includes('Salah') || msg.includes('Expired') || msg.includes('❌'),
          `Error harus format 'API Key Anda Salah / Expired!': ${msg.slice(0, 200)}`,
        );
        // Pastikan BUKAN Gateway error generic — 401 punya format khusus
        assert.ok(
          !msg.includes('gateway'),
          'Error BUKAN lowercase "gateway" — 401 harus format pesan khusus',
        );
        // Pastikan BUKAN timeout atau network error
        assert.ok(
          !msg.includes('timed out'),
          'Error BUKAN timeout — harus 401 auth error spesifik',
        );
        assert.ok(
          !msg.includes('Network error'),
          'Error BUKAN Network error — harus 401 auth error spesifik',
        );
      }
    } finally {
      cleanup();
    }
  },
);

// ── 32. Valid JSON but empty choices (stream: false — res.json() sukses, choices kosong) ──
await testAsync(
  'Provider throws empty choices error when JSON response has no choices array',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

    // Mock fetch to return HTTP 200 with valid JSON but NO choices key
    // res.json() sukses (tidak throw SyntaxError), tapi data.choices?.[0] = undefined
    const cleanup = mockJsonResponse('{}');

    let caughtError = null;
    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'sk-test',
        model: 'gpt-4o',
        baseURL: 'http://localhost:19999',
      });

      // KIRIM TANPA onProgress → body.stream = false → lewat res.json() → parse sukses
      // TAPI choices kosong → throw "API returned empty choices array"
      try {
        await provider.send({
          system: 'test',
          messages: [{ role: 'user', content: 'halo' }],
          // onProgress TIDAK dikirim — stream: false path
        });
        assert.fail('Harus throw error karena choices array kosong');
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
      if (caughtError) {
        const msg = caughtError.message || String(caughtError);
        // Provider check: if (!choice) throw new Error('API returned empty choices array');
        assert.ok(
          msg.includes('empty choices') || msg.includes('choices'),
          `Error harus tentang empty choices: ${msg.slice(0, 200)}`,
        );
        // Pastikan BUKAN JSON parse error, network error, timeout, atau gateway
        assert.ok(!msg.includes('JSON'), 'Error BUKAN JSON parse — JSON valid tapi choices kosong');
        assert.ok(
          !msg.includes('Network error'),
          'Error BUKAN Network error — harus empty choices spesifik',
        );
        assert.ok(!msg.includes('timed out'), 'Error BUKAN timeout — harus empty choices spesifik');
        assert.ok(
          !msg.includes('Gateway error'),
          'Error BUKAN Gateway error — harus empty choices spesifik',
        );
      }
    } finally {
      cleanup();
    }
  },
);

// ── 33. Empty choices via Agent.process() — server returns valid JSON without choices ─
await testAsync(
  'Agent.process() propagates empty choices error when server response has no choices',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    let caughtError = null;
    let chatCompletionsCalled = false;

    await runWithServer(
      (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (req.url === '/chat/completions' && req.method === 'POST') {
            chatCompletionsCalled = true;
            // Return HTTP 200 dengan valid JSON tapi TANPA field "choices"
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: 'chatcmpl-empty',
                object: 'chat.completion',
                model: 'gpt-4o',
                // choices TIDAK disertakan — sengaja di-hilangkan
                usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
              }),
            );
          } else if (req.url === '/models') {
            sendModelsResponse(res);
          }
        });
      },
      async (baseURL) => {
        const agent = new Agent(makeConfig(baseURL));
        try {
          await agent.process('Tulis sesuatu', {
            effort: 'Low',
            mode: 'general',
            onProgress: () => {},
          });
          assert.fail('Harus throw error karena response tidak punya choices');
        } catch (err) {
          caughtError = err;
        }
      },
    );

    assert.ok(chatCompletionsCalled, 'Server harus menerima request /chat/completions');
    assert.ok(caughtError !== null, 'Harus ada error yang ditangkap dari agent.process()');

    if (caughtError) {
      const msg =
        typeof caughtError === 'string' ? caughtError : caughtError.message || String(caughtError);
      // Error harus tentang empty choices
      assert.ok(
        msg.includes('empty choices') || msg.includes('choices'),
        `Error harus tentang empty choices: ${msg.slice(0, 200)}`,
      );
      // Pastikan BUKAN circuit breaker atau max iterations
      assert.ok(
        !msg.includes('Circuit Breaker'),
        'Error BUKAN circuit breaker — harus dari empty choices check',
      );
      assert.ok(
        !msg.includes('Max iterations'),
        'Error BUKAN max iterations — harus dari empty choices check',
      );
    }
  },
);

// ── 34. HTTP 429 (Rate Limited) — provider level ──────────────
await testAsync('Provider throws Gateway error on HTTP 429 (Rate Limited)', async () => {
  recordSuccess(); // Reset circuit breaker before this error test
  const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

  const errBody = JSON.stringify({
    error: {
      message: 'Rate limit exceeded. Please slow down.',
      type: 'rate_limit_error',
      code: 429,
    },
  });
  const cleanup = mockHttpError(429, errBody);

  let caughtError = null;
  try {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      baseURL: 'http://localhost:19999',
    });

    try {
      await provider.send({
        system: 'test',
        messages: [{ role: 'user', content: 'halo' }],
        onProgress: () => {},
      });
      assert.fail('Harus throw Gateway error karena HTTP 429');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
    if (caughtError) {
      const msg = caughtError.message || String(caughtError);
      assert.ok(msg.includes('429'), `Error harus mention HTTP 429: ${msg.slice(0, 200)}`);
      assert.ok(
        msg.includes('Gateway error'),
        `Error harus format 'Gateway error 429: ...': ${msg.slice(0, 200)}`,
      );
      assert.ok(
        msg.includes('rate limit') || msg.includes('Rate'),
        `Error harus mention rate limit dari body: ${msg.slice(0, 200)}`,
      );
      assert.ok(!msg.includes('timed out'), 'Error BUKAN timeout — harus Gateway error spesifik');
      assert.ok(
        !msg.includes('Network error'),
        'Error BUKAN Network error — harus Gateway error spesifik',
      );
    }
  } finally {
    cleanup();
  }
});

// ── 35. HTTP 504 (Gateway Timeout) — provider level ───────────
await testAsync('Provider throws Gateway error on HTTP 504 (Gateway Timeout)', async () => {
  recordSuccess(); // Reset circuit breaker before this error test
  const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

  const errBody = JSON.stringify({
    error: {
      message: 'Upstream model provider timed out. Please retry.',
      type: 'server_error',
      code: 504,
    },
  });
  const cleanup = mockHttpError(504, errBody);

  let caughtError = null;
  try {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      baseURL: 'http://localhost:19999',
    });

    try {
      await provider.send({
        system: 'test',
        messages: [{ role: 'user', content: 'halo' }],
        onProgress: () => {},
      });
      assert.fail('Harus throw Gateway error karena HTTP 504');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
    if (caughtError) {
      const msg = caughtError.message || String(caughtError);
      assert.ok(msg.includes('504'), `Error harus mention HTTP 504: ${msg.slice(0, 200)}`);
      assert.ok(
        msg.includes('Gateway error'),
        `Error harus format 'Gateway error 504: ...': ${msg.slice(0, 200)}`,
      );
      assert.ok(
        msg.includes('timed out') || msg.includes('retry'),
        `Error harus mention timeout/retry dari body: ${msg.slice(0, 200)}`,
      );
      assert.ok(
        !msg.includes('rate limit'),
        'Error BUKAN rate limit — harus Gateway timeout spesifik',
      );
      assert.ok(
        !msg.includes('Network error'),
        'Error BUKAN Network error — harus Gateway error spesifik',
      );
    }
  } finally {
    cleanup();
  }
});

// ── 36. _handleStream throws — verify 'Streaming failed: ...' wrapper (P4) ──
await testAsync(
  'Provider wraps stream error as "Streaming failed: ..." when _handleStream throws',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

    // Mock fetch to return HTTP 200 with SSE headers, tapi body.getReader() throws.
    // Ini trigger _handleStream yang langsung gagal → catch block wrapping.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/event-stream']]),
      body: {
        getReader: () => {
          throw new Error('Stream read error: connection interrupted');
        },
      },
    });

    let caughtError = null;
    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'sk-test',
        model: 'gpt-4o',
        baseURL: 'http://localhost:19999',
      });

      // KIRIM DENGAN onProgress → useStream = true → masuk ke _handleStream
      // _handleStream gagal → catch block: "Streaming failed: ..."
      try {
        await provider.send({
          system: 'test',
          messages: [{ role: 'user', content: 'halo' }],
          onProgress: () => {}, // stream: true — masuk _handleStream
        });
        assert.fail('Harus throw Streaming failed error karena body.getReader gagal');
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
      if (caughtError) {
        const msg = caughtError.message || String(caughtError);
        // Provider wrapping: `Streaming failed: ${streamErr.message}. Coba set stream: false di config.`
        assert.ok(
          msg.includes('Streaming failed'),
          `Error harus diawali "Streaming failed": ${msg.slice(0, 200)}`,
        );
        // Error asli dari _handleStream harus termuat
        assert.ok(
          msg.includes('Stream read error') || msg.includes('connection'),
          `Error harus mention penyebab streaming gagal: ${msg.slice(0, 200)}`,
        );
        // Saran untuk nonaktifkan streaming harus ada
        assert.ok(
          msg.includes('stream: false') || msg.includes('Coba set'),
          `Error harus saran set stream: false: ${msg.slice(0, 200)}`,
        );
        // Pastikan BUKAN error types lain
        assert.ok(
          !msg.includes('Gateway error'),
          'Error BUKAN Gateway error — harus Streaming failed wrapper',
        );
        assert.ok(
          !msg.includes('Network error'),
          'Error BUKAN Network error — harus Streaming failed wrapper',
        );
        assert.ok(
          !msg.includes('timed out'),
          'Error BUKAN timeout — harus Streaming failed wrapper',
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);

// ── 37. Invalid JSON in tool call arguments (D3 — non-streaming path) ──
await testAsync(
  'Provider throws JSON parse error when tool call arguments have invalid JSON',
  async () => {
    recordSuccess(); // Reset circuit breaker before this error test
    const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');

    // Response JSON valid secara struktural, tapi field "arguments" berisi string
    // yang BUKAN valid JSON. Provider akan parse ini dengan JSON.parse() yang
    // TIDAK di-try/catch → throws SyntaxError mentah.
    const validResponse = JSON.stringify({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_bad',
                type: 'function',
                function: { name: 'bad_tool', arguments: '{unclosed: "escaped }' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
    });

    // Gunakan mockJsonResponse — outer JSON valid, parse sukses,
    // tapi tool arguments JSON.parse gagal
    const cleanup = mockJsonResponse(validResponse);

    let caughtError = null;
    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'sk-test',
        model: 'gpt-4o',
        baseURL: 'http://localhost:19999',
      });

      // KIRIM TANPA onProgress → non-streaming → res.json() sukses →
      // tool_calls ditemukan → JSON.parse(tc.function.arguments) THROWS
      try {
        await provider.send({
          system: 'test',
          messages: [{ role: 'user', content: 'panggil tool' }],
          // onProgress TIDAK dikirim — non-streaming path
        });
        assert.fail('Harus throw SyntaxError karena tool arguments invalid JSON');
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError !== null, 'Harus ada error yang ditangkap');
      if (caughtError) {
        const msg = caughtError.message || String(caughtError);
        // JSON.parse of tool arguments throws SyntaxError — message dari JSON parser
        assert.ok(
          msg.includes('JSON') ||
            msg.includes('token') ||
            msg.includes('Expected') ||
            msg.includes('position'),
          `Error harus tentang JSON parsing tool arguments: ${msg.slice(0, 200)}`,
        );
        // Pastikan BUKAN error types lain
        assert.ok(
          !msg.includes('Network error'),
          'Error BUKAN Network error — harus JSON parse tool args',
        );
        assert.ok(
          !msg.includes('Gateway error'),
          'Error BUKAN Gateway error — harus JSON parse tool args',
        );
        assert.ok(!msg.includes('timed out'), 'Error BUKAN timeout — harus JSON parse tool args');
        assert.ok(
          !msg.includes('Streaming failed'),
          'Error BUKAN Streaming failed — harus JSON parse tool args',
        );
        assert.ok(
          !msg.includes('empty choices'),
          'Error BUKAN empty choices — harus JSON parse tool args',
        );
      }
    } finally {
      cleanup();
    }
  },
);

// ── Cleanup ───────────────────────────────────────────────────
desktop._clearPSMock();
recordSuccess(); // Reset circuit breaker so other test files in npm chain don't get blocked

console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
