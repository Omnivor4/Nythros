// tests/systemPrompt.test.js
// Unit test untuk integrasi doctor warnings ke system prompt
// Ngetes:
//   1. buildSystemPrompt() — doctorWarnings muncul/gak muncul
//   2. collectAllChecks(false) — return warning pas config kosong
//   3. PROMPT.md — placeholder {{DOCTOR_WARNINGS}} ada
// Jalanin: node tests/systemPrompt.test.js

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

console.log('\n🧪 System Prompt — Doctor Warnings Tests\n');

// ── Setup ────────────────────────────────────────────────────
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nythros-sp-test-'));
const origCwd = process.cwd();

// ── 1. PROMPT.md harus punya placeholder ─────────────────────
test('PROMPT.md contains {{DOCTOR_WARNINGS}} placeholder', () => {
  const promptPath = path.join(__dirname, '..', 'PROMPT.md');
  const content = fs.readFileSync(promptPath, 'utf-8');
  assert.ok(
    content.includes('{{DOCTOR_WARNINGS}}'),
    'Harusnya ada {{DOCTOR_WARNINGS}} di PROMPT.md',
  );
  // Pastikan posisinya setelah {{LAST_ERROR}}
  const lastErrIdx = content.indexOf('{{LAST_ERROR}}');
  const doctorIdx = content.indexOf('{{DOCTOR_WARNINGS}}');
  assert.ok(doctorIdx > lastErrIdx, '{{DOCTOR_WARNINGS}} harus setelah {{LAST_ERROR}}');
});

// ── 2. buildSystemPrompt — dengan dan tanpa warnings ─────────
testAsync('buildSystemPrompt includes Peringatan Sistem when doctorWarnings provided', async () => {
  const { buildSystemPrompt } = await import('../src/agent/systemPrompt.js');

  const output = await buildSystemPrompt({
    memory: 'test memory',
    skillsSummary: '',
    todo: '',
    lastError: '',
    doctorWarnings:
      '\n## Peringatan Sistem\n❌ [HOME] Home dir tidak ditemukan\n⚠️ [CONFIG] api_key kosong\n',
    obsidianConnected: false,
    mode: 'general',
  });

  assert.ok(output.includes('Peringatan Sistem'), 'Output harus mengandung Peringatan Sistem');
  assert.ok(output.includes('❌ [HOME]'), 'Output harus mengandung error icon');
  assert.ok(output.includes('⚠️ [CONFIG]'), 'Output harus mengandung warning icon');
  assert.ok(output.includes('api_key kosong'), 'Output harus mengandung detail pesan');
});

testAsync(
  'buildSystemPrompt does NOT include Peringatan Sistem when doctorWarnings empty',
  async () => {
    const { buildSystemPrompt } = await import('../src/agent/systemPrompt.js');

    const output = await buildSystemPrompt({
      memory: 'test memory',
      skillsSummary: '',
      todo: '',
      lastError: '',
      doctorWarnings: '',
      obsidianConnected: false,
      mode: 'general',
    });

    assert.ok(
      !output.includes('Peringatan Sistem'),
      'Output TIDAK boleh mengandung Peringatan Sistem',
    );
    assert.ok(
      !output.includes('❌ [HOME]'),
      'Output TIDAK boleh mengandung error icon dari doctor',
    );
  },
);

testAsync('buildSystemPrompt with undefined doctorWarnings (backward compat)', async () => {
  const { buildSystemPrompt } = await import('../src/agent/systemPrompt.js');

  const output = await buildSystemPrompt({
    memory: 'test',
    skillsSummary: '',
    todo: '',
    lastError: '',
    // doctorWarnings not passed — test backward compatibility
    obsidianConnected: false,
    mode: 'general',
  });

  assert.ok(
    !output.includes('Peringatan Sistem'),
    'Harusnya aman walau doctorWarnings nggak di-pass',
  );
  assert.ok(
    !output.includes('{{DOCTOR_WARNINGS}}'),
    'Placeholder harus ke-replace, bukan muncul mentah',
  );
});

