import { buildSystemPrompt } from './systemPrompt.js';
import { createProvider } from '../providers/index.js';
import { collectAllChecks } from '../presentation/doctor.js';
import { builtinTools } from '../tooling/tools.js';
import { isCircuitOpen, recordFailure } from '../infrastructure/state/errorWatchdog.js';

import * as docTools from '../tooling/docTools.js';
import * as gamedevTools from '../tooling/gamedevTools.js';
import { loadSkillTool } from '../tooling/skills/loader.js';
import * as obsidianTools from '../infrastructure/obsidian/vault.js';
import { isVaultConfigured } from '../infrastructure/obsidian/vault.js';
import { isNotionConfigured } from '../integrations/notion.js';
import { desktopTools, isDesktopSupported } from '../tooling/desktopTools.js';
import { safeError } from '../shared/utils/error.js';

const docToolList = Object.values(docTools);
const gamedevToolList = Object.values(gamedevTools);
const obsidianToolList = Object.values(obsidianTools).filter(
  (t) => t && t.name && typeof t.execute === 'function',
);

export class Agent {
  constructor(config) {
    this.config = config;
  }

  async process(userPrompt, options = {}) {
    const {
      effort = 'Medium',
      mode = 'general',
      initialMessages = [],
      onProgress = () => {},
      memory = '',
      skillsSummary = '',
      todo = '',
      lastError = '',
    } = options;

    onProgress({ type: 'start_turn' });

    if (isCircuitOpen()) {
      throw new Error(
        'Circuit Breaker aktif karena terlalu banyak error beruntun. Coba lagi nanti.',
      );
    }

    let messages = [...initialMessages, { role: 'user', content: userPrompt }];
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const maxIterations = 10;

    const obsidianConnected = isVaultConfigured();

    // Load available tools
    const activeTools = [...builtinTools];
    if (docToolList) activeTools.push(...docToolList);
    // Local gamedev tools only (filter out Notion tools which are loaded conditionally)
    if (gamedevToolList) {
      activeTools.push(
        ...gamedevToolList.filter(
          (t) => t.name !== 'read_gdd_notion' && t.name !== 'write_gdd_notion',
        ),
      );
    }
    if (loadSkillTool) activeTools.push(loadSkillTool);
    if (obsidianConnected && obsidianToolList) activeTools.push(...obsidianToolList);
    // Desktop automation tools (Windows only: screenshot, mouse, keyboard, windows)
    if (isDesktopSupported()) {
      activeTools.push(...desktopTools);
    }

    // Notion tools — kalau API key + page ID terkonfigurasi
    if (isNotionConfigured(this.config)) {
      if (gamedevToolList) {
        activeTools.push(
          ...gamedevToolList.filter(
            (t) => t.name === 'read_gdd_notion' || t.name === 'write_gdd_notion',
          ),
        );
      }
    }

    // Instantiate provider based on config
    const provider = createProvider(this.config);

    // Build system prompt
    // Doctor quick check — cari masalah konfigurasi sebelum mulai
    let doctorWarnings = '';
    try {
      const docData = await collectAllChecks(false);
      const issues = docData.allChecks.filter((c) => c.status === 'err' || c.status === 'warn');
      if (issues.length > 0) {
        const lines = issues.map((c) => {
          const tag = c.status === 'err' ? '❌' : '⚠️';
          return `${tag} [${c.section.toUpperCase()}] ${c.msg}`;
        });
        doctorWarnings = `\n## Peringatan Sistem\n${lines.join('\n')}\n`;
      }
    } catch (e) {
      doctorWarnings = `\n## Peringatan Sistem\n⚠️ [SYSTEM] Gagal ngecek status: ${safeError(e)}\n`;
    }

    const systemPromptText = await buildSystemPrompt({
      memory,
      skillsSummary,
      todo,
      lastError,
      doctorWarnings,
      obsidianConnected,
      mode,
    });

    for (let i = 0; i < maxIterations; i++) {
      try {
        const result = await provider.send({
          system: systemPromptText,
          messages,
          tools: activeTools,
          effort,
          onProgress,
        });

        if (result.usage) {
          totalUsage.prompt_tokens += result.usage.prompt_tokens || 0;
          totalUsage.completion_tokens += result.usage.completion_tokens || 0;
          totalUsage.total_tokens += result.usage.total_tokens || 0;
        }

        // Add assistant message
        messages.push(
          result.assistantMessage || { role: 'assistant', content: result.textOutput || '' },
        );

        if (!result.toolCalls || result.toolCalls.length === 0) {
          onProgress({ type: 'done' });
          return { text: result.textOutput, messages, usage: totalUsage };
        }

        // Parallel tool execution
        const toolResults = await Promise.all(
          result.toolCalls.map(async (call) => {
            onProgress({ type: 'tool_start', tool: call.name, input: call.input });

            let outputString;
            const tool = activeTools.find((t) => t.name === call.name);

            if (!tool) {
              outputString = `Error: tool "${call.name}" not found.`;
            } else {
              try {
                let inputArgs = call.input;
                if (typeof inputArgs === 'string') {
                  inputArgs = JSON.parse(inputArgs);
                }
                const out = await tool.execute(inputArgs);
                outputString = typeof out === 'string' ? out : JSON.stringify(out);
              } catch (err) {
                outputString = `Error executing tool "${call.name}": ${safeError(err)}`;
              }
            }

            // Truncate output
            if (outputString.length > 15000) {
              outputString = outputString.substring(0, 15000) + '\n...[OUTPUT TRUNCATED]...';
            }

            onProgress({ type: 'tool_end', tool: call.name, output: outputString });

            const toolMsg = provider.buildToolResultMessage
              ? provider.buildToolResultMessage(call, outputString)
              : { role: 'tool', tool_call_id: call.id, content: outputString };

            return toolMsg;
          }),
        );

        // Push all results
        for (const msg of toolResults) messages.push(msg);
      } catch (err) {
        recordFailure(safeError(err));
        throw err;
      }
    }

    onProgress({ type: 'done' });
    return { text: '⚠️ Max iterations reached.', messages, usage: totalUsage };
  }
}
