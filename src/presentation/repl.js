import { render } from 'ink';
import { html } from './ui/htm.js';
import { App } from './ui/App.js';
import { Agent } from '../agent/Agent.js';
import { MCP_PRESETS } from '../infrastructure/mcp/presets.js';
import { syncMcpServers } from '../infrastructure/mcp/mcpLoader.js';
import { isVaultConfigured, appendChatLog } from '../infrastructure/obsidian/vault.js';
import { loadConfig, saveConfig } from '../shared/config.js';
import { recordTokenUsage } from '../infrastructure/state/budgetGuard.js';
import { registerAllCommands } from '../tooling/slashRegistry.js';

async function runShutdown(messages, config) {
  if (!messages || messages.length === 0) return;

  try {
    const userMessages = messages.filter((m) => m.role === 'user');
    if (userMessages.length > 0) {
      // Memory engine integration goes here
    }

    if (isVaultConfigured() && config.obsidian?.auto_save_tasks) {
      const chatText = messages
        .filter((m) => m.role === 'user' || m.role === 'agent')
        .map((m) => `**${m.role}**: ${m.text}`)
        .join('\n\n');
      if (chatText) {
        const noteTitle = `Chat_${new Date().toISOString().split('T')[0]}`;
        await appendChatLog(noteTitle, chatText).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}

export async function startRepl(language = 'en') {
  registerAllCommands();
  const config = loadConfig();

  // Auto-install MCP presets if not configured
  let updated = false;
  config.mcpServers = config.mcpServers || [];
  for (const preset of MCP_PRESETS) {
    if (!config.mcpServers.some((s) => s.name === preset.name)) {
      config.mcpServers.push({ name: preset.name, command: preset.command });
      updated = true;
    }
  }
  if (updated) {
    saveConfig(config);
  }
  await syncMcpServers();

  const agent = new Agent(config);
  let sessionModel = '';
  let lastMessages = [];

  const runAgentWrapper = async ({ input, effort, conversationHistory, onProgress }) => {
    const msgs = conversationHistory.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));

    onProgress({ type: 'start_turn' });

    const result = await agent.process(input, {
      effort,
      initialMessages: msgs,
      onProgress,
    });

    if (result.usage) {
      // Consolidate ke budgetGuard — satu sumber kebenaran
      recordTokenUsage(result.usage);
      if (onProgress) {
        onProgress({ type: 'usage', usage: result.usage, model: sessionModel });
      }
    }

    lastMessages = [...msgs, { role: 'user', text: input }, { role: 'agent', text: result.text }];
    appendChatLog(input, result.text).catch(() => {});
    return result;
  };

  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  let version = '0.3.0';
  try {
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    version = pkg.version || version;
  } catch {
    /* ignore */
  }

  const onExit = async () => {
    await runShutdown(lastMessages, loadConfig());
    process.stdout.write('\x1b[?1049l\x1b[?25h');
    process.stderr.write(
      `\n✓ Session disimpan. (${lastMessages.length} pesan)\nSampai ketemu lagi!\n`,
    );
    process.exit(0);
  };

  // === SIGINT handler khusus REPL ===
  // Panggil onExit biar runShutdown jalan (save chat ke Obsidian, archive, dll)
  const sigintHandler = () => {
    onExit();
  };
  process.on('SIGINT', sigintHandler);

  const app = render(
    html`<${App}
      defaultProvider=${'default'}
      language=${language}
      runAgentWrapper=${runAgentWrapper}
      onExit=${onExit}
      version=${version}
    />`,
    { exitOnCtrlC: false },
  );

  await app.waitUntilExit();

  // Cleanup: remove SIGINT handler + restore terminal
  process.removeListener('SIGINT', sigintHandler);
  process.stdout.write('\x1b[?1049l\x1b[?25h');
  process.exit(0);
}
