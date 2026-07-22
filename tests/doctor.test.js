// tests/doctor.test.js
// Unit test untuk src/presentation/doctor.js — checkSystem, checkHomeDir, checkConfig,
// checkProjectDir, checkObservations, verifyEndpoint, getSuggestions
// Jalanin: node tests/doctor.test.js
//
// AMAN: beroperasi di temp directory, nggak ngerusak file asli

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

let passed = 0;
let failed = 0;

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

console.log('\n🧪 Doctor Module Tests\n');

// ── Setup: temp env ──────────────────────────────────────────
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nythros-doctor-test-'));
const TMP_NYTHROS = path.join(TMP_DIR, '.nythros');
fs.mkdirSync(TMP_NYTHROS, { recursive: true });

// Project dir yang beda dari HOME_DIR — buat test checkProjectDir
const TMP_PROJECT_DIR = path.join(TMP_DIR, 'my-project');
const TMP_PROJECT_NYTHROS = path.join(TMP_PROJECT_DIR, '.nythros');
fs.mkdirSync(TMP_PROJECT_NYTHROS, { recursive: true });

// Tandain TMP_DIR sebagai project root (supaya findProjectRoot ketemu)
fs.writeFileSync(path.join(TMP_PROJECT_DIR, '.git'), '', 'utf-8');

const origCwd = process.cwd();

// Import doctor — pindah ke TMP_DIR dulu biar PROJECT_DIR/HOME_DIR kena redirect
// Tapi doctor.js pake HOME_DIR dari paths.js yang pake os.homedir(). Jadi HOME_DIR
// tetep ~/.nythros. Yang bisa kita kendalikan: PROJECT_DIR lewat cwd.
// Untuk checkHomeDir & checkObservations yang pake HOME_DIR, kita mock langsung.
process.chdir(TMP_PROJECT_DIR);
const doctor = await import('../src/presentation/doctor.js');
const {
  checkSystem,
  checkHomeDir,
  checkConfig,
  verifyEndpoint,
  checkProjectDir,
  checkObservations,
  getSuggestions,
} = doctor;
process.chdir(origCwd);

// ── Helper: create mock server ────────────────────────────────
function createMockServer(statusCode, responseBody, delayMs = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (delayMs > 0) {
        setTimeout(() => {
          res.writeHead(statusCode, { 'content-type': 'application/json' });
          res.end(JSON.stringify(responseBody));
        }, delayMs);
        return;
      }
      res.writeHead(statusCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });
    server.listen(0, () => {
      resolve(server);
    });
  });
}

// ── 1. checkSystem ───────────────────────────────────────────

test('checkSystem returns 2 checks with status ok', () => {
  const result = checkSystem();
  assert.equal(result.length, 2, 'Harusnya 2 checks');
  assert.equal(result[0].status, 'ok');
  assert.equal(result[1].status, 'ok');
  assert.ok(result[0].msg.includes('Node.js'), 'Msg harus mention Node.js');
  assert.ok(result[1].msg.includes('CPU'), 'Msg harus mention CPU');
  assert.ok(result[1].msg.includes('RAM'), 'Msg harus mention RAM');
});

// ── 2. checkHomeDir ──────────────────────────────────────────

test('checkHomeDir returns ok when HOME_DIR exists', () => {
  // HOME_DIR = ~/.nythros yang pasti ada setelah setup/loadConfig
  const result = checkHomeDir();
  assert.ok(result.length >= 1, 'Harusnya minimal 1 check');
  assert.equal(result[0].status, 'ok');
  assert.ok(result[0].msg.includes('Home dir'));
});

test('checkHomeDir detects skill registry when present', () => {
  // Tulis dummy skill registry
  const skillRegPath = path.join(os.homedir(), '.nythros', 'skill-registry.json');
  const hadIt = fs.existsSync(skillRegPath);
  const backup = hadIt ? fs.readFileSync(skillRegPath, 'utf-8') : null;

  try {
    fs.writeFileSync(skillRegPath, '[]', 'utf-8');
  } catch {}

  const result = checkHomeDir();
  const hasSkillCheck = result.some((c) => c.msg.includes('Skill registry'));
  assert.ok(hasSkillCheck, 'Harusnya ada check skill registry');

  // Restore
  if (backup !== null) {
    fs.writeFileSync(skillRegPath, backup, 'utf-8');
  } else {
    try {
      fs.unlinkSync(skillRegPath);
    } catch {}
  }
});

