// src/utils/pricing.js
// Harga dalam USD per 1 juta token (per-million token pricing)
// Update berkala — ini estimasi, bukan garansi akurasi
const MODEL_PRICING = {
  // OpenAI
  "gpt-4o":                    { input: 2.50,  output: 10.00 },
  "gpt-4o-mini":               { input: 0.15,  output: 0.60  },
  "gpt-4-turbo":               { input: 10.00, output: 30.00 },
  "gpt-3.5-turbo":             { input: 0.50,  output: 1.50  },

  // Anthropic (via OpenRouter atau Anthropic direct)
  "claude-opus-4":             { input: 15.00, output: 75.00 },
  "claude-sonnet-4-5":         { input: 3.00,  output: 15.00 },
  "claude-haiku-4-5":          { input: 0.80,  output: 4.00  },
  "anthropic/claude-opus-4":   { input: 15.00, output: 75.00 },
  "anthropic/claude-sonnet-4": { input: 3.00,  output: 15.00 },
  "anthropic/claude-haiku":    { input: 0.80,  output: 4.00  },

  // Google (via OpenRouter)
  "google/gemini-pro":         { input: 0.125, output: 0.375 },
  "google/gemini-flash":       { input: 0.075, output: 0.30  },

  // Meta (via OpenRouter/Ollama)
  "meta-llama/llama-3.1-70b":  { input: 0.52,  output: 0.75  },
  "meta-llama/llama-3.1-8b":   { input: 0.06,  output: 0.06  },
};

// Fallback kalau model tidak ada di daftar
const UNKNOWN_PRICING = { input: 1.00, output: 3.00 };

/**
 * Hitung estimasi biaya dari usage.
 * @param {object} usage - { prompt_tokens, completion_tokens }
 * @param {string} model - nama model
 * @returns {{ inputCost: number, outputCost: number, totalCost: number, currency: "USD", isEstimate: boolean }}
 */
export function estimateCost(usage, model = "") {
  // Cari pricing — coba exact match dulu, lalu partial match
  let pricing = MODEL_PRICING[model];
  if (!pricing) {
    const modelLower = model.toLowerCase();
    const key = Object.keys(MODEL_PRICING).find(k => modelLower.includes(k.toLowerCase()));
    pricing = key ? MODEL_PRICING[key] : UNKNOWN_PRICING;
  }

  const inputCost  = (usage.prompt_tokens     || 0) / 1_000_000 * pricing.input;
  const outputCost = (usage.completion_tokens || 0) / 1_000_000 * pricing.output;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency: "USD",
    isEstimate: !MODEL_PRICING[model], // true kalau pakai fallback/partial match
  };
}

/**
 * Format biaya jadi string yang enak dibaca.
 * Di bawah $0.01 → tampilkan dalam milli-dollar ($0.001)
 */
export function formatCost(cost) {
  if (!cost || typeof cost.totalCost !== "number") return "`$0.00";
  if (cost.totalCost === 0) return "`$0.00";
  if (cost.totalCost < 0.001) return "<`$0.001";
  if (cost.totalCost < 0.01)  return "`$" + cost.totalCost.toFixed(4);
  return "`$" + cost.totalCost.toFixed(3);
}

/**
 * Format usage jadi string ringkas.
 */
export function formatUsage(usage) {
  if (!usage) return "0 tokens (↑0 ↓0)";
  const total = (usage.total_tokens || 0).toLocaleString();
  const inp   = (usage.prompt_tokens || 0).toLocaleString();
  const out   = (usage.completion_tokens || 0).toLocaleString();
  return total + " tokens (↑" + inp + " ↓" + out + ")";
}

