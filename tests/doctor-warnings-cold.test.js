// tests/doctor-warnings-cold.test.js
// Cold start test: simulasi config kosong pake tmp HOME_DIR
// — tanpa modify ~/.nythros/config.json asli.
//
// Cara kerja:
//   1. Set process.env.USERPROFILE ke tmp dir (sebelum import modul)
//   2. Buat .nythros/config.json dengan endpoint kosong
//   3. Import semua modul — HOME_DIR otomatis指向 tmp dir
//   4. Jalanin Agent dengan SSE mock server
//   5. Capture system prompt, verify warnings muncul
//   6. Restore USERPROFILE + cleanup
//
// Jalanin: node tests/doctor-warnings-cold.test.js

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

let passed = 0;
let failed = 0;
const asyncTests = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
  }
}

function testAsync(name, fn) {
  const promise = (async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ❌ ${name}`);
      console.log(`     ${e.message}`);
    }
  })();
  asyncTests.push(promise);
}

console.log('\n🧪 Doctor Warnings — Cold Start (tmp HOME_DIR)\n');

// ── Setup: temp HOME_DIR ─────────────────────────────────────
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nythros-cold-test-'));
const FAKE_HOME = TMP_DIR; // Ini bakal jadi "home dir" buat os.homedir()
const FAKE_NYTHROS = path.join(FAKE_HOME, '.nythros');

// Backup & override USERPROFILE (Windows) / HOME (Unix)
const ORIG_USERPROFILE = process.env.USERPROFILE;
const ORIG_HOME = process.env.HOME;
const isWin = process.platform === 'win32';
if (isWin) {
  process.env.USERPROFILE = FAKE_HOME;
} else {
  process.env.HOME = FAKE_HOME;
}

let capturedSystemPrompt = null;

// ── SSE Mock Server ──────────────────────────────────────────
function sendSSE(res, content) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(
    'data: ' +
      JSON.stringify({
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      }) +
      '\n\n',
  );
  res.write(
    'data: ' +
      JSON.stringify({
        choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }],
      }) +
      '\n\n',
  );
  res.write(
    'data: ' +
      JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }) +
      '\n\n',
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

function createServer(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, () => resolve(s));
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN TEST
// ═══════════════════════════════════════════════════════════════

test('Setup: temp HOME_DIR created with empty config', () => {
  assert.ok(fs.existsSync(TMP_DIR), 'Temp dir harus ada');
  assert.equal(
    process.env.USERPROFILE || process.env.HOME,
    FAKE_HOME,
    'USERPROFILE/HOME harus指向 fake home',
  );
});

testAsync('Doctor warnings appear with empty config (cold start)', async () => {
  // Buat .nythros dengan config kosong (endpoint tanpa base_url/api_key)
  fs.mkdirSync(FAKE_NYTHROS, { recursive: true });
  fs.writeFileSync(
    path.join(FAKE_NYTHROS, 'config.json'),
    JSON.stringify(
      {
        endpoints: [{ id: 'test', base_url: '', api_key: '', model: '', priority: 1 }],
      },
      null,
      2,
    ),
    'utf-8',
  );
  assert.ok(fs.existsSync(path.join(FAKE_NYTHROS, 'config.json')), 'Config harus ada');

  // SSE mock server
  const server = await createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/chat/completions' && req.method === 'POST') {
        // Capture system prompt from request
        try {
          const parsed = JSON.parse(body);
          const sysMsg = parsed.messages?.find((m) => m.role === 'system');
          if (sysMsg) capturedSystemPrompt = sysMsg.content;
        } catch {}
        sendSSE(res, 'Cold start test OK');
      } else if (req.url === '/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] }));
      }
    });
  });

  const port = server.address().port;
  const baseURL = `http://localhost:${port}`;

  try {
    // IMPORT MODUL — HOME_DIR sekarang指向 FAKE_HOME/.nythros
    const { Agent } = await import('../src/agent/Agent.js');
    const { HOME_DIR } = await import('../src/shared/utils/paths.js');

    // Verify HOME_DIR benar-benar指向 fake home
    assert.equal(HOME_DIR, FAKE_NYTHROS, `HOME_DIR harus ${FAKE_NYTHROS}, bukan ${HOME_DIR}`);

    const agent = new Agent({
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
    });

    const result = await agent.process('Tes cold start!', {
      effort: 'Low',
      mode: 'general',
      onProgress: () => {},
    });

    assert.ok(result, 'Agent harus return result');
    assert.equal(result.text, 'Cold start test OK', 'text dari mock');

    // Verify system prompt mengandung warnings
    assert.ok(capturedSystemPrompt, 'System prompt harus ter-capture');
    assert.ok(
      capturedSystemPrompt.includes('Peringatan Sistem'),
      'System prompt harus mengandung Peringatan Sistem',
    );
    assert.ok(
      capturedSystemPrompt.includes('[CONFIG]') || capturedSystemPrompt.includes('[HOME]'),
      'Harus ada tag [CONFIG] atau [HOME] di peringatan',
    );
    assert.ok(
      capturedSystemPrompt.includes('base_url') ||
        capturedSystemPrompt.includes('endpoint') ||
        capturedSystemPrompt.includes('api_key'),
      'Warning harus menyebut field yang kosong',
    );

    // Pastikan placeholder {{DOCTOR_WARNINGS}} sudah ke-replace
    assert.ok(
      !capturedSystemPrompt.includes('{{DOCTOR_WARNINGS}}'),
      '{{DOCTOR_WARNINGS}} harus ke-replace',
    );
    assert.ok(!capturedSystemPrompt.match(/\{\{.*?\}\}/), 'Tidak boleh ada placeholder mentah');
  } finally {
    server.close();
  }
});

testAsync('cleanup temp HOME_DIR', async () => {
  // Wait a bit for server to fully close
  await new Promise((r) => setTimeout(r, 100));

  // Restore env
  if (isWin) {
    process.env.USERPROFILE = ORIG_USERPROFILE;
  } else {
    process.env.HOME = ORIG_HOME;
  }

  // Clean up temp dir
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }

  assert.ok(!fs.existsSync(TMP_DIR), 'Temp dir harus terhapus');
  assert.equal(
    isWin ? process.env.USERPROFILE : process.env.HOME,
    isWin ? ORIG_USERPROFILE : ORIG_HOME,
    'USERPROFILE/HOME harus di-restore',
  );
});

// ── Tunggu semua async tests ────────────────────────────────
await Promise.all(asyncTests);

// ── Summary ──────────────────────────────────────────────────
console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