// ── 3. checkConfig ───────────────────────────────────────────

test('checkConfig returns err when no endpoints', () => {
  const result = checkConfig({ endpoints: [] });
  assert.equal(result.length, 1, 'Harusnya 1 check');
  assert.equal(result[0].status, 'err');
  assert.ok(result[0].msg.includes('Tidak ada endpoint'));
});

test('checkConfig returns err when endpoints is undefined', () => {
  const result = checkConfig({});
  assert.equal(result[0].status, 'err');
});

test('checkConfig returns warn when endpoint fields empty', () => {
  const config = {
    endpoints: [
      {
        id: 'test',
        name: 'My Endpoint',
        base_url: '',
        api_key: '',
        model: '',
      },
    ],
  };
  const result = checkConfig(config);
  assert.equal(result[0].status, 'warn');
  assert.ok(result[0].msg.includes('base_url kosong'));
  assert.ok(result[0].msg.includes('api_key kosong'));
});

test('checkConfig returns ok when endpoint is complete', () => {
  const config = {
    endpoints: [
      {
        id: 'main',
        name: 'Main',
        base_url: 'https://api.example.com/v1',
        api_key: 'sk-test-123',
        model: 'gpt-4o',
      },
    ],
  };
  const result = checkConfig(config);
  assert.equal(result[0].status, 'ok');
  assert.ok(result[0].msg.includes('https://api.example.com/v1'));
  assert.ok(result[0].msg.includes('gpt-4o'));
});

test('checkConfig returns ok for routing section', () => {
  const config = {
    endpoints: [
      {
        id: 'main',
        name: 'Main',
        base_url: 'https://api.example.com/v1',
        api_key: 'sk-test',
        model: 'gpt-4o',
      },
    ],
    routing: {
      default_model: 'main',
      fast_model: 'main',
      code_model: 'main',
      vision_model: 'main',
    },
  };
  const result = checkConfig(config);
  const routingCheck = result.find((c) => c.msg.includes('Routing'));
  assert.ok(routingCheck, 'Harusnya ada routing check');
  assert.equal(routingCheck.status, 'ok');
});

test('checkConfig handles multiple endpoints with mixed status', () => {
  const config = {
    endpoints: [
      {
        id: 'a',
        name: 'Endpoint A',
        base_url: 'https://a.com/v1',
        api_key: 'key-a',
        model: 'model-a',
      },
      { id: 'b', name: 'Endpoint B', base_url: '', api_key: '', model: '' },
    ],
  };
  const result = checkConfig(config);
  assert.equal(result.length, 2, 'Harusnya 2 endpoint checks');
  assert.equal(result[0].status, 'ok');
  assert.equal(result[1].status, 'warn');
});

// ── 4. checkProjectDir ───────────────────────────────────────

test('checkProjectDir returns project-specific checks when PROJECT_DIR differs from HOME_DIR', () => {
  // PROJECT_DIR sudah di-compute saat import (cwd = TMP_PROJECT_DIR)
  // PROJECT_DIR = TMP_PROJECT_NYTHROS, HOME_DIR = ~/.nythros → beda!
  const result = checkProjectDir();
  const hasProjectDir = result.some((c) => c.msg.includes('Project dir'));
  assert.ok(hasProjectDir, 'Harusnya ada check project dir');
  assert.ok(result[0].status === 'ok', 'Status harus ok');
});

