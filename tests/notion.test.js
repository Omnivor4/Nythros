// tests/notion.test.js
// Unit test untuk src/integrations/notion.js — block↔markdown, section parsing, API client
// Jalanin: node tests/notion.test.js
//
// CATATAN: Tidak manggil Notion API beneran. Semua fetch di-mock.

import assert from 'node:assert/strict';

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

console.log('\n🧪 Notion API Client Tests\n');

// ── Mock fetch helper ──────────────────────────────────────
let mockResponses = [];
let fetchCalls = [];

globalThis.fetch = async (url, options = {}) => {
  fetchCalls.push({ url, method: options.method || 'GET', body: options.body });
  const mock = mockResponses.shift();
  if (!mock) {
    return {
      ok: false,
      status: 404,
      json: async () => ({ message: 'No mock response set' }),
      text: async () => 'No mock response set',
    };
  }
  return {
    ok: mock.status >= 200 && mock.status < 300,
    status: mock.status,
    json: async () => mock.body,
    text: async () => JSON.stringify(mock.body),
  };
};

function setMock(status, body) {
  mockResponses.push({ status, body });
}

function resetMocks() {
  mockResponses = [];
  fetchCalls = [];
}

// ── Import module ──────────────────────────────────────────
const notion = await import('../src/integrations/notion.js');
const {
  isNotionConfigured,
  blocksToMarkdown,
  markdownToBlocks,
  parseMarkdownSections,
  readPageBlocks,
  readPageAsMarkdown,
  updatePageBlocks,
  searchPages,
  archivePage,
} = notion;

// ====================================================================
// 1. isNotionConfigured
// ====================================================================

test('isNotionConfigured returns false when config is missing', () => {
  assert.equal(isNotionConfigured({}), false);
  assert.equal(isNotionConfigured(null), false);
  assert.equal(isNotionConfigured(undefined), false);
  assert.equal(isNotionConfigured({ notion: {} }), false);
});

test('isNotionConfigured returns false when only api_key is set', () => {
  assert.equal(isNotionConfigured({ notion: { api_key: 'ntn_xxx' } }), false);
});

test('isNotionConfigured returns false when only gdd_page_id is set', () => {
  assert.equal(isNotionConfigured({ notion: { gdd_page_id: 'abc123' } }), false);
});

test('isNotionConfigured returns true when both api_key and gdd_page_id are set', () => {
  assert.equal(isNotionConfigured({ notion: { api_key: 'ntn_xxx', gdd_page_id: 'abc123' } }), true);
});

// ====================================================================
// 2. blocksToMarkdown — all block types
// ====================================================================

