import { spawn, exec } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';

/**
 * Menjalankan command di dalam container Docker ephemeral
 *
 * @param {string} command Command shell yang ingin dieksekusi
 * @param {object} options Konfigurasi
 * @param {string} options.projectRoot Path root proyek yang akan di-mount
 * @param {string} options.image Image docker yang akan digunakan
 * @param {boolean} options.network Apakah network diaktifkan
 * @param {number} options.timeoutMs Timeout eksekusi dalam ms
 * @returns {Promise<string>} Output stdout/stderr dari eksekusi
 */
export async function runInDocker(
  command,
  {
    projectRoot = process.cwd(),
    image = 'node:20-bookworm-slim',
    network = false,
    timeoutMs = 60000,
  } = {},
) {
  return new Promise((resolve, reject) => {
    // C. Beri nama container eksplisit untuk timeout yang reliable
    const containerName = `nythros-sbx-${crypto.randomUUID()}`;
    const workspacePath = '/workspace';

    // Default network: --network none
    const networkArg = network ? 'bridge' : 'none';

    // A. Celah command-injection: bangun argv sebagai array
    // D. Non-root execution: --user 1000:1000 (standard first user in many distros)
    // B. Tambahkan --pids-limit 256
    const args = [
      'run',
      '--rm', // ephemeral
      '--name',
      containerName,
      '--network',
      networkArg,
      '-v',
      `${path.resolve(projectRoot)}:${workspacePath}`,
      '-w',
      workspacePath,
      '--cpus',
      '1',
      '--memory',
      '512m',
      '--pids-limit',
      '256',
      '--user',
      '1000:1000',
      image,
      'sh',
      '-c',
      command,
    ];

    let output = '';
    let isFinished = false;

    // Spawn docker process
    const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const MAX_BUFFER = 2 * 1024 * 1024; // 2MB max buffer

    proc.stdout.on('data', (data) => {
      if (output.length < MAX_BUFFER) {
        output += data.toString();
      }
    });

    proc.stderr.on('data', (data) => {
      if (output.length < MAX_BUFFER) {
        output += data.toString();
      }
    });

    // Timeout logic
    const timeoutId = setTimeout(() => {
      if (isFinished) return;
      isFinished = true;
      output += `\n[ERROR]\nCommand timed out after ${timeoutMs / 1000} seconds. Killing container...`;

      try {
        // C. Explicitly kill the container (non-blocking)
        exec(`docker kill ${containerName}`, () => {});
      } catch {
        // Abaikan jika container sudah mati
      }

      resolve(output);
    }, timeoutMs);

    proc.on('error', (err) => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timeoutId);

      if (err.code === 'ENOENT') {
        reject(
          new Error(
            'Docker daemon tidak ditemukan (docker command missing). Pastikan Docker terinstall dan berjalan.',
          ),
        );
      } else {
        reject(new Error(`Docker execution error: ${err.message}`));
      }
    });

    proc.on('close', (code) => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timeoutId);

      if (code !== 0) {
        output += `\n[ERROR]\nExit code: ${code}`;
      }
      resolve(output);
    });
  });
}
