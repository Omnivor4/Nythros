import fs from 'node:fs';
import path from 'node:path';
import exceljs from 'exceljs';
import { loadConfig } from '../shared/config.js';
import { safeError } from '../shared/utils/error.js';
import {
  readPageAsMarkdown,
  parseMarkdownSections,
  markdownToBlocks,
  updatePageBlocks,
} from '../integrations/notion.js';

/**
 * Helper: extract a specific section from markdown by header title
 */
function extractSection(markdown, sectionTitle) {
  const lines = markdown.split('\n');
  let inSection = false;
  let sectionLevel = 0;
  const extractedLines = [];

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const title = headerMatch[2].trim();

      if (inSection) {
        if (level <= sectionLevel) break;
        extractedLines.push(line);
      } else {
        if (title.toLowerCase().includes(sectionTitle.toLowerCase())) {
          inSection = true;
          sectionLevel = level;
          extractedLines.push(line);
        }
      }
    } else if (inSection) {
      extractedLines.push(line);
    }
  }

  return extractedLines.join('\n').trim();
}

/**
 * Extracts a specific section from a local markdown file (GDD).
 */
export const readGddTool = {
  name: 'read_gdd',
  description:
    'Baca file Game Design Document (GDD.md) lokal dan ambil bagian (section) yang relevan berdasarkan judul section/keyword.',
  input_schema: {
    type: 'object',
    properties: {
      section: {
        type: 'string',
        description:
          "Judul section markdown (tanpa '#'), contoh: 'Mechanics', 'Characters', 'Story'",
      },
      filename: { type: 'string', description: "Nama file GDD, default: 'GDD.md'" },
    },
    required: ['section'],
  },
  execute: async ({ section, filename = 'GDD.md' }) => {
    const p = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(p)) {
      return `Error: File GDD "${filename}" tidak ditemukan di direktori saat ini.`;
    }

    try {
      const content = fs.readFileSync(p, 'utf-8');
      const result = extractSection(content, section);
      if (!result) {
        return `Bagian "${section}" tidak ditemukan di dalam ${filename}.`;
      }
      return result;
    } catch (err) {
      return `Error membaca GDD: ${safeError(err)}`;
    }
  },
};

/**
 * Reads a balance tracker (CSV/XLSX) and extracts structured data.
 */
export const readBalanceTool = {
  name: 'read_balance',
  description:
    'Baca file tracker keseimbangan entitas/game (entity-balance tracker) berformat CSV atau XLSX.',
  input_schema: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: "Nama file balance (misal: 'balance.csv' atau 'tracker.xlsx')",
      },
      sheetName: { type: 'string', description: '(Opsional) Nama sheet untuk file XLSX' },
      maxRows: { type: 'number', description: 'Maksimal baris yang dibaca (default: 100)' },
    },
    required: ['filename'],
  },
  execute: async ({ filename, sheetName, maxRows = 100 }) => {
    const p = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(p)) {
      return `Error: File balance "${filename}" tidak ditemukan di direktori saat ini.`;
    }

    try {
      const ext = path.extname(filename).toLowerCase();
      const workbook = new exceljs.Workbook();

      if (ext === '.csv') {
        await workbook.csv.readFile(p);
      } else if (ext === '.xlsx') {
        await workbook.xlsx.readFile(p);
      } else {
        return `Error: Format file "${ext}" tidak didukung. Harap gunakan CSV atau XLSX.`;
      }

      const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];

      if (!worksheet) {
        return `Error: Sheet tidak ditemukan dalam file.`;
      }

      const rows = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber <= maxRows) {
          const rowData = row.values
            .slice(1)
            .map((val) => (val !== undefined && val !== null ? String(val).trim() : ''));
          rows.push(rowData.join(' | '));
        }
      });

      if (worksheet.rowCount > maxRows) {
        rows.push(`... [${worksheet.rowCount - maxRows} baris lainnya disembunyikan] ...`);
      }

      return `[Isi file ${filename} - Sheet: ${worksheet.name}]\n` + rows.join('\n');
    } catch (err) {
      return `Error membaca file balance: ${safeError(err)}`;
    }
  },
};

/**
 * Read GDD from Notion page instead of local file.
 */