test('blocksToMarkdown converts heading_1', () => {
  const blocks = [{ type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Title' }] } }];
  assert.equal(blocksToMarkdown(blocks), '# Title');
});

test('blocksToMarkdown converts heading_2', () => {
  const blocks = [{ type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Subtitle' }] } }];
  assert.equal(blocksToMarkdown(blocks), '## Subtitle');
});

test('blocksToMarkdown converts heading_3', () => {
  const blocks = [
    { type: 'heading_3', heading_3: { rich_text: [{ plain_text: 'Sub-subtitle' }] } },
  ];
  assert.equal(blocksToMarkdown(blocks), '### Sub-subtitle');
});

test('blocksToMarkdown converts paragraph', () => {
  const blocks = [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Hello world' }] } }];
  assert.equal(blocksToMarkdown(blocks), 'Hello world');
});

test('blocksToMarkdown converts bulleted_list_item', () => {
  const blocks = [
    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: 'Item 1' }] } },
  ];
  assert.equal(blocksToMarkdown(blocks), '- Item 1');
});

test('blocksToMarkdown converts numbered_list_item', () => {
  const blocks = [
    { type: 'numbered_list_item', numbered_list_item: { rich_text: [{ plain_text: 'First' }] } },
  ];
  assert.equal(blocksToMarkdown(blocks), '1. First');
});

test('blocksToMarkdown converts to_do unchecked', () => {
  const blocks = [
    { type: 'to_do', to_do: { rich_text: [{ plain_text: 'Task' }], checked: false } },
  ];
  assert.equal(blocksToMarkdown(blocks), '- [ ] Task');
});

test('blocksToMarkdown converts to_do checked', () => {
  const blocks = [{ type: 'to_do', to_do: { rich_text: [{ plain_text: 'Done' }], checked: true } }];
  assert.equal(blocksToMarkdown(blocks), '- [x] Done');
});

test('blocksToMarkdown converts code block', () => {
  const blocks = [
    {
      type: 'code',
      code: {
        rich_text: [{ plain_text: 'console.log("hi");' }],
        language: 'javascript',
      },
    },
  ];
  assert.equal(blocksToMarkdown(blocks), '```javascript\nconsole.log("hi");\n```');
});

test('blocksToMarkdown converts code block without language', () => {
  const blocks = [
    {
      type: 'code',
      code: { rich_text: [{ plain_text: 'hello' }], language: '' },
    },
  ];
  assert.equal(blocksToMarkdown(blocks), '```\nhello\n```');
});

test('blocksToMarkdown converts quote', () => {
  const blocks = [{ type: 'quote', quote: { rich_text: [{ plain_text: 'Citation' }] } }];
  assert.equal(blocksToMarkdown(blocks), '> Citation');
});

test('blocksToMarkdown converts divider', () => {
  const blocks = [{ type: 'divider', divider: {} }];
  assert.equal(blocksToMarkdown(blocks), '---');
});

test('blocksToMarkdown handles multiple blocks with newlines', () => {
  const blocks = [
    { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Title' }] } },
    { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Body text' }] } },
    { type: 'divider', divider: {} },
    { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Section' }] } },
  ];
  const expected = '# Title\nBody text\n---\n## Section';
  assert.equal(blocksToMarkdown(blocks), expected);
});

test('blocksToMarkdown handles rich_text with multiple text parts', () => {
  const blocks = [
    {
      type: 'paragraph',
      paragraph: {
        rich_text: [{ plain_text: 'Hello ' }, { plain_text: 'World' }],
      },
    },
  ];
  assert.equal(blocksToMarkdown(blocks), 'Hello World');
});

// ====================================================================
// 3. markdownToBlocks — all supported markdown elements
// ====================================================================

test('markdownToBlocks converts # heading_1', () => {
  const result = markdownToBlocks('# Title');
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'heading_1');
  assert.equal(result[0].heading_1.rich_text[0].text.content, 'Title');
});

test('markdownToBlocks converts ## heading_2', () => {
  const result = markdownToBlocks('## Subtitle');
  assert.equal(result[0].type, 'heading_2');
  assert.equal(result[0].heading_2.rich_text[0].text.content, 'Subtitle');
});

test('markdownToBlocks converts ### heading_3', () => {
  const result = markdownToBlocks('### Sub-subtitle');
  assert.equal(result[0].type, 'heading_3');
});

test('markdownToBlocks converts paragraph text', () => {
  const result = markdownToBlocks('Hello world');
  assert.equal(result[0].type, 'paragraph');
  assert.equal(result[0].paragraph.rich_text[0].text.content, 'Hello world');
});

test('markdownToBlocks converts bullet list', () => {
  const result = markdownToBlocks('- Item 1');
  assert.equal(result[0].type, 'bulleted_list_item');
  assert.equal(result[0].bulleted_list_item.rich_text[0].text.content, 'Item 1');
});

test('markdownToBlocks converts numbered list', () => {
  const result = markdownToBlocks('1. First');
  assert.equal(result[0].type, 'numbered_list_item');
  assert.equal(result[0].numbered_list_item.rich_text[0].text.content, 'First');
});

test('markdownToBlocks converts to_do unchecked', () => {
  const result = markdownToBlocks('- [ ] Task');
  assert.equal(result[0].type, 'to_do');
  assert.equal(result[0].to_do.rich_text[0].text.content, 'Task');
  assert.equal(result[0].to_do.checked, false);
});

test('markdownToBlocks converts to_do checked', () => {
  const result = markdownToBlocks('- [x] Done');
  assert.equal(result[0].type, 'to_do');
  assert.equal(result[0].to_do.checked, true);
});

test('markdownToBlocks converts code block', () => {
  const result = markdownToBlocks('```javascript\nconsole.log("hi");\n```');
  assert.equal(result[0].type, 'code');
  assert.equal(result[0].code.language, 'javascript');
  assert.equal(result[0].code.rich_text[0].text.content, 'console.log("hi");');
});

test('markdownToBlocks converts code block without language', () => {
  const result = markdownToBlocks('```\nhello\n```');
  assert.equal(result[0].type, 'code');
  assert.equal(result[0].code.language, 'plain text');
});

test('markdownToBlocks converts quote', () => {
  const result = markdownToBlocks('> Citation');
  assert.equal(result[0].type, 'quote');
  assert.equal(result[0].quote.rich_text[0].text.content, 'Citation');
});

test('markdownToBlocks converts divider', () => {
  const result = markdownToBlocks('---');
  assert.equal(result[0].type, 'divider');
});

test('markdownToBlocks skips empty lines', () => {
  const result = markdownToBlocks('\n\n# Title\n\nParagraph\n\n');
  // Should produce 2 blocks (heading + paragraph), skipping empties
  assert.equal(result.length, 2);
  assert.equal(result[0].type, 'heading_1');
  assert.equal(result[1].type, 'paragraph');
});

test('markdownToBlocks roundtrip: markdown → blocks → markdown', () => {
  const input =
    '# Title\n\nParagraph text\n\n## Section\n\n- Bullet 1\n- Bullet 2\n\n1. Numbered\n\n> Quote\n\n---\n\n### Subsection\n\n```js\ncode\n```';
  const blocks = markdownToBlocks(input);
  const output = blocksToMarkdown(blocks);
  // roundtrip should preserve all content (whitespace may differ slightly)
  assert.ok(output.includes('# Title'));
  assert.ok(output.includes('Paragraph text'));
  assert.ok(output.includes('## Section'));
  assert.ok(output.includes('- Bullet 1'));
  assert.ok(output.includes('- Bullet 2'));
  assert.ok(output.includes('1. Numbered'));
  assert.ok(output.includes('> Quote'));
  assert.ok(output.includes('---'));
  assert.ok(output.includes('### Subsection'));
  assert.ok(output.includes('```js'));
  assert.ok(output.includes('code'));
});

// ====================================================================
// 4. parseMarkdownSections
// ====================================================================

test('parseMarkdownSections parses headers into sections', () => {
  const md =
    '# Title\n\nIntro\n\n## Mechanics\n\nJumping\nDouble jump\n\n## Story\n\nHero journey\n\n### Characters\n\nAria\n\n## Levels\n\nChapter 1';
  const sections = parseMarkdownSections(md);

  assert.equal(sections.length, 5, 'Harusnya 5 sections (including nested Characters)');
  assert.equal(sections[0].level, 1);
  assert.equal(sections[0].title, 'Title');
  assert.equal(sections[1].title, 'Mechanics');
  assert.equal(sections[1].content, 'Jumping\nDouble jump');
  assert.equal(sections[2].title, 'Story');
  assert.equal(sections[2].content, 'Hero journey');
  assert.equal(sections[3].title, 'Characters');
  assert.equal(sections[3].level, 3);
  assert.equal(sections[4].title, 'Levels');
});

test('parseMarkdownSections handles nested sections', () => {
  const md = '# Main\n\n## Level 2\n\n### Level 3\n\nDeep content\n\n## Another\n\nEnd';
  const sections = parseMarkdownSections(md);

  assert.equal(sections.length, 4);
  // Level 3 sebagai section sendiri
  const l3 = sections.find((s) => s.title === 'Level 3');
  assert.ok(l3, 'Level 3 harus jadi section');
  assert.equal(l3.level, 3);
  assert.equal(l3.content, 'Deep content');
});

test('parseMarkdownSections returns empty array for text without headers', () => {
  const sections = parseMarkdownSections('Just some text\nwithout any headers');
  assert.equal(sections.length, 0);
});

test('parseMarkdownSections handles empty string', () => {
  assert.equal(parseMarkdownSections('').length, 0);
});

// ====================================================================
// 5. readPageBlocks — mocked fetch
// ====================================================================

testAsync('readPageBlocks fetches blocks from Notion API', async () => {
  resetMocks();
  setMock(200, {
    results: [
      { type: 'paragraph', id: 'block1', paragraph: { rich_text: [{ plain_text: 'Hello' }] } },
    ],
    has_more: false,
  });

  const blocks = await readPageBlocks('test-page-id', 'ntn_test_key');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(fetchCalls.length, 1);
  assert.ok(fetchCalls[0].url.includes('test-page-id'));
});

testAsync('readPageBlocks handles pagination', async () => {
  resetMocks();
  // Page 1: has_more with next_cursor
  setMock(200, {
    results: [{ type: 'paragraph', id: 'block1', paragraph: { rich_text: [] } }],
    has_more: true,
    next_cursor: 'cursor2',
  });
  // Page 2: no more
  setMock(200, {
    results: [
      { type: 'heading_1', id: 'block2', heading_1: { rich_text: [{ plain_text: 'End' }] } },
    ],
    has_more: false,
  });

  const blocks = await readPageBlocks('page-id', 'key');
  assert.equal(blocks.length, 2, 'Harusnya 2 blocks dari 2 pages');
  assert.equal(fetchCalls.length, 2);
  assert.ok(fetchCalls[1].url.includes('cursor2'), 'Page 2 harus pake cursor');
});

testAsync('readPageBlocks throws on API error', async () => {
  resetMocks();
  setMock(401, { message: 'Invalid token' });

  try {
    await readPageBlocks('page-id', 'bad-key');
    assert.fail('Harusnya throw error');
  } catch (e) {
    assert.ok(e.message.includes('401'), 'Error harus mention status code');
  }
});

// ====================================================================
// 6. readPageAsMarkdown
// ====================================================================

testAsync('readPageAsMarkdown fetches page metadata and blocks', async () => {
  resetMocks();
  // Page metadata
  setMock(200, {
    id: 'page123',
    properties: {
      title: {
        type: 'title',
        title: [{ plain_text: 'My GDD' }],
      },
    },
  });
  // Blocks
  setMock(200, {
    results: [
      { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Story' }] } },
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Once upon a time' }] } },
    ],
    has_more: false,
  });

  const result = await readPageAsMarkdown('page123', 'key');
  assert.equal(result.title, 'My GDD');
  assert.ok(result.markdown.includes('# Story'));
  assert.ok(result.markdown.includes('Once upon a time'));
  assert.equal(result.blocks.length, 2);
});

testAsync('readPageAsMarkdown returns Untitled when no title property', async () => {
  resetMocks();
  setMock(200, { id: 'page456', properties: {} });
  setMock(200, { results: [], has_more: false });

  const result = await readPageAsMarkdown('page456', 'key');
  assert.equal(result.title, 'Untitled');
});

// ====================================================================
// 7. updatePageBlocks
// ====================================================================

testAsync('updatePageBlocks deletes existing and appends new blocks', async () => {
  resetMocks();
  // GET existing blocks — 2 blocks dengan id
  setMock(200, {
    results: [
      { type: 'paragraph', id: 'old1', paragraph: { rich_text: [{ plain_text: 'Old1' }] } },
      { type: 'paragraph', id: 'old2', paragraph: { rich_text: [{ plain_text: 'Old2' }] } },
    ],
    has_more: false,
  });
  // DELETE old1
  setMock(200, {});
  // DELETE old2
  setMock(200, {});
  // PATCH new blocks
  setMock(200, {});

  const newBlocks = [
    {
      object: 'block',
      type: 'heading_1',
      heading_1: { rich_text: [{ type: 'text', text: { content: 'New' } }] },
    },
  ];

  const result = await updatePageBlocks('page-id', 'key', newBlocks);
  assert.equal(result.deleted, 2);
  assert.equal(result.appended, 1);

  // Hitung jumlah fetch calls: 1 GET + 2 DELETE + 1 PATCH = 4
  assert.equal(fetchCalls.length, 4, 'Harusnya 4 fetch calls');
});

testAsync('updatePageBlocks handles empty existing blocks', async () => {
  resetMocks();
  // GET existing — empty
  setMock(200, { results: [], has_more: false });
  // PATCH new blocks
  setMock(200, {});

  const newBlocks = [
    {
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: 'New' } }] },
    },
  ];

  const result = await updatePageBlocks('page-id', 'key', newBlocks);
  assert.equal(result.deleted, 0);
  assert.equal(result.appended, 1);
});

