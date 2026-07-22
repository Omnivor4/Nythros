import fs from 'node:fs';
import path from 'node:path';
import exceljs from 'exceljs';
import * as docx from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { safeError } from '../shared/utils/error.js';

export const generateDocxTool = {
  name: 'generate_docx',
  description:
    'Buat file dokumen Microsoft Word (.docx) dengan format teks dasar (heading & paragraf). Cocok untuk laporan tugas.',
  input_schema: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: "Nama file output (misal: 'laporan.docx')" },
      title: { type: 'string', description: 'Judul utama dokumen' },
      content: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['heading', 'paragraph'],
              description: 'Jenis blok teks',
            },
            text: { type: 'string', description: 'Isi teks' },
          },
          required: ['type', 'text'],
        },
        description: 'Daftar blok konten (heading/paragraph)',
      },
    },
    required: ['filename', 'title', 'content'],
  },
  execute: async ({ filename, title, content }) => {
    try {
      const p = path.resolve(process.cwd(), filename);

      const children = [
        new docx.Paragraph({
          text: title,
          heading: docx.HeadingLevel.HEADING_1,
        }),
      ];

      for (const block of content) {
        if (block.type === 'heading') {
          children.push(
            new docx.Paragraph({
              text: block.text,
              heading: docx.HeadingLevel.HEADING_2,
            }),
          );
        } else {
          children.push(
            new docx.Paragraph({
              text: block.text,
            }),
          );
        }
      }

      const doc = new docx.Document({
        sections: [{ properties: {}, children }],
      });

      const buffer = await docx.Packer.toBuffer(doc);
      fs.writeFileSync(p, buffer);

      return `Dokumen Word berhasil dibuat dan disimpan di "${filename}".`;
    } catch (err) {
      return `Error membuat DOCX: ${safeError(err)}`;
    }
  },
};

export const generateXlsxTool = {
  name: 'generate_xlsx',
  description:
    'Ekspor data ke format Excel (.xlsx). Cocok untuk balance tracker atau data tabular.',
  input_schema: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: "Nama file output (misal: 'tracker.xlsx')" },
      sheetName: { type: 'string', description: "Nama sheet (opsional, default: 'Sheet1')" },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Daftar header kolom',
      },
      rows: {
        type: 'array',
        items: {
          type: 'array',
          items: { type: 'string' },
        },
        description: 'Daftar baris data',
      },
    },
    required: ['filename', 'columns', 'rows'],
  },
  execute: async ({ filename, sheetName = 'Sheet1', columns, rows }) => {
    try {
      const p = path.resolve(process.cwd(), filename);
      const workbook = new exceljs.Workbook();
      const worksheet = workbook.addWorksheet(sheetName);

      worksheet.columns = columns.map((col) => ({ header: col, key: col }));
      worksheet.addRows(rows);

      await workbook.xlsx.writeFile(p);
      return `File Excel berhasil dibuat dan disimpan di "${filename}" dengan ${rows.length} baris data.`;
    } catch (err) {
      return `Error membuat XLSX: ${safeError(err)}`;
    }
  },
};

export const generatePdfTool = {
  name: 'generate_pdf',
  description: 'Buat file PDF sederhana dengan teks statis.',
  input_schema: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: "Nama file output (misal: 'dokumen.pdf')" },
      text: { type: 'string', description: 'Isi teks PDF (mendukung multiline/baris baru)' },
    },
    required: ['filename', 'text'],
  },
  execute: async ({ filename, text }) => {
    try {
      const p = path.resolve(process.cwd(), filename);
      const pdfDoc = await PDFDocument.create();
      let page = pdfDoc.addPage();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const lines = text.split('\n');
      let y = page.getHeight() - 50;
      const x = 50;

      for (const line of lines) {
        if (y < 50) {
          page = pdfDoc.addPage();
          y = page.getHeight() - 50;
        }
        page.drawText(line, { x, y, size: 12, font, color: rgb(0, 0, 0) });
        y -= 20; // line height
      }

      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(p, pdfBytes);

      return `Dokumen PDF berhasil dibuat dan disimpan di "${filename}".`;
    } catch (err) {
      return `Error membuat PDF: ${safeError(err)}`;
    }
  },
};
