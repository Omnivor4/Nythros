// src/presentation/doctor.js
// Nythros Doctor — diagnostic command buat ngecek kesehatan instalasi
// Jalanin: nythros doctor [--fix] [--json] [--verbose]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { loadConfig, saveConfig } from '../shared/config.js';
import { HOME_DIR, PROJECT_DIR, ensureHomeDirs } from '../shared/utils/paths.js';

// ── Prompt helper ────────────────────────────────────────────
function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Color helpers ──────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function icon(status) {
  if (status === 'ok') return `${C.green}✓${C.reset}`;
  if (status === 'warn') return `${C.yellow}⚠${C.reset}`;
  if (status === 'err') return `${C.red}✗${C.reset}`;
  return `${C.dim}·${C.reset}`;
}

function label(text, color = C.cyan) {
  return `${color}${C.bold}${text}${C.reset}`;
}

function indent(text, spaces = 2) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

// ── Checks ────────────────────────────────────────────────────

function checkSystem() {
  const checks = [];
  const memGB = Math.round(os.totalmem() / 1024 / 1024 / 1024);
  const freeMemGB = Math.round(os.freemem() / 1024 / 1024 / 1024);
  const freePercent = Math.round((os.freemem() / os.totalmem()) * 100);

  checks.push({
    status: 'ok',
    msg: `Node.js ${process.version} on ${process.platform} (${os.arch()})`,
  });
  checks.push({
    status: 'ok',
    msg: `${os.cpus().length} CPU core, ${memGB}GB RAM (${freeMemGB}GB free, ${freePercent}%)`,
  });

  return checks;
}

function checkHomeDir() {
  const checks = [];

  if (fs.existsSync(HOME_DIR)) {
    checks.push({ status: 'ok', msg: `Home dir ${HOME_DIR}` });
  } else {
    checks.push({
      status: 'err',
      msg: `Home dir ${HOME_DIR} tidak ditemukan. Jalankan 'nythros setup' atau 'nythros doctor --fix'.`,
    });
    return checks;
  }

  const skillRegistry = path.join(HOME_DIR, 'skill-registry.json');
  if (fs.existsSync(skillRegistry)) {
    checks.push({ status: 'ok', msg: 'Skill registry ada' });
  }

  return checks;
}

function checkConfig(config) {
  const checks = [];

  if (!config.endpoints || config.endpoints.length === 0) {
    checks.push({ status: 'err', msg: "Tidak ada endpoint terdaftar. Jalankan 'nythros setup'." });
    return checks;
  }

  config.endpoints.forEach((ep, i) => {
    const name = ep.name || ep.id || `Endpoint #${i + 1}`;
    const issues = [];

    if (!ep.base_url) issues.push('base_url kosong');
    if (!ep.api_key) issues.push('api_key kosong');
    if (!ep.model) issues.push('model kosong (opsional)');

    if (issues.length === 0) {
      checks.push({
        status: 'ok',
        msg: `${name}: ${ep.base_url} → ${ep.model || '(model tidak diset)'}`,
      });
    } else {
      checks.push({ status: 'warn', msg: `${name}: ${issues.join(', ')}` });
    }
  });

  if (config.routing) {
    const routes = [];
    if (config.routing.default_model) routes.push(`default → ${config.routing.default_model}`);
    if (config.routing.fast_model) routes.push(`fast → ${config.routing.fast_model}`);
    if (config.routing.code_model) routes.push(`code → ${config.routing.code_model}`);
    if (config.routing.vision_model) routes.push(`vision → ${config.routing.vision_model}`);
    if (routes.length > 0) {
      checks.push({ status: 'ok', msg: `Routing: ${routes.join(', ')}` });
    }
  }

  return checks;
}