testAsync('updatePageBlocks chunks at 50 blocks per append', async () => {
  resetMocks();
  // GET existing — empty
  setMock(200, { results: [], has_more: false });

  // 120 blocks → 3 PATCH calls (50 + 50 + 20)
  for (let i = 0; i < 3; i++) {
    setMock(200, {});
  }

  const newBlocks = Array.from({ length: 120 }, (_, i) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: `Block ${i + 1}` } }] },
  }));

  const result = await updatePageBlocks('page-id', 'key', newBlocks);
  assert.equal(result.deleted, 0);
  assert.equal(result.appended, 120);

  // PATCH calls: cek body size tiap call
  const patchCalls = fetchCalls.filter((c) => c.method === 'PATCH');
  assert.equal(patchCalls.length, 3, 'Harusnya 3 PATCH calls untuk 120 blocks');

  const chunk1 = JSON.parse(patchCalls[0].body);
  assert.equal(chunk1.children.length, 50, 'Chunk 1 = 50 blocks');

  const chunk2 = JSON.parse(patchCalls[1].body);
  assert.equal(chunk2.children.length, 50, 'Chunk 2 = 50 blocks');

  const chunk3 = JSON.parse(patchCalls[2].body);
  assert.equal(chunk3.children.length, 20, 'Chunk 3 = 20 blocks');
});

