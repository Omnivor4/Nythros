// src/utils/pythonBridge.js
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Deteksi python executable yang tersedia di system.
 * Coba python3 dulu, fallback ke python.
 */
export async function detectPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      const result = await runPython(cmd, ['-c', 'import sys; print(sys.version)']);
      if (result.success) return { cmd, version: result.stdout.trim() };
    } catch (e) { /* coba berikutnya */ }
  }
  return null;
}

/**
 * Jalankan Python script file dengan argumen JSON.
 * Script harus baca JSON dari stdin dan print JSON ke stdout.
 * @param {string} scriptPath - path ke .py file
 * @param {object} inputData - data yang di-JSON.stringify ke stdin
 * @param {object} options - { timeout, pythonCmd }
 */
export async function runPythonScript(scriptPath, inputData = {}, options = {}) {
  const pythonCmd = options.pythonCmd || 'python3';
  const timeout = options.timeout || 30000;

  if (!existsSync(scriptPath)) {
    return { success: false, error: `Script tidak ditemukan: ${scriptPath}` };
  }

  return new Promise((resolve) => {
    const proc = spawn(pythonCmd, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      resolve({ success: false, error: `Python script timeout setelah ${timeout}ms` });
    }, timeout);

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.stdin.write(JSON.stringify(inputData));
    proc.stdin.end();

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;

      if (code !== 0) {
        resolve({ success: false, error: stderr || `Exit code ${code}` });
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve({ success: true, data: parsed });
      } catch (e) {
        // Script print plain text, bukan JSON
        resolve({ success: true, data: { text: stdout }, raw: stdout });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Jalankan perintah Python inline (-c "...").
 */
export async function runPython(cmd, args, inputData = null) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    if (inputData) {
      proc.stdin.write(typeof inputData === 'string' ? inputData : JSON.stringify(inputData));
    }
    proc.stdin.end();

    proc.on('close', (code) => {
      resolve({ success: code === 0, stdout, stderr, code });
    });
    proc.on('error', (err) => {
      resolve({ success: false, error: err.message, stdout: '', stderr: '' });
    });
  });
}
