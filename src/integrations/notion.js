// src/integrations/notion.js
// Notion API client — baca/tulis page content via Notion REST API
// Dokumentasi: https://developers.notion.com/reference

const NOTION_VERSION = '2026-03-11';
const BASE_URL = 'https://api.notion.com/v1';

/**
 * Cek apakah Notion API key terkonfigurasi
 */
export function isNotionConfigured(config) {
  return !!(config?.notion?.api_key && config?.notion?.gdd_page_id);
}

/**
 * Init fetch headers untuk Notion API
 */
function getHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch wrapper dengan error handling
 */
async function notionFetch(url, options, apiKey) {
  const res = await fetch(url, {
    ...options,
    headers: { ...getHeaders(apiKey), ...options?.headers },
  });

  if (!res.ok) {
    let msg = `Notion API error: ${res.status}`;
    try {
      const err = await res.json();
      if (err.message) msg += ` — ${err.message}`;
    } catch {}
    throw new Error(msg);
  }

  return res.json();
}

// ── Block → Markdown converters ──────────────────────────────

function blockToMarkdown(block) {
  const rt = block[block.type]?.rich_text || [];
  const text = rt.map((t) => t.plain_text).join('');

  switch (block.type) {
    case 'heading_1':
      return `# ${text}`;
    case 'heading_2':
      return `## ${text}`;
    case 'heading_3':
      return `### ${text}`;
    case 'bulleted_list_item':
      return `- ${text}`;
    case 'numbered_list_item':
      return `1. ${text}`;
    case 'to_do': {
      const checked = block.to_do.checked ? '[x]' : '[ ]';
      return `- ${checked} ${text}`;
    }
    case 'code': {
      const lang = block.code.language || '';
      return '```' + lang + '\n' + text + '\n```';
    }
    case 'quote':
      return `> ${text}`;
    case 'divider':
      return '---';
    case 'paragraph':
    default:
      return text;
  }
}

export function makeRichText(content) {
  return [{ type: 'text', text: { content }, plain_text: content }];
}

export function markdownToBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trim = line.trim();

    // Skip empty lines
    if (!trim) continue;

    // Code block
    if (trim.startsWith('```')) {
      const lang = trim.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      const content = codeLines.join('\n');
      blocks.push({
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content }, plain_text: content }],
          language: lang || 'plain text',
        },
      });
      continue;
    }

    // Headers
    if (trim.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: makeRichText(trim.slice(4)) },
      });
      continue;
    }
    if (trim.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: makeRichText(trim.slice(3)) },
      });
      continue;
    }
    if (trim.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: makeRichText(trim.slice(2)) },
      });
      continue;
    }

    // Quote
    if (trim.startsWith('> ')) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: makeRichText(trim.slice(2)) },
      });
      continue;
    }

    // Divider
    if (trim === '---') {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      continue;
    }

    // Todo checkbox
    const todoMatch = trim.match(/^- \[([ x])\]\s+(.*)/);
    if (todoMatch) {
      blocks.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: makeRichText(todoMatch[2]),
          checked: todoMatch[1] === 'x',
        },
      });
      continue;
    }

    // Bullet list
    if (trim.startsWith('- ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: makeRichText(trim.slice(2)) },
      });
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(trim)) {
      const content = trim.replace(/^\d+\.\s/, '');
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: makeRichText(content) },
      });
      continue;
    }

    // Default: paragraph
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: makeRichText(trim) },
    });
  }

  return blocks;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Baca seluruh blocks dari sebuah Notion page
 * Otomatis handle pagination (max 100 blocks)
 */