// ====================================================================
// 8. searchPages
// ====================================================================

testAsync('searchPages returns formatted page list', async () => {
  resetMocks();
  setMock(200, {
    results: [
      {
        id: 'page1',
        url: 'https://notion.so/page1',
        last_edited_time: '2026-07-21T00:00:00.000Z',
        properties: {
          title: {
            type: 'title',
            title: [{ plain_text: 'GDD Wirabaya' }],
          },
        },
      },
      {
        id: 'page2',
        url: 'https://notion.so/page2',
        last_edited_time: '2026-07-20T00:00:00.000Z',
        properties: {
          Name: {
            type: 'title',
            title: [{ plain_text: 'Balance Sheet' }],
          },
        },
      },
    ],
  });

  const pages = await searchPages('GDD', 'key');
  assert.equal(pages.length, 2);
  assert.equal(pages[0].id, 'page1');
  assert.equal(pages[0].title, 'GDD Wirabaya');
  assert.equal(pages[1].title, 'Balance Sheet');
});

testAsync('searchPages returns empty array when no results', async () => {
  resetMocks();
  setMock(200, { results: [] });

  const pages = await searchPages('nonexistent', 'key');
  assert.equal(pages.length, 0);
});

// ====================================================================
// 9. archivePage
// ====================================================================