async function verifyEndpoint(ep) {
  try {
    const res = await fetch(`${ep.base_url.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${ep.api_key}` },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      const modelList = data.data || [];
      const modelCount = Array.isArray(modelList) ? modelList.length : 0;
      return {
        status: 'ok',
        msg: `${ep.base_url} — ${res.status} OK, ${modelCount} model terdaftar`,
        modelList: modelList.slice(0, 50),
      };
    }

    const errBody = await res.text().catch(() => '');
    if (res.status === 401) {
      return { status: 'err', msg: `${ep.base_url} — HTTP 401: API Key salah / expired` };
    }
    return { status: 'err', msg: `${ep.base_url} — HTTP ${res.status}: ${errBody.slice(0, 120)}` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { status: 'err', msg: `${ep.base_url} — timeout setelah 10 detik` };
    }
    if (err.cause?.code === 'ECONNREFUSED') {
      return {
        status: 'err',
        msg: `${ep.base_url} — koneksi ditolak (ECONNREFUSED). Server nggak jalan?`,
      };
    }
    if (err.cause?.code === 'ENOTFOUND') {
      return { status: 'err', msg: `${ep.base_url} — host tidak dikenal (ENOTFOUND). Cek URL.` };
    }
    return { status: 'err', msg: `${ep.base_url} — ${err.message.slice(0, 120)}` };
  }
}

function checkProjectDir() {
  const checks = [];

  if (PROJECT_DIR && PROJECT_DIR !== HOME_DIR) {
    checks.push({ status: 'ok', msg: `Project dir: ${PROJECT_DIR}` });

    const archivePath = path.join(PROJECT_DIR, 'archive.jsonl');
    if (fs.existsSync(archivePath)) {
      const stats = fs.statSync(archivePath);
      const lines = fs.readFileSync(archivePath, 'utf-8').trim().split('\n').filter(Boolean).length;
      checks.push({
        status: 'ok',
        msg: `Archive: ${lines} entri (${(stats.size / 1024).toFixed(1)} KB)`,
      });
    } else {
      checks.push({ status: 'ok', msg: 'Archive: (belum ada — normal kalau baru pertama kali)' });
    }

    const memoryPath = path.join(PROJECT_DIR, 'MEMORY.md');
    if (fs.existsSync(memoryPath)) {
      checks.push({ status: 'ok', msg: 'MEMORY.md ada' });
    }
  } else {
    checks.push({ status: 'ok', msg: 'Proyek ini belum punya .nythros — pakai home dir global' });
  }

  return checks;
}

function checkNotion(config) {
  const checks = [];
  if (config?.notion?.api_key) {
    checks.push({ status: 'ok', msg: 'Notion API key terisi' });
  } else {
    checks.push({
      status: 'warn',
      msg: 'Notion API key belum di-set — GDD dari Notion tidak akan berfungsi',
    });
  }
  if (config?.notion?.gdd_page_id) {
    checks.push({ status: 'ok', msg: `Notion GDD page ID: ${config.notion.gdd_page_id}` });
  } else {
    checks.push({
      status: 'warn',
      msg: 'Notion GDD page ID belum di-set — GDD Notion tidak bisa dibaca',
    });
  }
  return checks;
}

function checkObservations() {
  const checks = [];
  const obsPath = path.join(HOME_DIR, 'observations.jsonl');

  if (fs.existsSync(obsPath)) {
    const lines = fs.readFileSync(obsPath, 'utf-8').trim().split('\n').filter(Boolean);
    checks.push({ status: 'ok', msg: `Observations: ${lines.length} entri` });
  }

  return checks;
}

function getSuggestions(allChecks) {
  const suggestions = [];

  const configuredEndpoint = allChecks.some((c) => c.section === 'config' && c.status === 'ok');
  const pendingEndpoint = allChecks.some((c) => c.section === 'config' && c.status === 'warn');
  const verifyError = allChecks.some((c) => c.section === 'verify' && c.status === 'err');
  const verifyOk = allChecks.some((c) => c.section === 'verify' && c.status === 'ok');

  if (!configuredEndpoint && pendingEndpoint) {
    suggestions.push(
      "Endpoint belum lengkap — jalankan 'nythros setup' untuk isi base_url, api_key, dan model.",
    );
  } else if (!configuredEndpoint) {
    suggestions.push(
      "Belum ada endpoint — jalankan 'nythros setup' untuk konfigurasi endpoint AI.",
    );
  }

  if (configuredEndpoint && verifyError && !verifyOk) {
    suggestions.push('Semua endpoint gagal diverifikasi — cek koneksi internet atau API key kamu.');
  }

  if (!suggestions.length && verifyOk) {
    suggestions.push('Semua terlihat baik! Coba jalankan \'nythros chat "halo"\' untuk tes agent.');
  }

  suggestions.push('Dokumentasi: https://github.com/omnivora/nythros');
  suggestions.push('Lapor bug: buka issue di GitHub atau hubungi @omnivora');

  return suggestions.slice(0, 5);
}

