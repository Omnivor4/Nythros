// src/tools/pythonExecutor.js
// Menggantikan implementasi lama yang pakai exec() langsung.
// Sekarang pakai pythonBridge + scripts/python_sandbox.py untuk
// sandboxed execution dengan timeout dan limited env.
import { runPythonScript, detectPython } from '../utils/pythonBridge.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX_SCRIPT = path.join(__dirname, '../../scripts/python_sandbox.py');

// Cache deteksi Python supaya tidak cek ulang tiap call
let pythonAvailable = null;

export const executePythonTool = {
  name: 'execute_python',
  description: 'Jalankan kode Python dan return hasilnya (stdout/stderr). Gunakan untuk: kalkulasi, data processing, analisis file, atau verifikasi kode Python yang baru dibuat. Kode dijalankan di subprocess terpisah dengan timeout 30 detik. ⚠️ PERINGATAN: Kode dijalankan sungguhan di komputer user — bukan sandbox sempurna.',
  input_schema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Kode Python yang akan dijalankan'
      },
      timeout: {
        type: 'number',
        description: 'Timeout dalam detik (default: 10, max: 30)'
      }
    },
    required: ['code']
  },
  execute: async ({ code, timeout = 10 }) => {
    // Cek Python tersedia (cached)
    if (pythonAvailable === null) {
      pythonAvailable = await detectPython();
    }

    if (!pythonAvailable) {
      return '❌ Python tidak ditemukan di system. Install Python 3.x untuk menggunakan fitur ini.';
    }

    try {
      const result = await runPythonScript(SANDBOX_SCRIPT, {
        code,
        timeout: Math.min(timeout, 30),
        working_dir: process.cwd()
      }, {
        timeout: (Math.min(timeout, 30) + 5) * 1000, // sedikit lebih lama dari Python timeout
        pythonCmd: pythonAvailable.cmd
      });

      if (!result.success) {
        return `❌ Gagal menjalankan Python: ${result.error}`;
      }

      const d = result.data;
      if (d.error) return `❌ Error: ${d.error}`;

      const lines = [];

      if (d.stdout) {
        lines.push(`✅ Output (${d.exec_time_ms}ms):\n${d.stdout}`);
      }
      if (d.stderr) {
        lines.push(`⚠️  Error:\n${d.stderr}`);
      }
      if (!d.stdout && !d.stderr) {
        lines.push(`✅ Selesai tanpa output (${d.exec_time_ms}ms)`);
      }
      if (!d.success) {
        lines.push(`❌ Exit code: ${d.return_code}`);
      }

      return lines.join('\n\n');
    } catch (err) {
      return `❌ Error saat menjalankan Python: ${err.message}`;
    }
  }
};

// Export default untuk backward compatibility dengan kode lama
// yang import `pythonExecutor` default
export default { executePythonTool };
