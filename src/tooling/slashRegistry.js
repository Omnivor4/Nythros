// src/tooling/slashRegistry.js
// Simple command registry for Nythros slash commands

const commands = new Map();

// Command descriptions for /help
const commandHelp = {
  help: 'Show available slash commands',
  debug: 'Dump raw config, MCP status, env vars for troubleshooting',
  doctor: 'Run diagnostic checks (equivalent to nythros doctor)',
  skill: 'Manage GitHub skills',
  config: 'Show Nythros configuration',
  memory: 'View current project memory',
  budget: 'Check token budget limit',
  cost: 'View session token usage & estimated cost',
  endpoints: 'List configured endpoints',
  archive: 'View archived summaries',
  mcp: 'Model Context Protocol integration',
  tools: 'List all active tools',
  mode: 'Show current mode',
  python: 'Run Python code snippet',
  clear: 'Clear the terminal screen',
  exit: 'Exit Nythros',
};

export function registerCommand(name, handler) {
  if (typeof name !== 'string' || typeof handler !== 'function') {
    throw new Error('Invalid command registration');
  }
  commands.set(name, handler);
}

export async function executeCommand(name, args = [], context = {}) {
  const handler = commands.get(name);
  if (!handler) {
    throw new Error(`Unknown command: ${name}`);
  }
  // handler may be async
  return await handler(...args, context);
}

export function listCommands() {
  return Array.from(commands.entries()).map(([name, handler]) => ({ name, description: commandHelp[name] || '' }));
}

export function getHelpText() {
  return [
    "Available Slash Commands:",
    "  /doctor [--json|--fix]         - Diagnostic & auto-fix",
    "  /debug                         - Full debug dump (config, MCP, env)",
    "  /skill [add|list|remove]       - Manage GitHub skills",
    "  /config [show]                 - Show Nythros configuration",
    "  /memory                        - View current project memory",
    "  /budget                        - Check token budget limit",
    "  /cost                          - View session token usage & estimated cost",
    "  /endpoints                     - List configured endpoints",
    "  /archive                       - View archived summaries",
    "  /mcp [list|connect|disconnect] - MCP integration",
    "  /tools                         - List all active tools",
    "  /mode                          - Show current mode",
    "  /python <code>                 - Run Python code snippet",
    "  /clear                         - Clear the terminal screen",
    "  /exit                          - Exit Nythros",
  ].join("\n");
}