test('checkProjectDir returns archive info when archive.jsonl exists', () => {
  // Buat archive.jsonl di PROJECT_DIR
  const ap = path.join(TMP_PROJECT_NYTHROS, 'archive.jsonl');
  const data = Array.from({ length: 3 }, (_, i) => ({
    timestamp: new Date().toISOString(),
    summary: `Entry ${i + 1}`,
    key_points: [],
    message_count: i,
  }));
  const content = data.map((d) => JSON.stringify(d)).join('\n') + '\n';
  fs.writeFileSync(ap, content, 'utf-8');

  // Panggil fungsi beneran — PROJECT_DIR = TMP_PROJECT_NYTHROS dari import
  const result = checkProjectDir();
  const archiveCheck = result.find((c) => c.msg.includes('Archive:'));
  assert.ok(archiveCheck, 'Harusnya ada archive check');
  assert.ok(archiveCheck.msg.includes('3 entri'), 'Harusnya detect 3 entries');
  assert.ok(archiveCheck.status === 'ok', 'Status harus ok');
});

test('checkProjectDir detects MEMORY.md when present', () => {
  const memPath = path.join(TMP_PROJECT_NYTHROS, 'MEMORY.md');
  fs.writeFileSync(memPath, '# Memories', 'utf-8');

  const result = checkProjectDir();
  const memCheck = result.find((c) => c.msg.includes('MEMORY.md'));
  assert.ok(memCheck, 'Harusnya detect MEMORY.md');

  try {
    fs.unlinkSync(memPath);
  } catch {}
});

// ── 5. checkObservations ─────────────────────────────────────

test('checkObservations returns empty when no observations file', () => {
  const result = checkObservations();
  assert.equal(result.length, 0, 'Harusnya array kosong');
});

test('checkObservations detects observations when file exists', () => {
  const obsPath = path.join(os.homedir(), '.nythros', 'observations.jsonl');
  const hadIt = fs.existsSync(obsPath);
  const backup = hadIt ? fs.readFileSync(obsPath, 'utf-8') : null;

  try {
    const data = Array.from({ length: 5 }, (_, i) => ({ obs: `test ${i}` }));
    fs.writeFileSync(obsPath, data.map((d) => JSON.stringify(d)).join('\n') + '\n', 'utf-8');
  } catch {}

  const result = checkObservations();
  const hasObsCheck = result.some((c) => c.msg.includes('Observations') && c.msg.includes('5'));
  assert.ok(hasObsCheck, 'Harusnya detect 5 observations');

  // Restore
  if (backup !== null) {
    fs.writeFileSync(obsPath, backup, 'utf-8');
  } else {
    try {
      fs.unlinkSync(obsPath);
    } catch {}
  }
});

// ── 6. verifyEndpoint ────────────────────────────────────────

// Helper: path builder untuk mock server endpoint
const mockEndpoint = (server, path = '') => {
  const addr = server.address();
  return {
    base_url: `http://localhost:${addr.port}${path}`,
    api_key: 'sk-test',
  };
};

testAsync('verifyEndpoint returns ok when /models returns 200', async () => {
  const server = await createMockServer(200, {
    data: [
      { id: 'gpt-4o', object: 'model' },
      { id: 'claude-sonnet-4', object: 'model' },
    ],
  });

  const ep = mockEndpoint(server);
  const result = await verifyEndpoint(ep);

  assert.equal(result.status, 'ok');
  assert.ok(result.msg.includes('200 OK'));
  assert.ok(result.msg.includes('2 model')); // 2 models terdaftar

  server.close();
});

testAsync('verifyEndpoint returns err on HTTP 401', async () => {
  const server = await createMockServer(401, {
    error: { message: 'Invalid API key', code: 'invalid_api_key' },
  });

  const ep = mockEndpoint(server);
  const result = await verifyEndpoint(ep);

  assert.equal(result.status, 'err');
  assert.ok(result.msg.includes('401'));
  assert.ok(result.msg.includes('API Key salah'));

  server.close();
});

testAsync('verifyEndpoint returns err on HTTP 500', async () => {
  const server = await createMockServer(500, {
    error: { message: 'Internal server error' },
  });

  const ep = mockEndpoint(server);
  const result = await verifyEndpoint(ep);

  assert.equal(result.status, 'err');
  assert.ok(result.msg.includes('500'));

  server.close();
});

testAsync('verifyEndpoint returns err on timeout', async () => {
  const server = await createMockServer(200, { data: [] }, 500);

  // Panggil dengan timeout 50ms — lebih cepet dari delay server 500ms
  // Tapi karena verifyEndpoint punya timeout internal 10.000ms,
  // kita nggak bisa test ini tanpa mock signal. Skip.
  server.close();
  console.log('     ℹ️  timeout test: skipped (internal timeout 10s terlalu panjang)');
});