// ── Core: collect all checks into a structured result ────────

async function collectAllChecks(includeVerify = true, onProgress) {
  const allChecks = [];
  let config;

  const sysChecks = checkSystem();
  sysChecks.forEach((c) => allChecks.push({ ...c, section: 'system' }));

  const homeChecks = checkHomeDir();
  homeChecks.forEach((c) => allChecks.push({ ...c, section: 'home' }));

  try {
    config = loadConfig();
    const cfgChecks = checkConfig(config);
    cfgChecks.forEach((c) => allChecks.push({ ...c, section: 'config' }));
  } catch (err) {
    allChecks.push({ status: 'err', section: 'config', msg: err.message });
  }

  const projChecks = checkProjectDir();
  projChecks.forEach((c) => allChecks.push({ ...c, section: 'project' }));

  const obsChecks = checkObservations();
  obsChecks.forEach((c) => allChecks.push({ ...c, section: 'observations' }));

  // Notion
  const notionChecks = checkNotion(config);
  notionChecks.forEach((c) => allChecks.push({ ...c, section: 'notion' }));

  // Endpoint Verification
  const verifyResults = [];
  if (config?.endpoints?.length > 0 && includeVerify) {
    const verifiable = config.endpoints.filter((ep) => ep.base_url && ep.api_key);
    if (verifiable.length === 0) {
      allChecks.push({ status: 'warn', section: 'verify', msg: 'No verifiable endpoints' });
    } else {
      for (const ep of verifiable) {
        if (onProgress) onProgress(ep);
        const result = await verifyEndpoint(ep);
        verifyResults.push(result);
        allChecks.push({ ...result, section: 'verify' });
      }
    }
  } else if (includeVerify) {
    allChecks.push({ status: 'warn', section: 'verify', msg: 'No endpoints to verify' });
  }

  const suggestions = getSuggestions(allChecks);
  return { allChecks, config, verifyResults, suggestions };
}

// Export internal functions for unit testing & slash command usage
export {
  checkSystem,
  checkHomeDir,
  checkConfig,
  verifyEndpoint,
  checkProjectDir,
  checkObservations,
  getSuggestions,
  collectAllChecks,
};

// ── Normal Mode ──────────────────────────────────────────────

