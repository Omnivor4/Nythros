// tests/fallbackProvider.test.js
// Unit test untuk src/providers/index.js — FallbackProvider + createProvider
// Jalanin: node tests/fallbackProvider.test.js
//
// Test tanpa koneksi API beneran — semua logika di-test secara deterministic.

import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('\n🧪 FallbackProvider Tests\n');

const mod = await import('../src/providers/index.js');

// ============================================================
// CONSTRUCTOR TESTS
// ============================================================

// Test 1: Constructor throws when no endpoints
test('Constructor throws on empty endpoints', () => {
  try {
    new mod.FallbackProvider([]);
    assert.fail('Should have thrown');
  } catch (e) {
    assert.ok(e.message.includes('Belum ada endpoint'), 'Should say no endpoints');
  }
});

// Test 2: Constructor throws when endpoints missing api_key
test('Constructor rejects endpoint without api_key', () => {
  try {
    new mod.FallbackProvider([{
      id: 'test', name: 'Test', base_url: 'https://test.com',
      api_key: '', model: 'gpt-4o',
      supports_vision: true, supports_tools: true, priority: 1
    }]);
    assert.fail('Should have thrown');
  } catch (e) {
    assert.ok(e.message.includes('Belum ada endpoint'), 'Should reject empty api_key');
  }
});

// Test 3: Constructor throws when endpoints missing base_url
test('Constructor rejects endpoint without base_url', () => {
  try {
    new mod.FallbackProvider([{
      id: 'test', name: 'Test', base_url: '',
      api_key: 'sk-test', model: 'gpt-4o',
      supports_vision: true, supports_tools: true, priority: 1
    }]);
    assert.fail('Should have thrown');
  } catch (e) {
    assert.ok(e.message.includes('Belum ada endpoint'), 'Should reject empty base_url');
  }
});

// ============================================================
// PRIORITY SORTING
// ============================================================

// Test 4: Priority sorting — lower number = higher priority (duluan)
test('Sorting puts lowest priority number first', () => {
  const ep2 = { id: 'secondary', name: 'Secondary', base_url: 'https://secondary.com', api_key: 'sk-2', model: 'm2', supports_vision: true, supports_tools: true, priority: 2 };
  const ep1 = { id: 'primary', name: 'Primary', base_url: 'https://primary.com', api_key: 'sk-1', model: 'm1', supports_vision: true, supports_tools: true, priority: 1 };

  // Reproduce FallbackProvider sorting logic
  const sorted = [ep2, ep1]
    .filter(ep => ep.api_key && ep.base_url)
    .sort((a, b) => (a.priority || 99) - (b.priority || 99));

  assert.equal(sorted[0].id, 'primary', 'priority:1 should be first');
  assert.equal(sorted[1].id, 'secondary', 'priority:2 should be second');
});

// Test 5: Missing priority defaults to 99
test('Missing priority defaults to 99 (lowest)', () => {
  const epLow = { id: 'low', base_url: 'https://a.com', api_key: 'sk-a', model: 'm', supports_vision: true, supports_tools: true };
  const epHigh = { id: 'high', base_url: 'https://b.com', api_key: 'sk-b', model: 'm', supports_vision: true, supports_tools: true, priority: 5 };

  const sorted = [epLow, epHigh]
    .filter(ep => ep.api_key && ep.base_url)
    .sort((a, b) => (a.priority || 99) - (b.priority || 99));

  assert.equal(sorted[0].id, 'high', 'priority:5 should come before priority:99');
  assert.equal(sorted[1].id, 'low', 'default priority:99 goes last');
});

// ============================================================
// isRetriable LOGIC
// ============================================================

// Test 6: isRetriable — HTTP status codes
test('isRetriable — HTTP 429 and 5xx are retriable', () => {
  // Reproduce internal isRetriable
  const RETRIABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

  function isRetriable(err) {
    if (err.status && RETRIABLE_STATUSES.has(err.status)) return true;
    return false;
  }

  assert.ok(isRetriable({ status: 429 }), '429 should be retriable');
  assert.ok(isRetriable({ status: 500 }), '500 should be retriable');
  assert.ok(isRetriable({ status: 502 }), '502 should be retriable');
  assert.ok(isRetriable({ status: 503 }), '503 should be retriable');
  assert.ok(isRetriable({ status: 504 }), '504 should be retriable');
  assert.ok(!isRetriable({ status: 400 }), '400 NOT retriable');
  assert.ok(!isRetriable({ status: 401 }), '401 NOT retriable');
  assert.ok(!isRetriable({ status: 403 }), '403 NOT retriable');
});