testAsync('archivePage sends PATCH with archived:true', async () => {
  resetMocks();
  setMock(200, {
    id: 'page-to-archive',
    archived: true,
    url: 'https://notion.so/archived',
    properties: {
      title: { type: 'title', title: [{ plain_text: 'Old GDD' }] },
    },
  });

  const result = await archivePage('page-to-archive', 'ntn_test_key');
  assert.equal(result.id, 'page-to-archive');
  assert.equal(result.archived, true);
  assert.equal(result.title, 'Old GDD');
  assert.equal(result.url, 'https://notion.so/archived');

  // Verify PATCH request
  assert.equal(fetchCalls.length, 1, 'Harusnya 1 fetch call');
  const call = fetchCalls[0];
  assert.equal(call.method, 'PATCH', 'Method harus PATCH');
  assert.ok(call.url.includes('page-to-archive'), 'URL harus include page ID');
  const body = JSON.parse(call.body);
  assert.equal(body.archived, true, 'Body harus archived:true');
});

testAsync('archivePage returns title from page properties', async () => {
  resetMocks();
  setMock(200, {
    id: 'test-page',
    archived: true,
    url: null,
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'My Game Design' }] },
    },
  });

  const result = await archivePage('test-page', 'key');
  assert.equal(result.title, 'My Game Design');
  assert.equal(result.id, 'test-page');
  assert.equal(result.archived, true);
});

testAsync('archivePage throws on API error', async () => {
  resetMocks();
  setMock(404, { message: 'Page not found' });

  try {
    await archivePage('nonexistent-page', 'key');
    assert.fail('Harusnya throw error');
  } catch (e) {
    assert.ok(e.message.includes('404'), 'Error harus mention 404');
  }
});

// ====================================================================
// Cleanup
// ====================================================================

resetMocks();

console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