export async function runDoctor(verbose = false) {
  const allChecks = [];
  let config;

  console.log(`\n${C.bold}${C.magenta}🩺 Nythros Doctor${C.reset}`);
  console.log(`${C.dim}Ngecek kesehatan instalasi Nythros...${C.reset}\n`);

  // 1. System (sync — instan)
  console.log(`${label('1. System')}`);
  const sysChecks = checkSystem();
  sysChecks.forEach((c) => {
    console.log(indent(`${icon(c.status)} ${c.msg}`));
    allChecks.push({ ...c, section: 'system' });
  });
  if (verbose) {
    console.log(
      indent(
        `${C.dim}  Uptime: ${Math.round(os.uptime() / 3600)} jam, User: ${os.userInfo().username}${C.reset}`,
      ),
    );
  }
  console.log();

  // 2. Config (sync — instan)
  console.log(`${label('2. Config')}`);
  const homeChecks = checkHomeDir();
  homeChecks.forEach((c) => {
    console.log(indent(`${icon(c.status)} ${c.msg}`));
    allChecks.push({ ...c, section: 'home' });
  });
  try {
    config = loadConfig();
    const cfgChecks = checkConfig(config);
    cfgChecks.forEach((c) => {
      console.log(indent(`${icon(c.status)} ${c.msg}`));
      allChecks.push({ ...c, section: 'config' });
    });
  } catch (err) {
    console.log(indent(`${icon('err')} Gagal load config: ${err.message}`));
    allChecks.push({ status: 'err', section: 'config', msg: err.message });
  }
  if (verbose && config) {
    const ep = config.endpoints?.[0];
    if (ep) {
      console.log(
        indent(
          `${C.dim}  ${JSON.stringify({ id: ep.id, base_url: ep.base_url, model: ep.model, api_key: ep.api_key ? '***' : '' }, null, 4)}${C.reset}`,
        ),
      );
    }
  }
  console.log();

  // 3. Project (sync — instan)
  console.log(`${label('3. Project')}`);
  const projChecks = checkProjectDir();
  projChecks.forEach((c) => {
    console.log(indent(`${icon(c.status)} ${c.msg}`));
    allChecks.push({ ...c, section: 'project' });
  });
  const obsChecks = checkObservations();
  obsChecks.forEach((c) => {
    console.log(indent(`${icon(c.status)} ${c.msg}`));
    allChecks.push({ ...c, section: 'observations' });
  });
  console.log();

  // 4. Endpoint Verification (async — pake spinner)
  console.log(`${label('4. Endpoint Verification')}`);
  const verifyResults = [];
  if (config?.endpoints?.length > 0) {
    const verifiable = config.endpoints.filter((ep) => ep.base_url && ep.api_key);
    if (verifiable.length === 0) {
      console.log(indent(`${icon('warn')} Tidak ada endpoint dengan base_url + api_key lengkap`));
      allChecks.push({ status: 'warn', section: 'verify', msg: 'No verifiable endpoints' });
    } else {
      for (const ep of verifiable) {
        process.stdout.write(indent(`⏳ ${ep.base_url}... `));
        const result = await verifyEndpoint(ep);
        process.stdout.write('\r' + ' '.repeat(80) + '\r');
        console.log(indent(`${icon(result.status)} ${result.msg}`));
        if (verbose && result.status === 'ok' && result.modelList?.length > 0) {
          const names = result.modelList
            .map((m) => m.id)
            .slice(0, 15)
            .join(', ');
          console.log(
            indent(
              `  ${C.dim}Models: ${names}${result.modelList.length > 15 ? `, ... +${result.modelList.length - 15}` : ''}${C.reset}`,
            ),
          );
        }
        allChecks.push({ ...result, section: 'verify' });
        verifyResults.push(result);
      }
    }
  } else {
    console.log(indent(`${icon('warn')} Tidak ada endpoint — lewati verifikasi`));
  }
  console.log();

  // 5. Suggestions
  console.log(`${label('5. Suggestions', C.green)}`);
  const suggestions = getSuggestions(allChecks);
  suggestions.forEach((s) => console.log(indent(`${C.dim}💡${C.reset} ${s}`)));
  console.log();

  // Summary
  const ok = allChecks.filter((c) => c.status === 'ok').length;
  const warn = allChecks.filter((c) => c.status === 'warn').length;
  const err = allChecks.filter((c) => c.status === 'err').length;
  const total = allChecks.length;

  if (err === 0 && warn === 0) {
    console.log(`${C.green}${C.bold}✅ Semua ${total} cek OK — Nythros siap dipakai!${C.reset}\n`);
  } else if (err === 0) {
    console.log(`${C.yellow}${C.bold}⚠️  ${total} cek: ${ok} OK, ${warn} peringatan.${C.reset}\n`);
  } else {
    console.log(
      `${C.red}${C.bold}❌ ${total} cek: ${ok} OK, ${warn} peringatan, ${err} error.${C.reset}\n`,
    );
  }
}

// ── JSON Mode ────────────────────────────────────────────────