// Register all commands
export async function registerAllCommands() {
  // Import and register commands
  const { loadConfig } = await import('../../shared/config.js');
  const { builtinTools } = await import('../../tooling/tools.js');
  const { listSkills, installSkill, removeSkill } = await import('../skills/installer.js');
  const { readMemory } = await import('../../memory/memory.js');
  const { readRecentArchive } = await import('../../memory/archive.js');
  const { budgetStatus } = await import('../../infrastructure/state/budgetGuard.js');
  const { getMcpTools, getActiveMcpClients } = await import('../../infrastructure/mcp/mcpLoader.js');

  // /help
  registerCommand('help', async () => getHelpText());

  // /skill
  registerCommand('skill', async (args) => {
    if (args[0] === 'list') {
      const skills = listSkills();
      if (skills.length === 0) {
        return "Belum ada skill terinstall. Pakai: /skill add <repo-url>";
      }
      return "Installed Skills:\n" + skills.map(s => `  - ${s.name}: ${s.description}`).join("\n");
    } else if (args[0] === 'add' && args[1]) {
      try {
        const entry = await installSkill(args[1]);
        return `✓ Skill "${entry.name}" berhasil diinstall.`;
      } catch (e) {
        return `✗ Gagal install skill: ${e.message}`;
      }
    } else if (args[0] === 'remove' && args[1]) {
      try {
        removeSkill(args[1]);
        return `✓ Skill "${args[1]}" berhasil dihapus.`;
      } catch (e) {
        return `✗ Gagal hapus skill: ${e.message}`;
      }
    }
    return "Usage: /skill [add <repo-url> | list | remove <name>]";
  });

  // /config
  registerCommand('config', async (args) => {
    if (args[0] === 'show') {
      // Deep clone biar nggak mutatin config asli
      const raw = JSON.parse(JSON.stringify(loadConfig()));
      // Mask ALL endpoint API keys, bukan cuma [0]
      if (raw.endpoints) {
        raw.endpoints = raw.endpoints.map(ep => ({
          ...ep,
          api_key: ep.api_key ? '***' : '(not set)'
        }));
      }
      return JSON.stringify(raw, null, 2);
    }
    return "Usage: /config show";
  });

  // /memory
  registerCommand('memory', async () => {
    const mem = readMemory();
    return mem ? `📝 Project Memory:\n${mem}` : "Belum ada memory untuk project ini.";
  });

  // /archive
  registerCommand('archive', async () => {
    const entries = readRecentArchive(5);
    if (entries.length === 0) {
      return "Belum ada arsip percakapan.";
    }
    return "📦 Arsip Terbaru:\n" + entries.map(e =>
      `  [${e.timestamp?.slice(0, 10)}] ${e.summary} (${e.message_count} pesan)`
    ).join("\n");
  });

  // /budget and /cost
  registerCommand('budget', async () => {
    const status = budgetStatus();
    return [
      `💰 Token Budget:`,
      `  Terpakai : ${status.used.toLocaleString()} / ${status.limit.toLocaleString()} (${status.percent}%)`,
      `  Prompt   : ${status.prompt.toLocaleString()}`,
      `  Completion: ${status.completion.toLocaleString()}`,
    ].join("\n");
  });

  registerCommand('cost', async () => {
    const status = budgetStatus();
    return [
      `💰 Token Budget:`,
      `  Terpakai : ${status.used.toLocaleString()} / ${status.limit.toLocaleString()} (${status.percent}%)`,
      `  Prompt   : ${status.prompt.toLocaleString()}`,
      `  Completion: ${status.completion.toLocaleString()}`,
    ].join("\n");
  });

  // /endpoints
  registerCommand('endpoints', async () => {
    const cfg = loadConfig();
    const eps = cfg.endpoints || [];
    if (eps.length === 0) {
      return "Belum ada endpoint terkonfigurasi.";
    }
    return "🔗 Endpoints:\n" + eps.map((ep, i) =>
      `  ${i + 1}. ${ep.name || ep.id} — ${ep.base_url || "(belum diatur)"} [model: ${ep.model || "-"}]`
    ).join("\n");
  });

  // /mcp
  registerCommand('mcp', async (args) => {
    if (args[0] === 'list') {
      const clients = getActiveMcpClients();
      const tools = getMcpTools();
      if (clients.size === 0) {
        return "Tidak ada MCP server yang aktif.";
      }
      return `🔌 MCP Servers (${clients.size} aktif, ${tools.length} tools):\n`
        + Array.from(clients.keys()).map(n => `  - ${n}`).join("\n");
    } else if (args[0] === 'connect' && args[1] && args[2]) {
      try {
        const { connectMcpServer, persistMcpToConfig, removeMcpFromConfig } = await import('../../infrastructure/mcp/mcpLoader.js');
        const name = args[1];
        const command = args.slice(2).join(' ');
        await connectMcpServer(name, command);
        persistMcpToConfig(name, command);
        return `✓ MCP server "${name}" berhasil terkoneksi & tersimpan!`;
      } catch (e) {
        return `✗ Gagal konek MCP server: ${e.message}`;
      }
    } else if (args[0] === 'disconnect' && args[1]) {
      try {
        const { disconnectMcpServer, removeMcpFromConfig } = await import('../../infrastructure/mcp/mcpLoader.js');
        const ok = await disconnectMcpServer(args[1]);
        removeMcpFromConfig(args[1]);
        return ok
          ? `✓ MCP server "${args[1]}" terputus & dihapus dari config.`
          : `MCP server "${args[1]}" tidak ditemukan.`;
      } catch (e) {
        return `✗ Gagal putus koneksi: ${e.message}`;
      }
    }
    return "Usage: /mcp [list | connect <name> <command> | disconnect <name>]";
  });

  // /tools — show builtin + MCP tools
  registerCommand('tools', async () => {
    const mcpTools = await getMcpTools();
    const mcpCount = mcpTools.length;
    let out = `Active tools (${builtinTools.length + mcpCount} total):\n`;
    out += builtinTools.map(t => `  - ${t.name}`).join("\n");
    if (mcpCount > 0) {
      out += '\n  --- MCP Tools ---\n';
      out += mcpTools.map(t => `  - ${t.name}`).join("\n");
    }
    return out;
  });

  // /mode
  registerCommand('mode', async () => "Current Mode: general");

  // /debug
  registerCommand('debug', async () => {
    const lines = [];
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');

    lines.push('🐛 Nythros Debug Dump');
    lines.push('─'.repeat(50));

    // 1. Timestamp & System
    lines.push(`\n📅 Timestamp: ${new Date().toISOString()}`);
    lines.push(`Node: ${process.version} on ${process.platform} (${process.arch})`);
    lines.push(`PID: ${process.pid}  Uptime: ${Math.round(os.uptime() / 3600)}h`);
    lines.push(`CWD: ${process.cwd()}`);

    // 2. Config (masked)
    lines.push(`\n📄 Raw Config:`);
    try {
      const cfg = loadConfig();
      const masked = JSON.parse(JSON.stringify(cfg));
      if (masked.endpoints) {
        masked.endpoints = masked.endpoints.map(ep => ({
          ...ep,
          api_key: ep.api_key ? '***' : '(not set)'
        }));
      }
      lines.push(JSON.stringify(masked, null, 2));
    } catch (e) {
      lines.push(`  ✗ Gagal load config: ${e.message}`);
    }

    // 3. MCP Status
    lines.push(`\n🔌 MCP Status:`);
    try {
      const mcpClients = getActiveMcpClients();
      const mcpTools = getMcpTools();
      lines.push(`  Active clients: ${mcpClients.size}`);
      if (mcpClients.size > 0) {
        lines.push(`  Client names: ${Array.from(mcpClients.keys()).join(', ')}`);
      }
      lines.push(`  Registered tools: ${mcpTools.length}`);
      if (mcpTools.length > 0) {
        lines.push(`  Tool names: ${mcpTools.map(t => t.name).slice(0, 20).join(', ')}${mcpTools.length > 20 ? '...' : ''}`);
      }
    } catch (e) {
      lines.push(`  ✗ MCP error: ${e.message}`);
    }

    // 4. Budget
    lines.push(`\n💰 Budget:`);
    try {
      const b = budgetStatus();
      lines.push(`  Used: ${b.used.toLocaleString()} / ${b.limit.toLocaleString()} (${b.percent}%)`);
      lines.push(`  Prompt: ${b.prompt.toLocaleString()}  Completion: ${b.completion.toLocaleString()}`);
    } catch (e) {
      lines.push(`  ✗ Budget error: ${e.message}`);
    }

    // 5. Environment variables
    lines.push(`\n🌐 Environment:`);
    const tracked = ['HOME', 'USER', 'USERNAME', 'SHELL', 'TERM', 'NODE_ENV', 'PATH'];
    for (const key of tracked) {
      if (process.env[key]) {
        const val = key === 'PATH'
          ? process.env[key].split(path.delimiter).filter(Boolean).join('\n      ')
          : process.env[key];
        lines.push(`  ${key}: ${val}`);
      }
    }
    // Custom Nythros vars
    for (const key of Object.keys(process.env).sort()) {
      if (key.startsWith('NYTHROS_') || key.startsWith('HTTP_PROXY') || key.startsWith('HTTPS_PROXY') || key === 'NO_PROXY') {
        lines.push(`  ${key}: ${process.env[key]}`);
      }
    }

    // 6. Nythros paths
    lines.push(`\n📁 Nythros Paths:`);
    try {
      const { HOME_DIR, PROJECT_DIR } = await import('../../shared/utils/paths.js');
      lines.push(`  HOME_DIR: ${HOME_DIR}`);
      lines.push(`  HOME_DIR exists: ${fs.existsSync(HOME_DIR)}`);
      lines.push(`  PROJECT_DIR: ${PROJECT_DIR}`);
      lines.push(`  PROJECT_DIR exists: ${fs.existsSync(PROJECT_DIR)}`);
      const cfgPath = path.join(HOME_DIR, 'config.json');
      lines.push(`  Config file: ${cfgPath}`);
      lines.push(`  Config exists: ${fs.existsSync(cfgPath)}`);
      const cfgSize = fs.existsSync(cfgPath) ? ` (${(fs.statSync(cfgPath).size / 1024).toFixed(1)} KB)` : '';
      if (cfgSize) lines[lines.length - 1] += cfgSize;
    } catch (e) {
      lines.push(`  ✗ Path error: ${e.message}`);
    }

    // 7. Home dir contents (top 10)
    lines.push(`\n📂 ~/.nythros/ contents:`);
    try {
      const { HOME_DIR } = await import('../../shared/utils/paths.js');
      if (fs.existsSync(HOME_DIR)) {
        const items = fs.readdirSync(HOME_DIR).slice(0, 15);
        if (items.length === 0) {
          lines.push(`  (empty)`);
        } else {
          items.forEach(item => {
            const full = path.join(HOME_DIR, item);
            const stat = fs.statSync(full);
            const prefix = stat.isDirectory() ? '📁' : '📄';
            const size = stat.isFile() ? ` (${(stat.size / 1024).toFixed(1)} KB)` : '/';
            lines.push(`  ${prefix} ${item}${size}`);
          });
          if (items.length < fs.readdirSync(HOME_DIR).length) {
            lines.push(`  ... and ${fs.readdirSync(HOME_DIR).length - items.length} more`);
          }
        }
      } else {
        lines.push(`  (does not exist)`);
      }
    } catch (e) {
      lines.push(`  ✗ ${e.message}`);
    }

    lines.push('\n' + '─'.repeat(50));
    lines.push('💡 Lampirkan output ini kalau bikin bug report di GitHub.');

    return lines.join('\n');
  });

  // /doctor
  registerCommand('doctor', async (args) => {
    const { collectAllChecks, checkHomeDir, checkSystem, checkConfig, checkProjectDir, verifyEndpoint } = await import('../../presentation/doctor.js');
    const { ensureHomeDirs, HOME_DIR } = await import('../../shared/utils/paths.js');

    // ── --fix mode: auto-fix what can be fixed, guide for the rest ──
    if (args[0] === '--fix') {
      const lines = [];
      lines.push('🔧 Nythros Doctor — Auto-Fix');
      lines.push('─'.repeat(40));

      // System
      const sys = checkSystem();
      lines.push(`System: ${sys.map(c => c.msg).join(' · ')}`);

      // Home dir — auto-create
      const homeBefore = checkHomeDir();
      const homeMissing = homeBefore.some(c => c.status === 'err');
      if (homeMissing) {
        try {
          ensureHomeDirs();
          lines.push(`Home: ✓ ${HOME_DIR} created`);
          lines.push(`Home: ✓ Subdirectory structure ready`);
        } catch (e) {
          lines.push(`Home: ✗ Failed: ${e.message}`);
        }
      } else {
        lines.push(`Home: ✓ ${homeBefore[0].msg}`);
      }

      // Config — detect & fill if needed
      let config;
      try {
        const { loadConfig, saveConfig } = await import('../../shared/config.js');
        config = loadConfig();
      } catch {
        config = null;
      }

      const hasEndpoints = config?.endpoints?.length > 0;
      const missingFields = hasEndpoints
        ? config.endpoints.filter(ep => !ep.base_url || !ep.api_key)
        : [];

      if (!hasEndpoints || missingFields.length === config.endpoints.length) {
        // No usable endpoints — create a default one
        const defaultEndpoint = {
          id: 'openai',
          name: 'OpenAI Compatible',
          base_url: '',
          api_key: '',
          model: 'anthropic/claude-sonnet-4',
          supports_vision: true,
          supports_tools: true,
          priority: 1,
        };

        if (!config) {
          const { saveConfig } = await import('../../shared/config.js');
          saveConfig({ endpoints: [defaultEndpoint], routing: { default_model: 'openai' } });
          lines.push(`Config: ⚠ Created default endpoint — base_url & api_key masih kosong`);
          lines.push(`Config: ➡ Edit manual di ~/.nythros/config.json atau jalankan 'nythros setup' dari terminal`);
        } else if (!hasEndpoints) {
          config.endpoints = [defaultEndpoint];
          const { saveConfig } = await import('../../shared/config.js');
          saveConfig(config);
          lines.push(`Config: ⚠ Added default endpoint — isi base_url & api_key`);
          lines.push(`Config: ➡ Edit manual ~/.nythros/config.json atau 'nythros setup' dari terminal`);
        } else {
          lines.push(`Config: ⚠ Endpoint ada tapi field penting kosong`);
          lines.push(`Config: ➡ /endpoints buat lihat status, lalu isi manual`);
        }
      } else if (missingFields.length > 0) {
        lines.push(`Config: ⚠ ${missingFields.length} endpoint punya field kosong`);
        lines.push(`Config: ➡ Cek dengan /endpoints dan isi yang kurang`);
      } else {
        lines.push(`Config: ✓ ${config.endpoints.length} endpoint lengkap`);

        // Verify working endpoint
        const working = config.endpoints.find(ep => ep.base_url && ep.api_key);
        if (working) {
          lines.push(`Config: ⏳ Verifying ${working.base_url}...`);
          try {
            const result = await verifyEndpoint(working);
            lines.push(`Verify: ${result.status === 'ok' ? '✓' : '✗'} ${result.msg}`);
          } catch (e) {
            lines.push(`Verify: ✗ ${e.message}`);
          }
        }
      }

      // Project
      const proj = checkProjectDir();
      const archive = proj.find(c => c.msg?.includes('Archive:'));
      lines.push(`Project: ${archive ? archive.msg : 'active'}`);

      lines.push('─'.repeat(40));
      lines.push(`💡 Kalau masih ada yang merah, jalankan /doctor buat lihat status terbaru.`);

      return lines.join('\n');
    }

    // ── Normal diagnostic mode ──
    const data = await collectAllChecks(true);
    const { allChecks, config, verifyResults, suggestions } = data;

    const ok = allChecks.filter(c => c.status === "ok").length;
    const warn = allChecks.filter(c => c.status === "warn").length;
    const err = allChecks.filter(c => c.status === "err").length;
    const total = allChecks.length;

    if (args[0] === '--json') {
      return JSON.stringify({
        status: err > 0 ? "err" : warn > 0 ? "warn" : "ok",
        summary: { total, ok, warn, err },
        checks: allChecks.map(c => ({ section: c.section, status: c.status, message: c.msg })),
        suggestions,
      }, null, 2);
    }

    // Pretty-print compact output
    const lines = [];
    lines.push('🩺 Nythros Doctor — Diagnostic');
    lines.push('─'.repeat(40));

    // System
    const sys = allChecks.filter(c => c.section === 'system');
    if (sys.length > 0) lines.push(`System: ${sys.map(c => c.msg).join(' · ')}`);

    // Home
    const home = allChecks.filter(c => c.section === 'home');
    if (home.length > 0) {
      const homeMsg = home[0].status === 'ok' ? '✓' : '✗';
      lines.push(`Home: ${home[0].msg} ${homeMsg}`);
    }

    // Config
    const cfg = allChecks.filter(c => c.section === 'config');
    if (cfg.length > 0) {
      const endpointCount = config?.endpoints?.length || 0;
      const configured = cfg.filter(c => c.status === 'ok').length;
      lines.push(`Config: ${endpointCount} endpoint (${configured}/${cfg.length} OK)`);
    }

    // Verify
    const vrfy = allChecks.filter(c => c.section === 'verify');
    if (vrfy.length > 0) {
      const vOk = vrfy.filter(c => c.status === 'ok').length;
      const vTotal = vrfy.length;
      const models = verifyResults?.[0]?.modelList?.length || 0;
      lines.push(`Verify: ${vOk}/${vTotal} OK${models > 0 ? ` (${models} models)` : ''}`);
    }

    // Project
    const proj = allChecks.filter(c => c.section === 'project');
    if (proj.length > 0) {
      const archive = proj.find(c => c.msg.includes('Archive:'));
      lines.push(`Project: ${archive ? archive.msg.replace('Archive: ', '') : 'active'}`);
    }

    lines.push('─'.repeat(40));

    // Summary
    if (err === 0 && warn === 0) {
      lines.push(`✅ ${total} checks OK — Nythros siap!`);
    } else {
      lines.push(`${err > 0 ? '❌' : '⚠️'} ${total} checks: ${ok} OK, ${warn} warn, ${err} err`);
    }

    return lines.join('\n');
  });

  // /python
  registerCommand('python', async (args) => {
    if (args.length === 0) return "Usage: /python <code>";
    return "Python execution not implemented in slash command. Use agent instead.";
  });
}