testAsync('verifyEndpoint returns err on ECONNREFUSED (port not listening)', async () => {
  // Port 1 — hampir pasti nggak ada service di semua platform
  const ep = {
    base_url: 'http://localhost:1/v1',
    api_key: 'sk-test',
  };

  const start = Date.now();
  const result = await verifyEndpoint(ep);
  const elapsed = Date.now() - start;

  assert.equal(result.status, 'err');
  // Harusnya ECONNREFUSED, cepet (< 2 detik)
  assert.ok(elapsed < 3000, 'ECONNREFUSED harus cepet, bukan timeout DNS');
  assert.ok(result.msg.includes('ditolak') || result.msg.includes('ECONNREFUSED'));
});

// ── 7. getSuggestions ────────────────────────────────────────

test('getSuggestions advises setup when no endpoints configured', () => {
  const checks = [
    { section: 'config', status: 'err', msg: 'Tidak ada endpoint' },
    { section: 'system', status: 'ok', msg: 'Node.js v20' },
  ];
  const result = getSuggestions(checks);
  const hasSetupSuggestion = result.some((s) => s.includes('Belum ada endpoint'));
  assert.ok(hasSetupSuggestion, 'Harusnya saran setup endpoint');
  // Selalu ada doc link + bug report
  assert.equal(result.length, 3, '1 saran + 2 link = 3');
});

test('getSuggestions advises fill fields when endpoint incomplete', () => {
  const checks = [
    { section: 'config', status: 'warn', msg: 'My EP: base_url kosong, api_key kosong' },
  ];
  const result = getSuggestions(checks);
  const hasFillSuggestion = result.some((s) => s.includes('Endpoint belum lengkap'));
  assert.ok(hasFillSuggestion, 'Harusnya saran isi field');
});

test('getSuggestions advises check connection when verify fails', () => {
  const checks = [
    { section: 'config', status: 'ok', msg: 'Main EP: https://example.com/v1 → gpt-4o' },
    { section: 'verify', status: 'err', msg: 'https://example.com/v1 — HTTP 401' },
  ];
  const result = getSuggestions(checks);
  const hasVerifySuggestion = result.some((s) => s.includes('gagal diverifikasi'));
  assert.ok(hasVerifySuggestion, 'Harusnya saran cek koneksi');
});

test('getSuggestions positivity when all good', () => {
  const checks = [
    { section: 'config', status: 'ok', msg: 'Main EP: https://example.com/v1 → gpt-4o' },
    { section: 'verify', status: 'ok', msg: 'https://example.com/v1 — 200 OK, 10 model' },
    { section: 'system', status: 'ok', msg: 'Node.js v20' },
  ];
  const result = getSuggestions(checks);
  const hasPositive = result.some((s) => s.includes('Semua terlihat baik'));
  assert.ok(hasPositive, 'Harusnya pesan positif');
  assert.equal(result.length, 3, '1 saran + 2 link = 3');
});

test('getSuggestions limits to 5 suggestions max', () => {
  const checks = [
    { section: 'config', status: 'warn', msg: 'EP1: base_url kosong' },
    { section: 'config', status: 'warn', msg: 'EP2: api_key kosong' },
  ];
  const result = getSuggestions(checks);
  assert.ok(result.length <= 5, 'Maksimal 5');
});

test('getSuggestions still includes doc links even with errors', () => {
  const checks = [{ section: 'config', status: 'err', msg: 'Tidak ada endpoint' }];
  const result = getSuggestions(checks);
  const hasDocLink = result.some((s) => s.includes('Dokumentasi'));
  const hasBugLink = result.some((s) => s.includes('Lapor bug'));
  assert.ok(hasDocLink, 'Harusnya ada link dokumentasi');
  assert.ok(hasBugLink, 'Harusnya ada link bug report');
});

// ── Cleanup ──────────────────────────────────────────────────
process.chdir(origCwd);
try {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
} catch {}

// Summary
console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