export async function runDoctorJSON() {
  const data = await collectAllChecks(true, (ep) => {
    // JSON mode: progress ke stderr biar stdout cuma JSON
    process.stderr.write(indent(`⏳ ${ep.base_url}... `));
  });
  process.stderr.write('\r' + ' '.repeat(80) + '\r');
  const allChecks = data.allChecks;
  const config = data.config;
  const verifyResults = data.verifyResults;
  const suggestions = data.suggestions;

  const ok = allChecks.filter((c) => c.status === 'ok').length;
  const warn = allChecks.filter((c) => c.status === 'warn').length;
  const err = allChecks.filter((c) => c.status === 'err').length;

  // Build structured JSON
  const jsonResult = {
    status: err > 0 ? 'err' : warn > 0 ? 'warn' : 'ok',
    timestamp: new Date().toISOString(),
    system: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      ram_gb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
      ram_free_gb: Math.round(os.freemem() / 1024 / 1024 / 1024),
      ram_free_percent: Math.round((os.freemem() / os.totalmem()) * 100),
    },
    config: {
      exists: allChecks.some((c) => c.section === 'home' && c.status === 'ok'),
      endpoints: (config?.endpoints || []).map((ep) => ({
        id: ep.id,
        name: ep.name,
        base_url: ep.base_url || null,
        model: ep.model || null,
        has_api_key: !!ep.api_key,
        status: !ep.base_url || !ep.api_key ? 'incomplete' : 'configured',
      })),
      routing: config?.routing || null,
    },
    project: {
      path: PROJECT_DIR !== HOME_DIR ? PROJECT_DIR : null,
      archive_entries: (() => {
        const ap = path.join(PROJECT_DIR, 'archive.jsonl');
        if (fs.existsSync(ap)) {
          try {
            return fs.readFileSync(ap, 'utf-8').trim().split('\n').filter(Boolean).length;
          } catch {
            return 0;
          }
        }
        return 0;
      })(),
      has_memory: (() => {
        const mp = path.join(PROJECT_DIR, 'MEMORY.md');
        return fs.existsSync(mp);
      })(),
    },
    endpoints: verifyResults.map((r, i) => ({
      url: config?.endpoints?.[i]?.base_url || null,
      status: r.status,
      models_count: r.modelList?.length || null,
      error: r.status === 'ok' ? null : r.msg,
    })),
    checks: allChecks.map((c) => ({ section: c.section, status: c.status, message: c.msg })),
    summary: { total: allChecks.length, ok, warn, err },
    suggestions,
  };

  console.log(JSON.stringify(jsonResult, null, 2));
}

// ── Fix Mode ─────────────────────────────────────────────────

