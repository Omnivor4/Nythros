// src/tooling/slashRegistry.js
// Simple command registry for Nythros slash commands

const commands = new Map();

// Command descriptions for /help
const commandHelp = {
  help: 'Show available slash commands',
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
    "  /skill [add|list|remove] - Manage GitHub skills",
    "  /config [show]           - Show Nythros configuration",
    "  /memory                  - View current project memory",
    "  /budget                  - Check token budget limit",
    "  /cost                    - View session token usage & estimated cost",
    "  /endpoints               - List configured endpoints",
    "  /archive                 - View archived summaries",
    "  /mcp                     - Model Context Protocol integration",
    "  /tools                   - List all active tools",
    "  /mode                    - Show current mode",
    "  /python <code>           - Run Python code snippet",
    "  /clear                   - Clear the terminal screen",
    "  /exit                    - Exit Nythros",
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
      const cfg = loadConfig();
      if (cfg.endpoints && cfg.endpoints[0]) {
        cfg.endpoints[0].api_key = cfg.endpoints[0].api_key ? "***" : "(not set)";
      }
      return JSON.stringify(cfg, null, 2);
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
    }
    return "Usage: /mcp list";
  });

  // /tools
  registerCommand('tools', async () => {
    return `Active tools (${builtinTools.length}):\n` + builtinTools.map(t => `  - ${t.name}`).join("\n");
  });

  // /mode
  registerCommand('mode', async () => "Current Mode: general");

  // /python
  registerCommand('python', async (args) => {
    if (args.length === 0) return "Usage: /python <code>";
    return "Python execution not implemented in slash command. Use agent instead.";
  });
}