export const readGddNotionTool = {
  name: 'read_gdd_notion',
  description:
    'Baca Game Design Document dari Notion — ambil seluruh halaman atau section tertentu. Butuh Notion API key dan page ID di config (notion.api_key + notion.gdd_page_id).',
  input_schema: {
    type: 'object',
    properties: {
      section: {
        type: 'string',
        description:
          '(Opsional) Judul section yang mau dibaca. Kosongkan untuk baca seluruh halaman.',
      },
      pageId: {
        type: 'string',
        description: '(Opsional) Notion page ID. Default: pakai notion.gdd_page_id dari config.',
      },
    },
    required: [],
  },
  execute: async ({ section, pageId } = {}) => {
    const config = loadConfig();
    const apiKey = config.notion?.api_key;
    const gddPageId = pageId || config.notion?.gdd_page_id;

    if (!apiKey) return "Error: Notion API key belum di-set. Set 'notion.api_key' di config.";
    if (!gddPageId)
      return "Error: Notion GDD page ID belum di-set. Set 'notion.gdd_page_id' di config atau kirim pageId langsung.";

    try {
      const { title, markdown, blocks } = await readPageAsMarkdown(gddPageId, apiKey);
      const sections = parseMarkdownSections(markdown);
      if (section) {
        const found = extractSection(markdown, section);
        if (!found) {
          return `Bagian "${section}" tidak ditemukan di halaman Notion "${title}".`;
        }
        return `📄 **${title}** — Bagian: ${section}\n\n${found}`;
      }

      // Return full page with section list
      const sectionList = sections
        .map((s) => {
          const indent = '  '.repeat(s.level - 1);
          return `${indent}${s.header} (${s.content.split('\n').length} lines)`;
        })
        .join('\n');

      return `📄 **${title}** (dari Notion)\n${blocks.length} blocks, ${sections.length} sections\n\n## Daftar Section\n${sectionList}\n\n---\n\n${markdown.slice(0, 6000)}${markdown.length > 6000 ? '\n\n...[TRUNCATED]...' : ''}`;
    } catch (err) {
      return `Error membaca Notion GDD: ${safeError(err)}`;
    }
  },
};

/**
 * Write/update GDD section to Notion page.
 */
export const writeGddNotionTool = {
  name: 'write_gdd_notion',
  description:
    'Update section tertentu di halaman GDD Notion, atau tulis markdown baru ke seluruh halaman. Butuh Notion API key dan page ID di config.',
  input_schema: {
    type: 'object',
    properties: {
      markdown: {
        type: 'string',
        description: 'Full markdown content untuk di-sync ke Notion (mengganti seluruh page)',
      },
      section: {
        type: 'string',
        description:
          '(Opsional) Judul section spesifik yang di-update. Kosongkan untuk replace seluruh halaman.',
      },
      newContent: {
        type: 'string',
        description: '(Required kalo section diisi) Konten baru untuk section tersebut.',
      },
      pageId: {
        type: 'string',
        description: '(Opsional) Notion page ID. Default: pakai notion.gdd_page_id dari config.',
      },
    },
    required: [],
  },
  execute: async ({ markdown, section, newContent, pageId } = {}) => {
    const config = loadConfig();
    const apiKey = config.notion?.api_key;
    const gddPageId = pageId || config.notion?.gdd_page_id;

    if (!apiKey) return 'Error: Notion API key belum di-set.';
    if (!gddPageId) return 'Error: Notion GDD page ID belum di-set.';

    try {
      let finalMarkdown = markdown;

      if (section) {
        // Update specific section: read existing, replace section, rebuild
        if (newContent === undefined) {
          return "Error: 'newContent' diperlukan kalau 'section' diisi.";
        }
        const { markdown: existingMd } = await readPageAsMarkdown(gddPageId, apiKey);
        const sections = parseMarkdownSections(existingMd);

        const targetSection = sections.find(
          (s) =>
            s.title.toLowerCase() === section.toLowerCase() ||
            s.title.toLowerCase().includes(section.toLowerCase()),
        );
        if (!targetSection) {
          return `Error: Section "${section}" tidak ditemukan di halaman Notion.`;
        }

        // Rebuild markdown with updated section content
        finalMarkdown = sections
          .map((s) => {
            if (s === targetSection) {
              return s.header + '\n' + newContent.trim();
            }
            return s.header + '\n' + s.content;
          })
          .join('\n\n');
      }

      if (!finalMarkdown) {
        return "Error: Tidak ada konten yang diberikan. Kirim 'markdown' untuk replace seluruh page, atau 'section' + 'newContent' untuk update spesifik.";
      }

      const blocks = markdownToBlocks(finalMarkdown);
      if (blocks.length === 0) {
        return 'Error: Markdown kosong — tidak ada blocks yang bisa di-sync.';
      }

      const result = await updatePageBlocks(gddPageId, apiKey, blocks);

      return `✅ GDD Notion berhasil di-update!\n  - Blocks dihapus: ${result.deleted}\n  - Blocks baru: ${result.appended}\n  - Total blocks: ${result.deleted + result.appended}`;
    } catch (err) {
      return `Error update Notion GDD: ${safeError(err)}`;
    }
  },
};
