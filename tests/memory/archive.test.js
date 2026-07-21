// tests/memory/archive.test.js
// Unit test untuk src/memory/archive.js — appendToArchive, readRecentArchive, searchArchive
// Jalanin: node tests/memory/archive.test.js
//
// AMAN: beroperasi di temp directory, nggak ngerusak arsip asli

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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

console.log('\n🧪 Archive Module Tests\n');

// === Setup: bikin temp environment ===
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nythros-archive-test-'));
const TMP_NYTHROS = path.join(TMP_DIR, '.nythros');
fs.mkdirSync(TMP_NYTHROS, { recursive: true });

// Simpan cwd asli, pindah ke temp biar PROJECT_DIR mengarah ke temp
const origCwd = process.cwd();
process.chdir(TMP_DIR);

// Fresh import — PROJECT_DIR bakal dihitung ulang dari cwd yang baru
const archive = await import('../../src/memory/archive.js');
const { appendToArchive, readRecentArchive, searchArchive } = archive;

// Helper: path ke archive file di temp
function archivePath() {
  return path.join(TMP_NYTHROS, 'archive.jsonl');
}

// === Test 1: appendToArchive — basic ===
test('appendToArchive creates archive.jsonl and appends entry', () => {
  const archivePath = path.join(TMP_NYTHROS, 'archive.jsonl');
  // Bersihin kalau ada dari test sebelumnya
  try { fs.unlinkSync(archivePath); } catch {}

  appendToArchive('First session summary', ['key point A', 'key point B'], 3);

  const content = fs.readFileSync(archivePath, 'utf-8').trim();
  const lines = content.split('\n');
  assert.equal(lines.length, 1, 'Harusnya 1 baris');

  const entry = JSON.parse(lines[0]);
  assert.ok(entry.timestamp, 'Harus punya timestamp');
  assert.equal(entry.summary, 'First session summary');
  assert.deepEqual(entry.key_points, ['key point A', 'key point B']);
  assert.equal(entry.message_count, 3);
});

// === Test 2: appendToArchive — multiple entries ===
test('appendToArchive appends multiple entries correctly', () => {
  appendToArchive('Second session', ['point C'], 5);
  appendToArchive('Third session', ['point D', 'point E'], 7);

  const content = fs.readFileSync(path.join(TMP_NYTHROS, 'archive.jsonl'), 'utf-8').trim();
  const lines = content.split('\n');
  assert.equal(lines.length, 3, 'Harusnya 3 baris total');
});

// === Test 3: readRecentArchive — default ===
test('readRecentArchive returns 5 most recent entries by default', () => {
  // Sekarang udah ada 3 entries dari test sebelumnya
  const recent = readRecentArchive();
  assert.equal(recent.length, 3, 'Cuma ada 3 entries, harus balikin 3');
  assert.equal(recent[0].summary, 'First session summary');
  assert.equal(recent[2].summary, 'Third session');
});

// === Test 4: readRecentArchive — with maxEntries ===
test('readRecentArchive with custom maxEntries', () => {
  const recent = readRecentArchive(2);
  assert.equal(recent.length, 2, 'Harusnya cuma 2 entries terakhir');
  assert.equal(recent[0].summary, 'Second session');
  assert.equal(recent[1].summary, 'Third session');
});

// === Test 5: readRecentArchive — empty archive ===
test('readRecentArchive returns [] when file does not exist', () => {
  const ap = archivePath();
  // Backup archive, delete, test, restore
  const backup = fs.existsSync(ap) ? fs.readFileSync(ap, 'utf-8') : null;
  try { fs.unlinkSync(ap); } catch {}

  const result = readRecentArchive();
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 0, 'Harusnya array kosong');

  // Restore
  if (backup !== null) fs.writeFileSync(ap, backup, 'utf-8');
});

// === Test 6: readRecentArchive — corrupted JSONL line ===
test('readRecentArchive skips corrupted lines gracefully', () => {
  // Tulis file dengan 1 baris valid + 1 baris corrupted
  const archivePath = path.join(TMP_NYTHROS, 'archive.jsonl');
  fs.writeFileSync(archivePath, '{"valid": true}\n{broken json\n{"valid": false}\n', 'utf-8');

  const result = readRecentArchive();
  assert.equal(result.length, 2, 'Harusnya 2 entries valid doang');
  assert.equal(result[0].valid, true);
  assert.equal(result[1].valid, false);
});

