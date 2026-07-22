// tests/errorWatchdog.test.js
// Unit test untuk src/infrastructure/state/errorWatchdog.js — circuit breaker
// Jalanin: node tests/errorWatchdog.test.js

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.join(os.tmpdir(), `nythros-watchdog-test-${Date.now()}`);
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
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

console.log('\n🧪 Error Watchdog (Circuit Breaker) Tests\n');

// Setup: pindah ke temp directory + bikin .nythros biar PROJECT_DIR jalan
fs.mkdirSync(path.join(TEST_DIR, '.nythros'), { recursive: true });
fs.mkdirSync(path.join(TEST_DIR, '.git'), { recursive: true }); // biar jadi project root
process.chdir(TEST_DIR);

const watchdog = await import('../src/infrastructure/state/errorWatchdog.js');

// Test 1: Awalnya circuit harus TERTUTUP
test('isCircuitOpen returns false initially', () => {
  watchdog.recordSuccess(); // reset dulu
  assert.equal(watchdog.isCircuitOpen(), false);
});

// Test 2: recordFailure returns failure count
test('recordFailure returns consecutive failure count', () => {
  watchdog.recordSuccess(); // reset
  const count1 = watchdog.recordFailure('error 1');
  assert.equal(count1, 1, 'After 1 failure, count should be 1');
  const count2 = watchdog.recordFailure('error 2');
  assert.equal(count2, 2, 'After 2 failures, count should be 2');
});

// Test 3: Circuit terbuka setelah 3 failures
test('isCircuitOpen returns true after 3 failures', () => {
  watchdog.recordSuccess(); // reset
  watchdog.recordFailure('err 1');
  watchdog.recordFailure('err 2');
  watchdog.recordFailure('err 3');
  assert.equal(watchdog.isCircuitOpen(), true, 'Circuit should be open after 3 failures');
});

// Test 4: recordSuccess mereset circuit
test('recordSuccess resets circuit breaker', () => {
  watchdog.recordSuccess(); // reset
  watchdog.recordFailure('err');
  watchdog.recordFailure('err');
  watchdog.recordFailure('err');
  assert.equal(watchdog.isCircuitOpen(), true, 'Circuit should be open');
  watchdog.recordSuccess();
  assert.equal(watchdog.isCircuitOpen(), false, 'Circuit should be closed after reset');
});

// Test 5: failureSummary returns null when no failures
test('failureSummary returns null initially', () => {
  watchdog.recordSuccess(); // reset
  const summary = watchdog.failureSummary();
  assert.equal(summary, null);
});

// Test 6: failureSummary returns string after failures
test('failureSummary returns summary after failures', () => {
  watchdog.recordSuccess(); // reset
  watchdog.recordFailure('test error message');
  const summary = watchdog.failureSummary();
  assert.ok(summary.includes('gagal'), 'Should mention failures');
  assert.ok(summary.includes('test error message'), 'Should include error message');
});

// Test 7: State file persists across module reloads
test('state persists to disk (file exists)', () => {
  watchdog.recordSuccess();
  watchdog.recordFailure('persistent error');
  const projectDir = path.join(TEST_DIR, '.nythros');
  const stateFile = path.join(projectDir, 'error-state.json');
  assert.ok(fs.existsSync(stateFile), 'State file should be written to disk');
  const content = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  assert.ok(Array.isArray(content.failures), 'Should have failures array');
  assert.ok(content.failures.length > 0, 'Should have at least 1 failure');
});

// Cleanup
process.chdir(ORIGINAL_CWD);
try {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
} catch {}

console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
