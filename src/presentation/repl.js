import React from 'react';
import { render } from 'ink';
import { html } from './ui/htm.js';
import { App } from './ui/App.js';
import { Agent } from '../agent/Agent.js';
import { isVaultConfigured, appendChatLog } from '../infrastructure/obsidian/vault.js';
import { loadConfig } from '../shared/config.js';

async function runShutdown(messages, config) {
  if (!messages || messages.length === 0) return;

  try {
    const userMessages = messages.filter(m => m.role === "user");
    const sessionSummary = `Session ${new Date().toLocaleDateString("id-ID")}: `
      + `${userMessages.length} pesan, task: `
      + (userMessages[0]?.text?.substring(0, 80) || "unknown");

    if (userMessages.length > 0) {
      // Memory engine integration goes here
    }

    if (isVaultConfigured() && config.obsidian?.auto_save_tasks) {
      const chatText = messages
        .filter(m => m.role === "user" || m.role === "agent")
        .map(m => `**${m.role}**: ${m.text}`)
        .join("\n\n");
      if (chatText) {
        const noteTitle = `Chat_${new Date().toISOString().split("T")[0]}`;
        await appendChatLog(noteTitle, chatText).catch(() => {});
      }
    }
  } catch (e) {
    // ignore
  }
}

export async function startRepl(kernel, language = "en") {
  const agent = new Agent(kernel);
  let sessionTotalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let sessionModel = "";
  let lastMessages = [];

  const runAgentWrapper = async ({ input, mode, effort, conversationHistory, onProgress }) => {
    
    // Slash commands interception
    if (input.startsWith("/")) {
      const args = input.slice(1).split(" ");
      const cmd = args[0].toLowerCase();
      let output = "";
      
      switch (cmd) {
        case "help":
          output = [
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
          break;
        case "skill":
          if (args[1] === "list") {
            const skillRegistry = kernel.getService('skillRegistry');
            const skills = skillRegistry.getAllSkills();
            if (skills.length === 0) output = "No skills installed yet.";
            else output = skills.map(s => "- " + s.name + ": " + s.description).join("\n");
          } else {
            output = "Usage: /skill [list | add <url> | remove <name>] - Refactored version in progress";
          }
          break;
        case "config":
          if (args[1] === "show") {
            const cfg = loadConfig();
            if (cfg.endpoints && cfg.endpoints[0]) {
               cfg.endpoints[0].api_key = cfg.endpoints[0].api_key ? "***" : "(not set)";
            }
            output = JSON.stringify(cfg, null, 2);
          } else {
            output = "Usage: /config show";
          }
          break;
        case "memory":
          output = "(memory context view not yet re-integrated)";
          break;
        case "archive":
          output = "Arsip Percakapan akan segera hadir kembali di v0.4.";
          break;
        case "budget":
        case "cost":
        case "endpoints":
          output = "Fitur " + cmd + " sedang dimigrasi ke Kernel.";
          break;
        case "mcp":
          output = "MCP integration commands are being migrated to the new Architecture.";
          break;
        case "tools": {
          const registry = kernel.getService('toolRegistry');
          const toolList = registry.getAllTools();
          output = `Active tools (${toolList.length}):\n` + toolList.map(t => `  - ${t.name}`).join("\n");
          break;
        }
        case "mode":
          output = "Current Mode: " + mode.toUpperCase();
          break;
        case "exit":
        case "quit":
          return { text: "" };
        case "clear":
          return { text: "" };
        default:
          output = "Unknown command: /" + cmd + ". Type /help for available commands.";
      }
      
      onProgress({ type: 'stream', chunk: output, isSystem: true });
      onProgress({ type: 'done' });
      return { text: output };
    }

    const msgs = conversationHistory.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
    
    onProgress({ type: 'start_turn' });

    // Hook up agent events to REPL progress
    const events = kernel.getService('events');
    const unsubStart = events.on('tool:start', data => onProgress({ type: 'tool_start', tool: data.tool, input: data.input }));
    const unsubEnd = events.on('tool:end', data => onProgress({ type: 'tool_end', tool: data.tool, output: data.output }));

    const result = await agent.process(input, {
      effort,
      initialMessages: msgs
    });
    
    unsubStart();
    unsubEnd();
    
    if (result.usage) {
      sessionTotalUsage.prompt_tokens += result.usage.prompt_tokens || 0;
      sessionTotalUsage.completion_tokens += result.usage.completion_tokens || 0;
      sessionTotalUsage.total_tokens += result.usage.total_tokens || 0;
      if (onProgress) {
        onProgress({ type: "usage", usage: result.usage, model: sessionModel });
      }
    }
    
    lastMessages = [...msgs, { role: 'user', text: input }, { role: 'agent', text: result.text }];
    appendChatLog(input, result.text).catch(() => {});
    return result;
  };

  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  let version = "0.3.0";
  try {
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    version = pkg.version || version;
  } catch (e) { /* ignore */ }

  const onExit = async () => {
    await runShutdown(lastMessages, loadConfig());
    process.stdout.write('\x1b[?1049l\x1b[?25h');
    process.stderr.write(`\n✓ Session disimpan. (${lastMessages.length} pesan)\nSampai ketemu lagi!\n`);
    process.exit(0);
  };

  const app = render(
    html`<${App} defaultProvider=${"default"} language=${language} runAgentWrapper=${runAgentWrapper} onExit=${onExit} version=${version} />`,
    { exitOnCtrlC: false }
  );
  
  await app.waitUntilExit();
  
  process.stdout.write('\x1b[?1049l\x1b[?25h');
  process.exit(0);
}
