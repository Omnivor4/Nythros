// src/tools/visionTool.js
import { runPythonScript, detectPython } from '../utils/pythonBridge.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, '../../scripts/analyze_image.py');

// Cache deteksi Python
let pythonAvailable = null;

export const analyzeImageTool = {
  name: 'analyze_image',
  description: 'Analisis file gambar lokal dan ekstrak informasi: dimensi, format, warna dominan, brightness, dan teks (kalau ada). Gunakan saat user melampirkan path gambar dan kamu perlu tahu isi/karakteristik gambar tersebut tanpa vision API. Requires Python + Pillow.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path absolut atau relatif ke file gambar (.png, .jpg, .jpeg, .gif, .webp, .bmp)'
      }
    },
    required: ['path']
  },
  execute: async ({ path: imagePath }) => {
    // Cek Python tersedia (cached)
    if (pythonAvailable === null) {
      pythonAvailable = await detectPython();
    }

    if (!pythonAvailable) {
      return '❌ Python tidak ditemukan di system. Install Python 3.x dan Pillow (pip install Pillow) untuk menggunakan fitur analisis gambar.';
    }

    // Resolve path relatif ke cwd
    const resolvedPath = path.isAbsolute(imagePath)
      ? imagePath
      : path.join(process.cwd(), imagePath);

    if (!existsSync(resolvedPath)) {
      return `File tidak ditemukan: ${resolvedPath}`;
    }

    try {
      const result = await runPythonScript(SCRIPT_PATH, { path: resolvedPath }, {
        timeout: 15000,
        pythonCmd: pythonAvailable.cmd
      });

      if (!result.success) {
        return `Gagal menganalisis gambar: ${result.error}`;
      }

      const d = result.data;
      if (d.error) return `Error: ${d.error}`;

      const lines = [
        `📸 Analisis Gambar: ${d.filename}`,
        `   Format   : ${d.format} (${d.mode})`,
        `   Dimensi  : ${d.width} × ${d.height} px`,
        `   Ukuran   : ${d.size_kb} KB`,
        d.brightness !== undefined
          ? `   Brightness: ${d.brightness}% (${d.is_dark ? 'gelap' : 'terang'})`
          : null,
        d.dominant_colors?.length
          ? `   Warna dominan: ${d.dominant_colors.join(', ')}`
          : null,
        d.detected_text
          ? `   Teks terdeteksi: "${d.detected_text.substring(0, 200)}${d.detected_text.length > 200 ? '...' : ''}"`
          : null,
      ].filter(Boolean);

      return lines.join('\n');
    } catch (err) {
      return `❌ Error saat analisis gambar: ${err.message}`;
    }
  }
};