export async function doctorFix() {
  const allChecks = [];

  console.log(`\n${C.bold}${C.magenta}🩺 Nythros Doctor — Mode Perbaikan${C.reset}`);
  console.log(`${C.dim}Ngecek dan benerin masalah konfigurasi...${C.reset}\n`);

  // 1. System
  console.log(`${label('1. System')}`);
  const sysChecks = checkSystem();
  sysChecks.forEach((c) => console.log(indent(`${icon(c.status)} ${c.msg}`)));
  sysChecks.forEach((c) => allChecks.push({ ...c, section: 'system' }));
  console.log();

  // 2. Config
  console.log(`${label('2. Config')}`);
  const homeChecks = checkHomeDir();
  homeChecks.forEach((c) => console.log(indent(`${icon(c.status)} ${c.msg}`)));
  const homeErr = homeChecks.some((c) => c.status === 'err');
  if (homeErr) {
    console.log(indent(`${icon('warn')} Membuat direktori ~/.nythros...`));
    try {
      ensureHomeDirs();
      console.log(indent(`${icon('ok')} Home dir berhasil dibuat`));
      console.log(indent(`${icon('ok')} Struktur direktori ~/.nythros siap`));
      allChecks.push({ status: 'ok', section: 'home', msg: `Home dir ${HOME_DIR}` });
      allChecks.push({
        status: 'ok',
        section: 'home',
        msg: 'Struktur direktori terbuat (memory, cache, logs, dll)',
      });
    } catch (e) {
      console.log(indent(`${icon('err')} Gagal buat direktori: ${e.message}`));
      allChecks.push({
        status: 'err',
        section: 'home',
        msg: `Gagal buat ${HOME_DIR}: ${e.message}`,
      });
    }
  } else {
    homeChecks.forEach((c) => allChecks.push({ ...c, section: 'home' }));
  }

  let config;
  try {
    config = loadConfig();
    const cfgChecks = checkConfig(config);
    if (cfgChecks.length > 0) {
      cfgChecks.forEach((c) => console.log(indent(`${icon(c.status)} ${c.msg}`)));
      cfgChecks.forEach((c) => allChecks.push({ ...c, section: 'config' }));
    }
  } catch (err) {
    console.log(indent(`${icon('err')} Gagal load config: ${err.message}`));
    allChecks.push({ status: 'err', section: 'config', msg: err.message });
  }

  // Detect fixable issues
  const needEndpoint =
    !config?.endpoints?.length || config.endpoints.some((ep) => !ep.base_url || !ep.api_key);

  if (needEndpoint && process.stdout.isTTY) {
    console.log();
    console.log(indent(`${C.yellow}${C.bold}🔧 Perbaikan interaktif${C.reset}`));
    console.log(indent(`${C.dim}Endpoint AI belum lengkap. Isi field di bawah ini:${C.reset}\n`));

    const ep = config?.endpoints?.[0] || {};

    const baseURL = await askQuestion(
      indent(`Base URL [${ep.base_url || 'https://openrouter.ai/api/v1'}]: `),
    );
    const apiKey = await askQuestion(
      indent(`API Key [${ep.api_key ? '***sudah terisi***' : 'kosong'}]: `),
    );
    const model = await askQuestion(indent(`Model [${ep.model || 'anthropic/claude-sonnet-4'}]: `));

    config.endpoints = [
      {
        id: ep.id || 'openai',
        name: ep.name || 'OpenAI Compatible',
        base_url: baseURL || ep.base_url || 'https://openrouter.ai/api/v1',
        api_key: apiKey || ep.api_key || '',
        model: model || ep.model || 'anthropic/claude-sonnet-4',
        supports_vision: true,
        supports_tools: true,
        priority: 1,
      },
    ];

    saveConfig(config);
    console.log();
    console.log(indent(`${C.green}✅ Konfigurasi tersimpan!${C.reset}`));

    // Refresh allCheks dengan state setelah fix
    for (let i = allChecks.length - 1; i >= 0; i--) {
      if (allChecks[i].section === 'config' || allChecks[i].section === 'home') {
        allChecks.splice(i, 1);
      }
    }
    const freshConfig = loadConfig();
    const freshCfgChecks = checkConfig(freshConfig);
    freshCfgChecks.forEach((c) => {
      console.log(indent(`${icon(c.status)} ${c.msg}`));
      allChecks.push({ ...c, section: 'config' });
    });

    if (freshConfig.endpoints[0].base_url && freshConfig.endpoints[0].api_key) {
      console.log();
      console.log(indent(`${C.cyan}⏳ Verifikasi endpoint...${C.reset}`));
      const result = await verifyEndpoint(freshConfig.endpoints[0]);
      console.log(indent(`${icon(result.status)} ${result.msg}`));
      allChecks.push({ ...result, section: 'verify' });
    }
  } else if (needEndpoint) {
    console.log(
      indent(`${icon('warn')} Non-interactive mode — skip fix. Jalankan 'nythros setup' manual.`),
    );
  }

  console.log();

  // 3. Project
  console.log(`${label('3. Project')}`);
  const projChecks = checkProjectDir();
  projChecks.forEach((c) => console.log(indent(`${icon(c.status)} ${c.msg}`)));
  console.log();

  // Summary
  const ok = allChecks.filter((c) => c.status === 'ok').length;
  const warn = allChecks.filter((c) => c.status === 'warn').length;
  const err = allChecks.filter((c) => c.status === 'err').length;
  const total = allChecks.length;

  if (err === 0 && warn === 0) {
    console.log(`${C.green}${C.bold}✅ Semua ${total} cek OK + perbaikan selesai!${C.reset}\n`);
  } else if (err === 0) {
    console.log(
      `${C.yellow}${C.bold}⚠️  ${total} cek: ${ok} OK, ${warn} peringatan + perbaikan selesai.${C.reset}\n`,
    );
  } else {
    console.log(
      `${C.red}${C.bold}❌ ${total} cek: ${ok} OK, ${warn} peringatan, ${err} error.${C.reset}\n`,
    );
  }
}
