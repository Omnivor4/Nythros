import { buildSystemPrompt } from "./systemPrompt.js";
import { createProvider } from "../providers/index.js";
import { builtinTools } from "../tooling/tools.js";
import { isCircuitOpen, recordFailure } from "../infrastructure/state/errorWatchdog.js";

import * as docTools from "../tooling/docTools.js";
import * as gamedevTools from "../tooling/gamedevTools.js";
import { loadSkillTool } from "../tooling/skills/loader.js";
import * as obsidianTools from "../infrastructure/obsidian/vault.js";
import { isVaultConfigured } from "../infrastructure/obsidian/vault.js";

const docToolList = Object.values(docTools);
const gamedevToolList = Object.values(gamedevTools);
const obsidianToolList = Object.values(obsidianTools).filter(t => t && t.name && typeof t.execute === 'function');

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
      memory = "",
      skillsSummary = "",
      todo = "",
      lastError = ""
    } = options;

    onProgress({ type: 'start_turn' });

    if (isCircuitOpen()) {
      throw new Error("Circuit Breaker aktif karena terlalu banyak error beruntun. Coba lagi nanti.");
    }

    let messages = [...initialMessages, { role: 'user', content: userPrompt }];
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const maxIterations = 10;

    const obsidianConnected = isVaultConfigured();

    // Load available tools
    const activeTools = [...builtinTools];
    if (docToolList) activeTools.push(...docToolList);
    if (gamedevToolList) activeTools.push(...gamedevToolList);
    if (loadSkillTool) activeTools.push(loadSkillTool);
    if (obsidianConnected && obsidianToolList) activeTools.push(...obsidianToolList);

    // Instantiate provider based on config
    const provider = createProvider(this.config);

    // Build system prompt
    const systemPromptText = await buildSystemPrompt({
      memory,
      skillsSummary,
      todo,
      lastError,
      obsidianConnected,
      mode
    });

    for (let i = 0; i < maxIterations; i++) {
      if (isCircuitOpen()) {
        throw new Error("Circuit Breaker aktif karena terlalu banyak error beruntun. Coba lagi nanti.");
      }

      try {
        const result = await provider.send({
          system: systemPromptText,
          messages,
          tools: activeTools,
          effort,
          onProgress
        });

        if (result.usage) {
          totalUsage.prompt_tokens += result.usage.prompt_tokens || 0;
          totalUsage.completion_tokens += result.usage.completion_tokens || 0;
          totalUsage.total_tokens += result.usage.total_tokens || 0;
        }

        // Add assistant message (which includes tool_calls if any)
        messages.push(result.assistantMessage || { role: 'assistant', content: result.textOutput || '' });

        if (!result.toolCalls || result.toolCalls.length === 0) {
          onProgress({ type: 'done' });
          return { text: result.textOutput, messages, usage: totalUsage };
        }

        for (const call of result.toolCalls) {
          onProgress({ type: 'tool_start', tool: call.name, input: call.input });

          let outputString = "";
          const tool = activeTools.find(t => t.name === call.name);

          if (!tool) {
            outputString = `Error: tool "${call.name}" not found.`;
          } else {
            try {
              let inputArgs = call.input;
              if (typeof inputArgs === 'string') {
                inputArgs = JSON.parse(inputArgs);
              }
              const out = await tool.execute(inputArgs);
              outputString = typeof out === "string" ? out : JSON.stringify(out);
            } catch (err) {
              outputString = `Error executing tool "${call.name}": ${err.message}`;
            }
          }

          // Truncate output
          if (outputString.length > 15000) {
            outputString = outputString.substring(0, 15000) + "\n...[OUTPUT TRUNCATED]...";
          }

          onProgress({ type: 'tool_end', tool: call.name, output: outputString });

          const toolMsg = provider.buildToolResultMessage
            ? provider.buildToolResultMessage(call, outputString)
            : { role: "tool", tool_call_id: call.id, content: outputString };

          messages.push(toolMsg);
        }

      } catch (err) {
        recordFailure(err.message);
        throw err;
      }
    }

    onProgress({ type: 'done' });
    return { text: "⚠️ Max iterations reached.", messages, usage: totalUsage };
  }
}
