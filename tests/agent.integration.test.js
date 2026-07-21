// tests/agent.integration.test.js
// Integration test untuk Agent.process() — nge-verify doctor warnings
// masuk ke system prompt lewat mock HTTP server
// Jalanin: node tests/agent.integration.test.js
//
// Sequential execution — tiap test bikin & tutup server sendiri
// Catatan: provider pake streaming mode kalo onProgress di-pass,
// jadi mock server harus kirim SSE format (bukan JSON biasa)

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}`); console.log(`     ${e.message}`); }
}

console.log('\n🧪 Agent Integration — Doctor Warnings Pipeline Tests\n');

// ── Helpers ──────────────────────────────────────────────────

function createMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve(server));
  });
}

// SSE response helper — provider expects streaming (SSE) when onProgress is passed
function sendSSEResponse(res, content, usage) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Initial chunk with role
  res.write('data: ' + JSON.stringify({
    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
  }) + '\n\n');

  // Content chunk
  res.write('data: ' + JSON.stringify({
    choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }]
  }) + '\n\n');

  // Usage chunk
  const u = usage || { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  res.write('data: ' + JSON.stringify({ usage: u }) + '\n\n');

  // Done signal
  res.write('data: [DONE]\n\n');
  res.end();
}

function sendModelsResponse(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: [{ id: 'gpt-4o', object: 'model' }] }));
}

async function runWithServer(handler, testFn) {
  const server = await createMockServer(handler);
  const port = server.address().port;
  const baseURL = `http://localhost:${port}`;
  try {
    await testFn(baseURL);
  } finally {
    await new Promise(r => setTimeout(r, 100));
    server.close();
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

// ── 1. Empty config throws error ─────────────────────────────
await testAsync('Agent.process() throws on empty endpoint config', async () => {
  const { Agent } = await import('../src/agent/Agent.js');
  const agent = new Agent({ endpoints: [] });

  try {
    await agent.process('test', { effort: 'Low', mode: 'general', onProgress: () => {} });
    assert.fail('Harusnya throw dengan empty config');
  } catch (e) {
    assert.ok(e.message.includes('endpoint') || e.message.includes('End'),
      `Error harus tentang endpoint. Pesan: ${e.message}`);
  }
});

// ── 2. System prompt has no raw placeholders ─────────────────
await testAsync('Agent.process() system prompt replaces all placeholders', async () => {
  let capturedBody = null;

  await runWithServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (req.url === '/chat/completions' && req.method === 'POST') {
        capturedBody = body;
        sendSSEResponse(res, 'Halo dari mock!');
      } else if (req.url === '/models') {
        sendModelsResponse(res);
      }
    });
  }, async (baseURL) => {
    const { Agent } = await import('../src/agent/Agent.js');
    const agent = new Agent({
      endpoints: [{
        id: 'test', name: 'Test', base_url: baseURL, api_key: 'sk-test',
        model: 'gpt-4o', supports_vision: true, supports_tools: true, priority: 1,
      }],
      routing: { default_model: 'test' },
    });

    const result = await agent.process('Halo!', { effort: 'Low', mode: 'general', onProgress: () => {} });

    assert.ok(result, 'Result harus ada');
    assert.equal(result.text, 'Halo dari mock!', 'text harus dari mock response');

    const parsed = JSON.parse(capturedBody);
    const sysMsg = parsed.messages?.find(m => m.role === 'system');
    assert.ok(sysMsg, 'Harus ada system message');
    const prompt = sysMsg.content;

    assert.ok(!prompt.includes('{{DOCTOR_WARNINGS}}'), '{{DOCTOR_WARNINGS}} harus ke-replace');
    assert.ok(!prompt.match(/\{\{.*?\}\}/), 'Tidak boleh ada placeholder mentah');
    assert.ok(prompt.includes('Alerts'), 'Harus ada Alerts section');
  });
});

// ── 3. All expected sections present ─────────────────────────
await testAsync('Agent.process() passes all expected sections in system prompt', async () => {
  let capturedBody = null;

  await runWithServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (req.url === '/chat/completions' && req.method === 'POST') {
        capturedBody = body;
        sendSSEResponse(res, 'Ok');
      } else if (req.url === '/models') {
        sendModelsResponse(res);
      }
    });
  }, async (baseURL) => {
    const { Agent } = await import('../src/agent/Agent.js');
    const agent = new Agent({
      endpoints: [{
        id: 'test', base_url: baseURL, api_key: 'sk-test',
        model: 'gpt-4o', supports_vision: true, supports_tools: true, priority: 1,
      }],
      routing: { default_model: 'test' },
    });

    await agent.process('Tes!', { effort: 'Low', mode: 'general', onProgress: () => {} });

    const parsed = JSON.parse(capturedBody);
    const sysMsg = parsed.messages?.find(m => m.role === 'system');
    const prompt = sysMsg.content;

    const sections = ['Core Behavior', 'Modes', 'Tools Available', 'Memory',
      'Skills', 'Active Tasks', 'Obsidian', 'Alerts', 'Language', 'Rules'];
    for (const s of sections) {
      assert.ok(prompt.includes(s), `Prompt harus mengandung section "${s}"`);
    }
  });
});