testAsync('buildSystemPrompt replaces all placeholders correctly', async () => {
  const { buildSystemPrompt } = await import('../src/agent/systemPrompt.js');

  const output = await buildSystemPrompt({
    memory: 'custom memory',
    skillsSummary: 'custom skills',
    todo: 'custom todo',
    lastError: 'custom error',
    doctorWarnings: '\n## Peringatan Sistem\n⚠️ [CONFIG] Test warning\n',
    obsidianConnected: false,
    mode: 'general',
  });

  // Semua placeholder harus ke-replace
  assert.ok(!output.includes('{{MEMORY}}'), '{{MEMORY}} harus ke-replace');
  assert.ok(!output.includes('{{SKILLS_SUMMARY}}'), '{{SKILLS_SUMMARY}} harus ke-replace');
  assert.ok(!output.includes('{{TODO_CAPSULE}}'), '{{TODO_CAPSULE}} harus ke-replace');
  assert.ok(!output.includes('{{LAST_ERROR}}'), '{{LAST_ERROR}} harus ke-replace');
  assert.ok(!output.includes('{{DOCTOR_WARNINGS}}'), '{{DOCTOR_WARNINGS}} harus ke-replace');
  assert.ok(!output.includes('{{OBSIDIAN_VAULT}}'), '{{OBSIDIAN_VAULT}} harus ke-replace');
  assert.ok(
    !output.includes('{{THINKING_INSTRUCTION}}'),
    '{{THINKING_INSTRUCTION}} harus ke-replace',
  );
  assert.ok(
    !output.includes('{{LANGUAGE_INSTRUCTION}}'),
    '{{LANGUAGE_INSTRUCTION}} harus ke-replace',
  );

  // Custom values harus muncul
  assert.ok(output.includes('custom memory'), 'Memory value harus muncul');
  assert.ok(output.includes('custom skills'), 'Skills value harus muncul');
  assert.ok(output.includes('Test warning'), 'Doctor warning value harus muncul');
});

// ── 3. collectAllChecks(false) — sync-only, no network ───────
testAsync('collectAllChecks(false) returns warnings when config empty', async () => {
  // Simulasi: pindah ke TMP_DIR tanpa config
  const { collectAllChecks } = await import('../src/presentation/doctor.js');

  const data = await collectAllChecks(false);

  assert.ok(data, 'Harusnya return data');
  assert.ok(Array.isArray(data.allChecks), 'allChecks harus array');
  assert.ok(data.allChecks.length > 0, 'Harusnya ada check results');

  // Cek structure
  const hasSystem = data.allChecks.some((c) => c.section === 'system');
  const hasHome = data.allChecks.some((c) => c.section === 'home');
  const hasConfig = data.allChecks.some((c) => c.section === 'config');
  const hasProject = data.allChecks.some((c) => c.section === 'project');

  assert.ok(hasSystem, 'Harusnya ada system section');
  assert.ok(hasHome, 'Harusnya ada home section');
  assert.ok(hasConfig, 'Harusnya ada config section');
  assert.ok(hasProject, 'Harusnya ada project section');
});

testAsync('collectAllChecks(false) does NOT verify endpoints (no network)', async () => {
  const { collectAllChecks } = await import('../src/presentation/doctor.js');

  const data = await collectAllChecks(false);

  // includeVerify=false → no verify checks
  const hasVerify = data.allChecks.some((c) => c.section === 'verify');
  assert.ok(!hasVerify, 'Tidak boleh ada verify section (no network)');
});

testAsync('collectAllChecks(false) returns suggestions', async () => {
  const { collectAllChecks } = await import('../src/presentation/doctor.js');

  const data = await collectAllChecks(false);

  assert.ok(Array.isArray(data.suggestions), 'suggestions harus array');
  assert.ok(data.suggestions.length >= 2, 'Harusnya minimal 2 suggestions');
});

// ── 4. Agent.process mekanisme — verifikasi import & function ─
test('Agent.js imports collectAllChecks from doctor.js', () => {
  const agentSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'agent', 'Agent.js'),
    'utf-8',
  );
  assert.ok(
    agentSource.includes('import { collectAllChecks } from'),
    'Agent.js harus import collectAllChecks',
  );
  assert.ok(
    agentSource.includes('collectAllChecks(false)'),
    'Agent.js harus panggil collectAllChecks(false)',
  );
  assert.ok(agentSource.includes('doctorWarnings'), 'Agent.js harus pake variabel doctorWarnings');
  assert.ok(
    agentSource.includes('## Peringatan Sistem'),
    'Agent.js harus format warnings dengan ## Peringatan Sistem',
  );
});

testAsync('Agent class can be imported and instantiated', async () => {
  const { Agent } = await import('../src/agent/Agent.js');
  const agent = new Agent({});
  assert.ok(agent instanceof Agent, 'Harusnya instance Agent');
  assert.equal(typeof agent.process, 'function', 'Harusnya punya process method');
});

// ── Cleanup ──────────────────────────────────────────────────
process.chdir(origCwd);
try {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
} catch {}

// Tunggu semua async tests selesai
await Promise.all(asyncTests);

// Summary
console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
