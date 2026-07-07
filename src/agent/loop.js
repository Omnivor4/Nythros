import { buildSystemPrompt } from "./systemPrompt.js";
import { createProvider } from "../providers/index.js";
import { builtinTools } from "../tooling/tools.js";
import { isCircuitOpen, recordFailure } from "../infrastructure/state/errorWatchdog.js";

// Helper to stream thinking
function streamThinking(text, onProgress) {
  const thoughtMatch = text.match(/<thought>([\s\S]*?)<\/thought>/);
  if (thoughtMatch) {
    onProgress({ type: 'stream', chunk: `\n[Thought]: ${thoughtMatch[1].trim()}\n` });
  }
}

// Helper to prune history: keep last 10, prepend summary
function pruneHistory(messages) {
  const system = messages.filter(m => m.role === 'system');
  const history = messages.filter(m => m.role !== 'system');

  if (history.length <= 10) return messages;

  const recent = history.slice(-10);
  const older = history.slice(0, -10);
  const summary = { role: 'assistant', content: `[Ringkasan percakapan sebelumnya: ${older.length} pesan diarsipkan.]` };

  return [...system, summary, ...recent];
}

// Agent loop logic
export async function runAgentLoop(messages, config, { onProgress }) {
  let currentMessages = pruneHistory(messages);
  const provider = createProvider(config);

  while (true) {
    if (isCircuitOpen()) throw new Error("Circuit breaker terbuka - stop auto-retry.");

    const response = await provider.chat(currentMessages);

    if (response.toolCalls && response.toolCalls.length > 0) {
      // Parallel tool execution
      const toolResults = await Promise.all(response.toolCalls.map(async (call) => {
        const tool = builtinTools.find(t => t.name === call.name);
        return {
          role: 'tool',
          name: call.name,
          content: await tool.execute(call.args)
        };
      }));

      currentMessages.push({ role: 'assistant', toolCalls: response.toolCalls }, ...toolResults);
      continue;
    }

    return { text: response.text, messages: currentMessages };
  }
}
