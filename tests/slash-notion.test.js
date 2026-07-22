// tests/slash-notion.test.js
// Unit test untuk /notion slash command handlers — search, read, create, dan error handling
// Jalanin: node tests/slash-notion.test.js
//
// CATATAN: Backup & restore ~/.nythros/config.json asli. Tidak memanggil Notion API beneran.
// Async tests jalan SEQUENTIAL (bukan Promise.all) karena mockResponses adalah shared state.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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

console.log('\n🧪 Slash Commands — /notion Tests\n');

// ── Backup & setup config ──────────────────────────────────
const HOME_DIR = path.join(os.homedir(), '.nythros');
const CONFIG_PATH = path.join(HOME_DIR, 'config.json');

const hadConfig = fs.existsSync(CONFIG_PATH);
const configBackup = hadConfig ? fs.readFileSync(CONFIG_PATH, 'utf-8') : null;

const testConfig = {
  endpoints: [
    { id: 'test', base_url: 'https://test.com/v1', api_key: 'sk-test', model: 'test-model' },
  ],
  notion: { api_key: 'ntn_test_secret_key', gdd_page_id: 'parent-page-123' },
};
fs.writeFileSync(CONFIG_PATH, JSON.stringify(testConfig, null, 2), 'utf-8');

// ── Mock fetch ─────────────────────────────────────────────
let mockResponses = [];

globalThis.fetch = async () => {
  const mock = mockResponses.shift();
  return {
    ok: mock ? mock.status >= 200 && mock.status < 300 : false,
    status: mock ? mock.status : 404,
    json: async () => (mock ? mock.body : { message: 'No mock' }),
    text: async () => (mock ? JSON.stringify(mock.body) : 'No mock'),
  };
};

function setMock(status, body) {
  mockResponses.push({ status, body });
}

function resetMocks() {
  mockResponses = [];
}

// ── Register slash commands ────────────────────────────────
const { registerAllCommands, executeCommand } = await import('../src/tooling/slashRegistry.js');
await registerAllCommands();

// ====================================================================
// All tests run sequentially (await each testAsync) to prevent
// shared mockResponses state from being corrupted between tests
// ====================================================================

// ── 1. /notion search ───────────────────────────────────────

await testAsync('/notion search returns formatted results', async () => {
  resetMocks();
  setMock(200, {
    results: [
      {
        id: 'page-gdd-1',
        url: 'https://notion.so/gdd1',
        last_edited_time: '2026-07-21T10:00:00.000Z',
        properties: { title: { type: 'title', title: [{ plain_text: 'GDD Wirabaya' }] } },
      },
      {
        id: 'page-gdd-2',
        url: 'https://notion.so/gdd2',
        last_edited_time: '2026-07-20T08:00:00.000Z',
        properties: { Name: { type: 'title', title: [{ plain_text: 'GDD Side Project' }] } },
      },
    ],
  });

  const output = await executeCommand('notion', ['search', 'GDD']);
  assert.ok(output.includes('Hasil pencarian'), 'Harus header hasil pencarian');
  assert.ok(output.includes('GDD Wirabaya'), 'Harus title pertama');
  assert.ok(output.includes('GDD Side Project'), 'Harus title kedua');
  assert.ok(output.includes('page-gdd-1'), 'Harus ID page pertama');
  assert.ok(output.includes('page-gdd-2'), 'Harus ID page kedua');
});

await testAsync('/notion search returns empty message when no results', async () => {
  resetMocks();
  setMock(200, { results: [] });

  const output = await executeCommand('notion', ['search', 'nonexistent']);
  assert.ok(output.includes('Tidak ada page'), 'Harus pesan tidak ada hasil');
  assert.ok(output.includes('nonexistent'), 'Harus mention query');
});

await testAsync('/notion search returns error when no query', async () => {
  const output = await executeCommand('notion', ['search']);
  assert.ok(output.includes('❌'), 'Harus ada error icon');
  assert.ok(output.includes('kata kunci'), 'Harus minta query');
});

// ── 2. /notion read ─────────────────────────────────────────

await testAsync('/notion read returns page info with sections', async () => {
  resetMocks();
  setMock(200, {
    id: 'page-specific-123',
    properties: { Title: { type: 'title', title: [{ plain_text: 'My Detailed GDD' }] } },
  });
  setMock(200, {
    results: [
      { type: 'heading_1', id: 'b1', heading_1: { rich_text: [{ plain_text: 'Story' }] } },
      { type: 'paragraph', id: 'b2', paragraph: { rich_text: [{ plain_text: 'Story content' }] } },
      { type: 'heading_2', id: 'b3', heading_2: { rich_text: [{ plain_text: 'Characters' }] } },
    ],
    has_more: false,
  });

  const output = await executeCommand('notion', ['read', 'page-specific-123']);
  assert.ok(output.includes('My Detailed GDD'), 'Harus ada title');
  assert.ok(output.includes('3 blocks'), 'Harus mention 3 blocks');
  assert.ok(output.includes('2 sections'), 'Harus mention 2 sections');
  assert.ok(output.includes('# Story'), 'Harus ada section Story');
  assert.ok(output.includes('## Characters'), 'Harus ada section Characters');
  assert.ok(output.includes('page-specific-123'), 'Harus ada page ID');
});