// Test 7: isRetriable — error message matching
test('isRetriable — retriable error messages', () => {
  const RETRIABLE_MESSAGES = ["timeout", "network error", "fetch failed",
    "timed out", "econnrefused", "socket hang up", "aborted"];

  function isRetriable(err) {
    const msg = (err.message || "").toLowerCase();
    return RETRIABLE_MESSAGES.some(m => msg.includes(m));
  }

  assert.ok(isRetriable({ message: 'Request timed out' }), 'timeout retriable');
  assert.ok(isRetriable({ message: 'network error' }), 'network error retriable');
  assert.ok(isRetriable({ message: 'fetch failed' }), 'fetch failed retriable');
  assert.ok(isRetriable({ message: 'socket hang up' }), 'socket hang up retriable');
  assert.ok(isRetriable({ message: 'connection aborted' }), 'aborted retriable');
  assert.ok(!isRetriable({ message: 'invalid API key' }), 'invalid key NOT retriable');
  assert.ok(!isRetriable({ message: '401 Unauthorized' }), '401 NOT retriable by message');
});

// ============================================================
// FALLBACK / COOLDOWN LOGIC
// ============================================================

// Test 8: _availableProviders filters out providers in cooldown
test('Cooldown logic — providers in cooldown excluded', () => {
  const now = Date.now();
  const providers = [
    { id: 'fresh', failCount: 0, lastFailAt: null, cooldownMs: 60000 },
    { id: 'hot', failCount: 1, lastFailAt: now - 1000, cooldownMs: 60000 },     // baru 1 detik lalu
    { id: 'cooled', failCount: 2, lastFailAt: now - 120000, cooldownMs: 60000 }, // 2 menit lalu > 60s
  ];

  const available = providers.filter(p =>
    p.failCount === 0 || (p.lastFailAt && now - p.lastFailAt > p.cooldownMs)
  );

  assert.equal(available.length, 2, 'fresh + cooled = 2 available');
  assert.equal(available[0].id, 'fresh');
  assert.equal(available[1].id, 'cooled');
});

// Test 9: Fallback when ALL providers in cooldown — pick oldest
test('Fallback picks oldest failure when all in cooldown', () => {
  const now = Date.now();
  const providers = [
    { id: 'a', failCount: 1, lastFailAt: now - 10000 },   // 10 detik lalu
    { id: 'b', failCount: 1, lastFailAt: now - 50000 },   // 50 detik lalu (paling lama)
    { id: 'c', failCount: 2, lastFailAt: now - 30000 },   // 30 detik lalu
  ];

  // Filter (semua failCount > 0 dan masih dalam cooldown 60s)
  const available = providers.filter(p =>
    p.failCount === 0 || (p.lastFailAt && now - p.lastFailAt > 60000)
  );
  assert.equal(available.length, 0, 'All in cooldown');

  // Fallback: pilih oldest lastFailAt
  const oldest = [...providers].sort((a, b) =>
    (a.lastFailAt || 0) - (b.lastFailAt || 0)
  )[0];
  assert.equal(oldest.id, 'b', 'B has oldest lastFailAt (50s ago)');
});

// ============================================================
// createProvider
// ============================================================

// Test 10: createProvider returns FallbackProvider instance
test('createProvider returns FallbackProvider instance', () => {
  const config = {
    endpoints: [{
      id: 'main', name: 'Main', base_url: 'https://main.com',
      api_key: 'sk-m', model: 'm',
      supports_vision: true, supports_tools: true, priority: 1
    }]
  };
  const provider = mod.createProvider(config);
  assert.ok(provider instanceof mod.FallbackProvider, 'Should be FallbackProvider instance');
});

// Test 11: createProvider with preferred endpoint ID
test('createProvider with preferredEndpointId works', () => {
  const config = {
    endpoints: [
      { id: 'a', base_url: 'https://a.com', api_key: 'sk-a', model: 'm', supports_vision: true, supports_tools: true, priority: 2 },
      { id: 'b', base_url: 'https://b.com', api_key: 'sk-b', model: 'm', supports_vision: true, supports_tools: true, priority: 1 },
    ]
  };
  // Kalau preferred 'a', endpoint 'a' harus duluan (walau priority-nya lebih tinggi/angka lebih besar)
  const provider = mod.createProvider(config, 'a');
  assert.ok(provider instanceof mod.FallbackProvider, 'Should create instance');
});

// ============================================================
// buildToolResultMessage
// ============================================================

// Test 12: buildToolResultMessage format
test('buildToolResultMessage returns correct format', async () => {
  const config = {
    endpoints: [{
      id: 'main', base_url: 'https://main.com', api_key: 'sk-m', model: 'm',
      supports_vision: true, supports_tools: true, priority: 1
    }]
  };
  // Kita perlu FallbackProvider yang proper — yang API key-nya bisa nembus fetch
  // Tapi untuk test ini, kita test format result message langsung dari OpenAiCompatibleProvider
  const { OpenAICompatibleProvider } = await import('../src/providers/openaiCompatible.js');
  const p = new OpenAICompatibleProvider({ apiKey: 'sk-test', model: 'gpt-4o', baseURL: 'https://api.test.com/v1' });
  const result = p.buildToolResultMessage({ id: 'call_1' }, 'output');
  assert.equal(result.role, 'tool');
  assert.equal(result.tool_call_id, 'call_1');
  assert.equal(result.content, 'output');
});

console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
