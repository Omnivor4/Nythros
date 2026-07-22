import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../shared/config.js';

// PENTING: search di sini SENGAJA plain text matching (filename + isi +
// tag frontmatter), BUKAN embedding/semantic search. Ini batas yang harus
// dijaga sesuai filosofi Nythros (lihat CLAUDE.md §6) — kalau mau upgrade
// ke semantic search pakai vector DB, itu keputusan terpisah yang harus
// didiskusikan dulu, jangan nyelip diam-diam di sini.

const AGENT_SUBFOLDER = 'Nythros'; // note hasil agent ditaro sini, bukan campur ke root vault

function getVaultPath() {
  const config = loadConfig();
  if (!config.obsidianVaultPath) {
    throw new Error(
      'Obsidian vault belum di-configure. Jalanin: nythros config set --obsidian-vault "<path-vault-kamu>"',
    );
  }
  if (!fs.existsSync(config.obsidianVaultPath)) {
    // Feature 8 & Bug 16: Automatic Vault initialization
    try {
      fs.mkdirSync(config.obsidianVaultPath, { recursive: true });
    } catch (err) {
      throw new Error(
        `Gagal membuat folder vault di "${config.obsidianVaultPath}": ${err.message}`,
        { cause: err },
      );
    }
  }
  return config.obsidianVaultPath;
}

// Bug 43: Deep Recursion Stack Overflow (Replaced with iterative stack)
function walkVault(dir) {
  let results = [];
  let stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    const list = fs.readdirSync(current, { withFileTypes: true });
    for (const d of list) {
      if (d.name.startsWith('.') || d.name === 'node_modules') continue;
      const full = path.join(current, d.name);
      if (d.isDirectory()) {
        stack.push(full);
      } else if (d.name.endsWith('.md')) {
        results.push(full);
      }
    }
  }
  return results;
}

function extractWikilinks(content) {
  const re = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
  const links = [];
  let m;
  while ((m = re.exec(content)) !== null) links.push(m[1].trim());
  return links;
}

export function searchVault(query) {
  const vaultPath = getVaultPath();
  const q = query.toLowerCase();
  const results = [];

  for (const file of walkVault(vaultPath)) {
    // Bug 41: OOM Risk 2 (Limit total matches)
    if (results.length >= 50) break;

    const stat = fs.statSync(file);
    if (stat.size > 1024 * 1024) continue; // Skip files > 1MB to prevent OOM
    const content = fs.readFileSync(file, 'utf-8');
    const filename = path.basename(file, '.md');
    if (
      content.toLowerCase().includes(q) ||
      filename.toLowerCase().includes(q) ||
      file.toLowerCase().includes(q)
    ) {
      results.push({
        name: filename,
        path: path.relative(vaultPath, file),
        snippet: content.substring(0, 150).replace(/\n/g, ' ') + '...',
      });
    }
  }
  return results;
}

function findNoteFile(vaultPath, name) {
  const target = name.toLowerCase().replace(/\.md$/, '');
  const allFiles = walkVault(vaultPath);

  // Prefer exact relative path match first
  const exactMatch = allFiles.find((f) =>
    path.relative(vaultPath, f).toLowerCase().replace(/\\/g, '/').includes(target),
  );
  if (exactMatch) return exactMatch;

  const match = allFiles.find((f) => path.basename(f, '.md').toLowerCase() === target);
  return match || null;
}

export function readNote(name) {
  const vaultPath = getVaultPath();
  const file = findNoteFile(vaultPath, name);
  if (!file) return `Error: note "${name}" tidak ditemukan di vault.`;
  const content = fs.readFileSync(file, 'utf-8');
  const links = extractWikilinks(content);
  return links.length > 0 ? `${content}\n\n(Note ini nge-link ke: ${links.join(', ')})` : content;
}

export function writeNote(name, content) {
  const vaultPath = getVaultPath();
  const folder = path.join(vaultPath, AGENT_SUBFOLDER);
  fs.mkdirSync(folder, { recursive: true });

  let finalName = name;
  let filePath = path.join(folder, `${finalName}.md`);
  let counter = 1;
  // Bug 40: O(N) Duplikasi Note (Fast checking using fs instead of walking the whole vault)
  while (fs.existsSync(filePath)) {
    finalName = `${name}_${counter}`;
    filePath = path.join(folder, `${finalName}.md`);
    counter++;
  }

  fs.writeFileSync(filePath, content);
  return `Note "${finalName}" tersimpan di vault, folder ${AGENT_SUBFOLDER}/.`;
}

export const obsidianSearchTool = {
  name: 'obsidian_search',
  description:
    'Cari note di Obsidian vault berdasarkan kata kunci (cocok di nama file, isi, atau tag).',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  execute: ({ query }) => {
    try {
      const results = searchVault(query);
      if (results.length === 0) return `Nggak ada note yang cocok sama "${query}".`;
      return results
        .map(
          (r) =>
            `- ${r.name} (${r.path})${r.links.length ? ` -> link ke: ${r.links.join(', ')}` : ''}`,
        )
        .join('\n');
    } catch (err) {
      return `Error: ${err.message}`;
    }
  },
};

export const obsidianReadTool = {
  name: 'obsidian_read_note',
  description: 'Baca isi lengkap satu note di Obsidian vault berdasarkan namanya.',
  input_schema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Nama note, tanpa ekstensi .md' } },
    required: ['name'],
  },
  execute: ({ name }) => {
    try {
      return readNote(name);
    } catch (err) {
      return `Error: ${err.message}`;
    }
  },
};

export const obsidianWriteTool = {
  name: 'obsidian_write_note',
  description: `Tulis note baru ke Obsidian vault (otomatis masuk folder ${AGENT_SUBFOLDER}/, nggak campur sama note manual kamu).`,
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Judul note, tanpa ekstensi .md' },
      content: { type: 'string', description: 'Isi note, format Markdown' },
    },
    required: ['name', 'content'],
  },
  execute: ({ name, content }) => {
    try {
      return writeNote(name, content);
    } catch (err) {
      return `Error: ${err.message}`;
    }
  },
};

export function isVaultConfigured() {
  const config = loadConfig();
  return Boolean(config.obsidianVaultPath);
}

export function appendChatLog(input, output) {
  if (!isVaultConfigured()) return;
  try {
    const vaultPath = getVaultPath();
    const folder = path.join(vaultPath, AGENT_SUBFOLDER, 'Logs');
    fs.mkdirSync(folder, { recursive: true });

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS

    const filePath = path.join(folder, `Chat_${dateStr}.md`);
    const isNew = !fs.existsSync(filePath);

    // Bug 42: Object Tool Result Crash
    const outStr = typeof output === 'string' ? output : JSON.stringify(output, null, 2);

    // Escape code blocks to avoid breaking markdown formatting
    const safeInput = input.includes('```') ? `\n~~~markdown\n${input}\n~~~\n` : input;
    const safeOutput = outStr.includes('```') ? `\n~~~markdown\n${outStr}\n~~~\n` : outStr;

    let logContent = `\n## [${timeStr}]\n**User**: ${safeInput}\n\n**Nythros**:\n${safeOutput}\n`;

    if (isNew) {
      logContent = `# Chat Log ${dateStr}\n\n[[Nythros CLI]] [[Log Percakapan]]\n` + logContent;
    }

    fs.appendFileSync(filePath, logContent);
  } catch (err) {
    // Fail silently, it's just a log
    console.error(`Gagal menulis log ke Obsidian: ${err.message}`);
  }
}