// === Test 7: searchArchive — basic keyword search ===
test('searchArchive finds matching entries by summary', () => {
  // Reset archive dengan data yang predictable
  const archivePath = path.join(TMP_NYTHROS, 'archive.jsonl');
  const entries = [
    { summary: 'Fixed login bug in authentication module', key_points: ['auth flow', 'JWT fix'], message_count: 12 },
    { summary: 'Added payment gateway integration', key_points: ['stripe', 'webhooks', 'refund logic'], message_count: 8 },
    { summary: 'Refactored login page UI', key_points: ['frontend', 'form validation'], message_count: 5 },
    { summary: 'Database migration for user profiles', key_points: ['postgres', 'schema change'], message_count: 15 }
  ];
  fs.writeFileSync(archivePath, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');

  const results = searchArchive('login');
  assert.equal(results.length, 2, '2 entries mengandung "login"');
  assert.ok(results[0].summary.includes('login') || results[0].summary.includes('Login'));
  assert.ok(results[1].summary.includes('login') || results[1].summary.includes('Login'));
});

// === Test 8: searchArchive — search in key_points ===
test('searchArchive finds matches in key_points', () => {
  const results = searchArchive('stripe');
  assert.equal(results.length, 1, '1 entry dengan key_point "stripe"');
  assert.equal(results[0].summary, 'Added payment gateway integration');
});

// === Test 9: searchArchive — case insensitive ===
test('searchArchive is case insensitive', () => {
  const resultsUpper = searchArchive('LOGIN');
  const resultsLower = searchArchive('login');
  assert.equal(resultsUpper.length, resultsLower.length,
    'Search "LOGIN" dan "login" harusnya return sama');
});

// === Test 10: searchArchive — no matches ===
test('searchArchive returns [] when no matches found', () => {
  const results = searchArchive('xyznonexistent');
  assert.ok(Array.isArray(results));
  assert.equal(results.length, 0, 'Tidak ada yang cocok');
});

// === Test 11: searchArchive — empty archive ===
test('searchArchive returns [] when file does not exist', () => {
  const ap = archivePath();
  const backup = fs.existsSync(ap) ? fs.readFileSync(ap, 'utf-8') : null;
  try { fs.unlinkSync(ap); } catch {}

  const result = searchArchive('anything');
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 0, 'Harusnya array kosong karena file tidak ada');

  if (backup !== null) fs.writeFileSync(ap, backup, 'utf-8');
});

// === Test 12: searchArchive — max 10 results ===
test('searchArchive returns maximum 10 results', () => {
  const archivePath = path.join(TMP_NYTHROS, 'archive.jsonl');
  // Bikin 15 entri yang semuanya match keyword "test"
  const manyEntries = Array.from({ length: 15 }, (_, i) => ({
    summary: `Test entry number ${i + 1}`,
    key_points: ['test keyword'],
    message_count: i
  }));
  fs.writeFileSync(archivePath, manyEntries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');

  const results = searchArchive('test');
  assert.equal(results.length, 10, 'Maksimal 10 hasil');
  // Yang terakhir harusnya yang terbaru (paling bawah)
  assert.equal(results[results.length - 1].summary, 'Test entry number 15');
});

// === Test 13: appendToArchive — empty keyPoints ===
test('appendToArchive works with no keyPoints', () => {
  appendToArchive('Minimal entry');

  const result = readRecentArchive(1);
  assert.ok(result.length > 0, 'Harusnya ada 1 entry');
  const last = result[result.length - 1];
  assert.equal(last.summary, 'Minimal entry');
  assert.deepEqual(last.key_points, [], 'key_points default harus []');
  assert.equal(last.message_count, 0, 'message_count default harus 0');
});

// === Test 14: appendToArchive — special characters ===
test('appendToArchive handles special characters in summary', () => {
  appendToArchive('Entry with "quotes" and emoji 🎮 and newline\nchar', ['point 1'], 1);

  const result = readRecentArchive(1);
  assert.ok(result[0].summary.includes('"quotes"'));
  assert.ok(result[0].summary.includes('🎮'));
  assert.ok(result[0].summary.includes('newline'));
});

// === Cleanup ===
process.chdir(origCwd);
try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}

// Summary
console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
