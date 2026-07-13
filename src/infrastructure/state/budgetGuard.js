import { loadConfig } from "../../shared/config.js";

// State in-memory per proses CLI
let sessionTokens = {
  prompt: 0,
  completion: 0,
  total: 0
};

export function recordTokenUsage(usage) {
  if (!usage) return;
  
  if (typeof usage.prompt_tokens === 'number') {
    sessionTokens.prompt += usage.prompt_tokens;
  }
  if (typeof usage.completion_tokens === 'number') {
    sessionTokens.completion += usage.completion_tokens;
  }
  if (typeof usage.total_tokens === 'number') {
    sessionTokens.total += usage.total_tokens;
  } else if (usage.prompt_tokens && usage.completion_tokens) {
    sessionTokens.total += (usage.prompt_tokens + usage.completion_tokens);
  }
}

export function budgetStatus() {
  const config = loadConfig();
  // Safe default to 300,000 if not present
  const limit = config?.budget?.session_token_limit || 300000;
  const used = sessionTokens.total;
  const percent = Math.min(100, Math.round((used / limit) * 100));
  
  return {
    used,
    limit,
    percent,
    prompt: sessionTokens.prompt,
    completion: sessionTokens.completion
  };
}

export function isBudgetExceeded() {
  const status = budgetStatus();
  return status.used >= status.limit;
}

// Hanya untuk keperluan testing
export function _resetBudgetForTest() {
  sessionTokens = { prompt: 0, completion: 0, total: 0 };
}