// ── 4. Usage tracking ────────────────────────────────────────
await testAsync('Agent.process() tracks token usage from response', async () => {
  await runWithServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (req.url === '/chat/completions' && req.method === 'POST') {
        sendSSEResponse(res, 'Usage test', { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 });
      } else if (req.url === '/models') {
        sendModelsResponse(res);
      }
    });
  }, async (baseURL) => {
    const { Agent } = await import('../src/agent/Agent.js');
    const agent = new Agent({
      endpoints: [{
        id: 'test', base_url: baseURL, api_key: 'sk-test',
        model: 'gpt-4o', supports_vision: true, supports_tools: true, priority: 1,
      }],
    });

    const result = await agent.process('usage', { effort: 'Low', mode: 'general', onProgress: () => {} });

    assert.ok(result.usage, 'Result harus ada usage');
    assert.equal(result.usage.prompt_tokens, 50);
    assert.equal(result.usage.completion_tokens, 25);
    assert.equal(result.usage.total_tokens, 75);
  });
});

// ── 5. Doctor warnings when config incomplete ────────────────
await testAsync('Doctor warnings appear in system prompt when config incomplete', async () => {
  const CONFIG_PATH = path.join(os.homedir(), '.nythros', 'config.json');
  const hadConfig = fs.existsSync(CONFIG_PATH);
  let backup = null;
  if (hadConfig) backup = fs.readFileSync(CONFIG_PATH, 'utf-8');

  let capturedBody = null;

  try {
    // Tulis config dengan endpoint kosong — trigger warnings dari collectAllChecks
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      endpoints: [{ id: 'test', base_url: '', api_key: '', model: '', priority: 1 }]
    }, null, 2), 'utf-8');

    await runWithServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        if (req.url === '/chat/completions' && req.method === 'POST') {
          capturedBody = body;
          sendSSEResponse(res, 'Warning test');
        } else if (req.url === '/models') {
          sendModelsResponse(res);
        }
      });
    }, async (baseURL) => {
      const { Agent } = await import('../src/agent/Agent.js');
      const agent = new Agent({
        endpoints: [{
          id: 'test', base_url: baseURL, api_key: 'sk-test',
          model: 'gpt-4o', supports_vision: true, supports_tools: true, priority: 1,
        }],
        routing: { default_model: 'test' },
      });

      await agent.process('tes warning', { effort: 'Low', mode: 'general', onProgress: () => {} });

      const parsed = JSON.parse(capturedBody);
      const sysMsg = parsed.messages?.find(m => m.role === 'system');
      const prompt = sysMsg.content;

      assert.ok(prompt.includes('Peringatan Sistem'),
        'System prompt harus mengandung Peringatan Sistem saat config bermasalah');
      assert.ok(prompt.includes('[CONFIG]') || prompt.includes('[HOME]'),
        'Harus ada tag [CONFIG] atau [HOME] di peringatan');
    });
  } finally {
    // Restore config
    if (backup !== null) {
      fs.writeFileSync(CONFIG_PATH, backup, 'utf-8');
    } else {
      try { fs.unlinkSync(CONFIG_PATH); } catch {}
    }
  }
});

// ── 6. onProgress events ─────────────────────────────────────
await testAsync('Agent.process() emits start_turn and done events', async () => {
  const events = [];

  await runWithServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (req.url === '/chat/completions' && req.method === 'POST') {
        sendSSEResponse(res, 'Events');
      } else if (req.url === '/models') {
        sendModelsResponse(res);
      }
    });
  }, async (baseURL) => {
    const { Agent } = await import('../src/agent/Agent.js');
    const agent = new Agent({
      endpoints: [{
        id: 'test', base_url: baseURL, api_key: 'sk-test',
        model: 'gpt-4o', supports_vision: true, supports_tools: true, priority: 1,
      }],
    });

    await agent.process('progress', {
      effort: 'Low', mode: 'general',
      onProgress: (e) => { events.push(e.type); },
    });

    assert.ok(events.includes('start_turn'), 'Harus ada start_turn event');
    assert.ok(events.includes('done'), 'Harus ada done event');
  });
});

// Summary
console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
