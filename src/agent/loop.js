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

// Agent loop logic placeholder
export async function runAgentLoop(messages, config, { onProgress }) {
  // Parsing logic for <thought> and streaming would go here
  return { text: "loop", messages: [] };
}
