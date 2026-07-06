import fs from "node:fs";
import path from "node:path";
import exceljs from "exceljs";

/**
 * Extracts a specific section from a markdown file (GDD).
 */
export const readGddTool = {
  name: "read_gdd",
  description: "Baca file Game Design Document (GDD.md) dan ambil bagian (section) yang relevan berdasarkan judul section/keyword, untuk menghindari melempar seluruh file besar ke dalam memori.",
  input_schema: {
    type: "object",
    properties: {
      section: { type: "string", description: "Judul section markdown (tanpa '#'), contoh: 'Mechanics', 'Characters', 'Story'" },
      filename: { type: "string", description: "Nama file GDD, default: 'GDD.md'" }
    },
    required: ["section"],
  },
  execute: async ({ section, filename = "GDD.md" }) => {
    const p = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(p)) {
      return `Error: File GDD "${filename}" tidak ditemukan di direktori saat ini.`;
    }

    try {
      const content = fs.readFileSync(p, "utf-8");
      const lines = content.split('\n');
      
      let inSection = false;
      let sectionLevel = 0;
      const extractedLines = [];

      for (const line of lines) {
        const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
        
        if (headerMatch) {
          const level = headerMatch[1].length;
          const title = headerMatch[2].trim();

          if (inSection) {
            // Stop if we reach a header of the SAME or HIGHER level (lower number)
            if (level <= sectionLevel) {
              break;
            }
            extractedLines.push(line);
          } else {
            // Check if this header matches the requested section (case-insensitive partial match)
            if (title.toLowerCase().includes(section.toLowerCase())) {
              inSection = true;
              sectionLevel = level;
              extractedLines.push(line);
            }
          }
        } else if (inSection) {
          extractedLines.push(line);
        }
      }

      if (extractedLines.length === 0) {
        return `Bagian "${section}" tidak ditemukan di dalam ${filename}.`;
      }

      return extractedLines.join('\n');
    } catch (err) {
      return `Error membaca GDD: ${err.message}`;
    }
  },
};

/**
 * Reads a balance tracker (CSV/XLSX) and extracts structured data.
 */
export const readBalanceTool = {
  name: "read_balance",
  description: "Baca file tracker keseimbangan entitas/game (entity-balance tracker) berformat CSV atau XLSX.",
  input_schema: {
    type: "object",
    properties: {
      filename: { type: "string", description: "Nama file balance (misal: 'balance.csv' atau 'tracker.xlsx')" },
      sheetName: { type: "string", description: "(Opsional) Nama sheet untuk file XLSX" },
      maxRows: { type: "number", description: "Maksimal baris yang dibaca (default: 100)" }
    },
    required: ["filename"],
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
          // values array is 1-indexed in exceljs, index 0 is undefined
          const rowData = row.values.slice(1).map(val => val !== undefined && val !== null ? String(val).trim() : "");
          rows.push(rowData.join(' | '));
        }
      });

      if (worksheet.rowCount > maxRows) {
        rows.push(`... [${worksheet.rowCount - maxRows} baris lainnya disembunyikan] ...`);
      }

      return `[Isi file ${filename} - Sheet: ${worksheet.name}]\n` + rows.join('\n');
    } catch (err) {
      return `Error membaca file balance: ${err.message}`;
    }
  },
};
