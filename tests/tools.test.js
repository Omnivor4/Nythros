// tests/tools.test.js
// Unit test untuk src/tooling/tools.js — builtin tools
// Jalanin: node tests/tools.test.js
//
// AMAN: semua operasi file di temp directory, nggak sentuh project/user files

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.join(os.tmpdir(), `nythros-tools-test-${Date.now()}`);
const ORIGINAL_CWD = process.cwd();

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

console.log('\n🧪 Tools Module Tests\n');

// Setup: pindah ke temp directory biar semua file ops di situ
fs.mkdirSync(TEST_DIR, { recursive: true });
process.chdir(TEST_DIR);

// Import tools (jalan di TEST_DIR)
const tools = await import('../src/tooling/tools.js');

// ============ TOOLS TESTS ============

// Test 1: readFileTool - file not found
test('readFileTool returns error for missing file', () => {
  const result = tools.readFileTool.execute({ path: 'nonexistent.txt' });
  assert.ok(result.startsWith('Error:'), 'Should return error message');
  assert.ok(result.includes('tidak ditemukan'), 'Error should say file not found');
});

// Test 2: readFileTool - null path safety
test('readFileTool returns error for null path', () => {
  const result = tools.readFileTool.execute({ path: null });
  assert.ok(result.startsWith('Error:'), 'Should return error for null path');
});

// Test 3: writeFileTool - creates new file
test('writeFileTool creates file with content', () => {
  const result = tools.writeFileTool.execute({ path: 'test-write.txt', content: 'Hello, World!' });
  assert.ok(result.includes('tersimpan'), 'Should confirm file saved');
  assert.ok(fs.existsSync('test-write.txt'), 'File should exist');
  assert.equal(fs.readFileSync('test-write.txt', 'utf-8'), 'Hello, World!');
});

// Test 4: writeFileTool - creates nested directories
test('writeFileTool creates nested dirs automatically', () => {
  const result = tools.writeFileTool.execute({
    path: 'deep/nested/test.txt',
    content: 'nested content',
  });
  assert.ok(result.includes('tersimpan'), 'Should confirm file saved');
  assert.ok(fs.existsSync('deep/nested/test.txt'), 'Nested file should exist');
});

// Test 5: readFileTool - reads existing file
test('readFileTool reads existing file', () => {
  fs.writeFileSync('test-read.txt', 'readable content');
  const result = tools.readFileTool.execute({ path: 'test-read.txt' });
  assert.equal(result, 'readable content');
});

// Test 6: readFileTool - OOM protection (files > 2MB)
test('readFileTool rejects oversized files (>2MB)', () => {
  const bigPath = 'bigfile.bin';
  const buf = Buffer.alloc(3 * 1024 * 1024, 'x'); // 3MB
  fs.writeFileSync(bigPath, buf);
  const result = tools.readFileTool.execute({ path: bigPath });
  assert.ok(result.startsWith('Error:'), 'Should reject oversized file');
  assert.ok(result.includes('besar') || result.includes('besar'), 'Should mention file too large');
});

// Test 7: readFileTool - rejects directory
test('readFileTool returns error when path is directory', () => {
  fs.mkdirSync('test-dir', { recursive: true });
  const result = tools.readFileTool.execute({ path: 'test-dir' });
  assert.ok(result.startsWith('Error:'), 'Should reject directory');
  assert.ok(result.includes('folder'), 'Error should say it is a folder');
});

// Test 8: editFileTool - simple replacement
test('editFileTool replaces text correctly', () => {
  fs.writeFileSync('test-edit.txt', 'foo bar baz');
  const result = tools.editFileTool.execute({
    path: 'test-edit.txt',
    old_text: 'bar',
    new_text: 'qux',
  });
  assert.ok(result.includes('berhasil'), 'Should confirm edit success');
  assert.equal(fs.readFileSync('test-edit.txt', 'utf-8'), 'foo qux baz');
});

// Test 9: editFileTool - rejects non-unique match
test('editFileTool rejects non-unique old_text', () => {
  fs.writeFileSync('test-edit-dup.txt', 'apple apple pie');
  const result = tools.editFileTool.execute({
    path: 'test-edit-dup.txt',
    old_text: 'apple',
    new_text: 'orange',
  });
  assert.ok(result.startsWith('Error:'), 'Should reject non-unique match');
});

// Test 10: editFileTool - rejects empty old_text
test('editFileTool rejects empty old_text', () => {
  const result = tools.editFileTool.execute({ path: 'test-edit.txt', old_text: '', new_text: 'x' });
  assert.ok(result.includes('cannot be empty'), 'Should reject empty old_text');
});

// Test 11: listDirTool - normal directory
test('listDirTool lists directory contents', () => {
  fs.mkdirSync('list-test', { recursive: true });
  fs.writeFileSync('list-test/a.txt', 'a');
  fs.writeFileSync('list-test/b.txt', 'b');
  const result = tools.listDirTool.execute({ path: 'list-test' });
  assert.ok(result.includes('a.txt'), 'Should list a.txt');
  assert.ok(result.includes('b.txt'), 'Should list b.txt');
});

// Test 12: listDirTool - skips .git, node_modules, .meta
test('listDirTool skips filtered directories', () => {
  fs.mkdirSync('list-filter', { recursive: true });
  fs.writeFileSync('list-filter/file.txt', 'content');
  fs.mkdirSync('list-filter/.git', { recursive: true });
  fs.mkdirSync('list-filter/node_modules', { recursive: true });
  const result = tools.listDirTool.execute({ path: 'list-filter' });
  assert.ok(result.includes('file.txt'), 'Should list normal file');
  assert.ok(!result.includes('.git'), 'Should NOT list .git');
  assert.ok(!result.includes('node_modules'), 'Should NOT list node_modules');
});

// Test 13: listDirTool - rejects file path
test('listDirTool returns error when path is a file', () => {
  const result = tools.listDirTool.execute({ path: 'test-read.txt' });
  assert.ok(result.startsWith('Error:'), 'Should reject file path');
});

// Test 14: writeFileTool - overwrites existing file
test('writeFileTool overwrites existing file', () => {
  fs.writeFileSync('test-overwrite.txt', 'old content');
  const result = tools.writeFileTool.execute({
    path: 'test-overwrite.txt',
    content: 'new content',
  });
  assert.ok(result.includes('tersimpan'), 'Should confirm overwrite');
  assert.equal(fs.readFileSync('test-overwrite.txt', 'utf-8'), 'new content');
});

// Test 15: readFileTool - null byte detection (security)
test('readFileTool detects null byte in path', () => {
  const result = tools.readFileTool.execute({ path: 'test.txt\\0bad' });
  assert.ok(result.startsWith('Error:'), 'Should reject null byte path');
});

// Cleanup
process.chdir(ORIGINAL_CWD);
try {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
} catch {}

// Summary
console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