await testAsync('/notion read handles page with no header sections', async () => {
  resetMocks();
  setMock(200, { id: 'no-title-page', properties: {} });
  setMock(200, {
    results: [
      { type: 'paragraph', id: 'p1', paragraph: { rich_text: [{ plain_text: 'Just text' }] } },
    ],
    has_more: false,
  });

  const output = await executeCommand('notion', ['read', 'no-title-page']);
  assert.ok(output.includes('Untitled'), 'Title fallback ke Untitled');
  assert.ok(output.includes('no-title-page'), 'Harus ada page ID');
  assert.ok(output.includes('1 blocks'), 'Harus mention 1 block');
  assert.ok(output.includes('no headers'), 'Harus mention no headers fallback');
});

await testAsync('/notion read returns error when no pageId', async () => {
  const output = await executeCommand('notion', ['read']);
  assert.ok(output.includes('❌'), 'Harus ada error icon');
  assert.ok(output.includes('Page ID'), 'Harus minta page ID');
});

// ── 3. /notion create ───────────────────────────────────────

await testAsync('/notion create creates page with GDD template', async () => {
  resetMocks();
  setMock(200, {
    id: 'new-gdd-page-456',
    url: 'https://notion.so/new-gdd-page-456',
  });

  const output = await executeCommand('notion', ['create', 'GDD', 'Wirabaya']);
  assert.ok(output.includes('berhasil dibuat'), 'Harus sukses');
  assert.ok(output.includes('GDD Wirabaya'), 'Harus mention title');
  assert.ok(output.includes('new-gdd-page-456'), 'Harus ada page ID baru');
  assert.ok(output.includes('Template blocks'), 'Harus mention block count');
  assert.ok(output.includes('/notion read'), 'Harus ada saran next step');
});

await testAsync('/notion create returns error when no title', async () => {
  const output = await executeCommand('notion', ['create']);
  assert.ok(output.includes('❌'), 'Harus ada error icon');
  assert.ok(output.includes('judul GDD'), 'Harus minta judul');
});

// ── 4. /notion archive & delete ──────────────────────────────

await testAsync('/notion archive archives a page (with --confirm flag)', async () => {
  resetMocks();
  setMock(200, {
    id: 'page-arc-1',
    archived: true,
    url: 'https://notion.so/archived',
    properties: {
      Title: { type: 'title', title: [{ plain_text: 'Old GDD' }] },
    },
  });

  const output = await executeCommand('notion', ['archive', 'page-arc-1', '--confirm']);
  assert.ok(output.includes('berhasil diarsipkan'), 'Harus sukses archive');
  assert.ok(output.includes('Old GDD'), 'Harus mention title');
  assert.ok(output.includes('page-arc-1'), 'Harus ada page ID');
});

await testAsync('/notion archive warns and requires --confirm', async () => {
  const output = await executeCommand('notion', ['archive', 'page-arc-1']);
  assert.ok(output.includes('PERINGATAN'), 'Harus ada peringatan');
  assert.ok(output.includes('--confirm'), 'Harus mention --confirm flag');
});

await testAsync('/notion delete deletes a page (with --confirm flag)', async () => {
  resetMocks();
  setMock(200, {
    id: 'page-del-2',
    archived: true,
    url: null,
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'Trash Page' }] },
    },
  });

  const output = await executeCommand('notion', ['delete', 'page-del-2', '--confirm']);
  assert.ok(output.includes('berhasil dihapus'), 'Harus sukses delete');
  assert.ok(output.includes('Trash Page'), 'Harus mention title');
  assert.ok(output.includes('page-del-2'), 'Harus ada page ID');
});

await testAsync('/notion delete warns and requires --confirm', async () => {
  const output = await executeCommand('notion', ['delete', 'page-del-2']);
  assert.ok(output.includes('PERINGATAN'), 'Harus ada peringatan');
  assert.ok(output.includes('--confirm'), 'Harus mention --confirm flag');
});

await testAsync('/notion archive returns error when no pageId', async () => {
  const output = await executeCommand('notion', ['archive']);
  assert.ok(output.includes('❌'), 'Harus error');
  assert.ok(output.includes('Page ID'), 'Harus minta page ID');
});

await testAsync('/notion delete returns error when no api_key', async () => {
  const emptyConfig = JSON.parse(JSON.stringify(testConfig));
  delete emptyConfig.notion;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(emptyConfig, null, 2), 'utf-8');

  const output = await executeCommand('notion', ['delete', 'abc123']);
  assert.ok(output.includes('❌'), 'Harus error');
  assert.ok(output.includes('API key'), 'Harus mention API key');

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(testConfig, null, 2), 'utf-8');
});

// ── 5. Error handling: no API key ───────────────────────────

await testAsync('/notion search returns error when no api_key', async () => {
  const emptyConfig = JSON.parse(JSON.stringify(testConfig));
  delete emptyConfig.notion;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(emptyConfig, null, 2), 'utf-8');

  const output = await executeCommand('notion', ['search', 'test']);
  assert.ok(output.includes('❌'), 'Harus error');
  assert.ok(output.includes('API key'), 'Harus mention API key');

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(testConfig, null, 2), 'utf-8');
});

await testAsync('/notion read returns error when no api_key', async () => {
  const emptyConfig = JSON.parse(JSON.stringify(testConfig));
  delete emptyConfig.notion;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(emptyConfig, null, 2), 'utf-8');

  const output = await executeCommand('notion', ['read', 'abc123']);
  assert.ok(output.includes('❌'), 'Harus error');
  assert.ok(output.includes('API key'), 'Harus mention API key');

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(testConfig, null, 2), 'utf-8');
});

// ── Cleanup ──────────────────────────────────────────────────

if (configBackup !== null) {
  fs.writeFileSync(CONFIG_PATH, configBackup, 'utf-8');
} else if (!hadConfig) {
  try {
    fs.unlinkSync(CONFIG_PATH);
  } catch {}
}

console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