export async function readPageBlocks(pageId, apiKey) {
  let allBlocks = [];
  let cursor = null;

  do {
    const url = cursor
      ? `${BASE_URL}/blocks/${pageId}/children?page_size=100&start_cursor=${cursor}`
      : `${BASE_URL}/blocks/${pageId}/children?page_size=100`;

    const data = await notionFetch(url, {}, apiKey);
    allBlocks = allBlocks.concat(data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return allBlocks;
}

/**
 * Konversi Notion blocks ke markdown string
 */
export function blocksToMarkdown(blocks) {
  return blocks.map(blockToMarkdown).join('\n');
}

/**
 * Baca halaman Notion sebagai markdown
 * Returns { title, markdown, blocks }
 */
export async function readPageAsMarkdown(pageId, apiKey) {
  // Dapatin title page dari page object
  let title = 'Untitled';
  try {
    const pageData = await notionFetch(`${BASE_URL}/pages/${pageId}`, {}, apiKey);
    // Extract title from page properties
    const props = pageData.properties || {};
    const titleProp = Object.values(props).find((p) => p.type === 'title');
    if (titleProp?.title?.[0]?.plain_text) {
      title = titleProp.title[0].plain_text;
    }
  } catch {}

  const blocks = await readPageBlocks(pageId, apiKey);
  const markdown = blocksToMarkdown(blocks);

  return { title, markdown, blocks };
}

/**
 * Update blocks di halaman Notion (replace all)
 * 1. Delete existing blocks
 * 2. Append new blocks
 */
export async function updatePageBlocks(pageId, apiKey, newBlocks) {
  // Step 1: Get existing blocks
  const existingBlocks = await readPageBlocks(pageId, apiKey);
  const existingIds = existingBlocks.map((b) => b.id).filter(Boolean);

  // Step 2: Delete existing blocks (Notion API: archive block)
  for (const blockId of existingIds) {
    try {
      await notionFetch(`${BASE_URL}/blocks/${blockId}`, { method: 'DELETE' }, apiKey);
    } catch {
      // Some blocks might fail to delete — skip
    }
  }

  // Step 3: Append new blocks
  const chunkSize = 50; // Notion max 50 blocks per append
  for (let i = 0; i < newBlocks.length; i += chunkSize) {
    const chunk = newBlocks.slice(i, i + chunkSize);
    await notionFetch(
      `${BASE_URL}/blocks/${pageId}/children`,
      {
        method: 'PATCH',
        body: JSON.stringify({ children: chunk }),
      },
      apiKey,
    );
  }

  return { deleted: existingIds.length, appended: newBlocks.length };
}

/**
 * GDD template — markdown yang akan diisi saat bikin page baru
 */
const GDD_TEMPLATE = `# Story

Ceritakan premis dan latar belakang game di sini.

## Plot Overview

## Setting

# Mechanics

Jelaskan gameplay dan sistem inti di sini.

## Core Loop

## Combat

## Progression

# Characters

Deskripsikan karakter-karakter utama di sini.

## Protagonist

## Antagonist

## Supporting

# Levels

Rincikan level-level atau chapter di sini.

## Chapter 1

## Chapter 2

# Assets

Daftar aset yang dibutuhkan (art, sound, code).

## Art

## Audio

## Code`;

/**
 * Buat page Notion baru dengan template GDD
 * Parent page: halaman utama atau dashboard GDD
 */
export async function createGDDPage(title, apiKey, parentPageId) {
  const templateBlocks = markdownToBlocks(GDD_TEMPLATE);

  const body = {
    parent: { type: 'page_id', page_id: parentPageId },
    properties: {
      title: {
        title: [{ type: 'text', text: { content: title } }],
      },
    },
    children: templateBlocks,
  };

  const data = await notionFetch(
    `${BASE_URL}/pages`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    apiKey,
  );

  return {
    id: data.id,
    title,
    url: data.url,
    blockCount: templateBlocks.length,
  };
}

/**
 * Archive (soft-delete) halaman Notion — PATCH /v1/pages/{pageId} dengan archived:true
 */
export async function archivePage(pageId, apiKey) {
  const data = await notionFetch(
    `${BASE_URL}/pages/${pageId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    },
    apiKey,
  );

  return {
    id: data.id,
    archived: data.archived,
    title: extractPageTitle(data),
    url: data.url,
  };
}

/**
 * Search Notion pages shared with integration
 */
export async function searchPages(query, apiKey) {
  const data = await notionFetch(
    `${BASE_URL}/search`,
    {
      method: 'POST',
      body: JSON.stringify({
        query,
        filter: { value: 'page', property: 'object' },
        page_size: 20,
      }),
    },
    apiKey,
  );

  return data.results.map((page) => ({
    id: page.id,
    title: extractPageTitle(page),
    url: page.url,
    lastEdited: page.last_edited_time,
  }));
}

function extractPageTitle(page) {
  const props = page.properties || {};
  const titleProp = Object.values(props).find((p) => p.type === 'title');
  if (titleProp?.title?.[0]?.plain_text) {
    return titleProp.title[0].plain_text;
  }
  return 'Untitled';
}

/**
 * Parse markdown menjadi sections (sama kayak parseGDD di server.js)
 */
export function parseMarkdownSections(markdown) {
  const lines = markdown.split('\n');
  const sections = [];
  let currentSection = null;
  let currentContent = [];

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      if (currentSection) {
        currentSection.content = currentContent.join('\n').trim();
        sections.push(currentSection);
      }
      currentSection = {
        level: headerMatch[1].length,
        title: headerMatch[2].trim(),
        header: line,
      };
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  if (currentSection) {
    currentSection.content = currentContent.join('\n').trim();
    sections.push(currentSection);
  }

  return sections;
}
