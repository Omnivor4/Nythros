import fs from "node:fs";
import path from "node:path";
import { ensureHomeDirs, HOME_DIR } from "../utils/paths.js";

const EVO_DIR = path.join(HOME_DIR, "evolution");
const OBSERVATIONS_PATH = path.join(EVO_DIR, "observations.jsonl");

import { estimateCost } from "../utils/pricing.js";

export function logObservation(taskInput, finalOutput, toolCalls, durationMs, successScore = 1.0, usage = null, model = "") {
  ensureHomeDirs();
  
  const entry = {
    timestamp: new Date().toISOString(),
    task_input: taskInput,
    final_output: finalOutput,
    tool_calls: toolCalls,
    duration_ms: durationMs,
    success_score: successScore,
    usage: usage || null,
    estimated_cost_usd: usage ? estimateCost(usage, model || "").totalCost : null,
  };
  
  fs.appendFileSync(OBSERVATIONS_PATH, JSON.stringify(entry) + "\n");
}
