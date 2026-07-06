import fs from "node:fs";
import path from "node:path";
import { ensureHomeDirs, HOME_DIR } from "../utils/paths.js";
import { loadConfig } from "../config.js";
import { OpenAICompatibleProvider } from "../providers/openaiCompatible.js";

const EVO_DIR = path.join(HOME_DIR, "evolution");
const OBSERVATIONS_PATH = path.join(EVO_DIR, "observations.jsonl");
const PATCHES_PATH = path.join(EVO_DIR, "behavior_patches");

/**
 * Ringkas observasi mentah jadi format compact buat prompt LLM.
 * Menghindari dump JSON besar yang boros token.
 */
function summarizeObservations(observations) {
  return observations.map((obs, i) => {
    const tools = (obs.tool_calls || []).map(tc => {
      if (typeof tc === "string") return tc;
      return tc.name || tc.tool || "unknown";
    });
    const durationSec = obs.duration_ms ? (obs.duration_ms / 1000).toFixed(1) + "s" : "?";
    const taskSnippet = (obs.task_input || "").substring(0, 120);
    const success = obs.success_score >= 0.5 ? "OK" : "GAGAL";
    return `${i + 1}. [${success}] "${taskSnippet}" | tools: [${tools.join(", ")}] | durasi: ${durationSec}`;
  }).join("\n");
}

/**
 * Jalankan analisis pola dari observasi pemakaian user.
 * Memanggil LLM SATU kali untuk menganalisis, lalu simpan hasilnya sebagai behavior patch.
 * 
 * @returns {object|null} PatternReport patch, atau null jika gagal/tidak cukup data.
 */
export async function runMiniCycleAnalyzer() {
  ensureHomeDirs();
  if (!fs.existsSync(OBSERVATIONS_PATH)) return null;

  const raw = fs.readFileSync(OBSERVATIONS_PATH, "utf-8").trim();
  if (!raw) return null;

  const allLines = raw.split("\n").filter(Boolean);
  if (allLines.length < 5) {
    // Tunggu minimal 5 observasi baru analisis
    return null;
  }

  // Ambil 20 observasi terakhir saja
  const recentLines = allLines.slice(-20);
  let observations;
  try {
    observations = recentLines.map(l => JSON.parse(l));
  } catch (e) {
    // JSONL corrupt, skip tanpa crash
    return null;
  }

  const summary = summarizeObservations(observations);

  // Siapkan provider dari config aktif user
  const config = loadConfig();
  const endpoint = config.endpoints?.[0];
  if (!endpoint || !endpoint.api_key || !endpoint.base_url) {
    // Tidak ada provider terkonfigurasi, skip analisis
    return null;
  }

  const provider = new OpenAICompatibleProvider({
    apiKey: endpoint.api_key,
    model: endpoint.model || "gpt-4o-mini",
    baseURL: endpoint.base_url,
  });

  const analysisPrompt = `Kamu adalah sistem analisis pola untuk AI coding agent bernama Nythros.
Berikut adalah ringkasan ${observations.length} task terakhir yang dikerjakan:

${summary}

Identifikasi:
1. Tool apa yang paling sering dipakai dan dalam konteks apa
2. Jenis task apa yang paling sering gagal atau membutuhkan banyak turns
3. Pola permintaan user yang berulang
4. Saran konkret untuk system prompt atau tool descriptions yang bisa meningkatkan performa di task serupa berikutnya

Jawab HANYA dalam JSON valid (tanpa markdown fencing) dengan format berikut:
{
  "frequent_tools": ["tool_name1", "tool_name2"],
  "failure_patterns": ["deskripsi pola kegagalan"],
  "user_patterns": ["deskripsi pola permintaan user"],
  "suggestions": [{ "target": "system_prompt", "suggestion": "saran konkret" }]
}`;

  let llmResponse;
  try {
    const result = await provider.send({
      system: "Kamu adalah analyzer internal Nythros. Jawab hanya dalam JSON valid.",
      messages: [{ role: "user", content: analysisPrompt }],
      tools: [], // Tidak perlu tool calling untuk analisis
    });
    llmResponse = result.textOutput;
  } catch (err) {
    // LLM call gagal — graceful failure, return null
    return null;
  }

  if (!llmResponse) return null;

  // Parse JSON dari response LLM
  let analysisData;
  try {
    // Bersihkan jika LLM tetap membungkus dalam markdown
    const cleaned = llmResponse.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    analysisData = JSON.parse(cleaned);
  } catch (e) {
    // LLM mengembalikan response yang bukan JSON valid — fallback
    return null;
  }

  // Bangun patch report dengan shape yang kompatibel
  const patchId = `patch_${Date.now()}`;
  const patch = {
    id: patchId,
    timestamp: new Date().toISOString(),
    pattern_detected: [
      ...(analysisData.user_patterns || []),
      ...(analysisData.failure_patterns || []),
    ].join("; ") || "Tidak ada pola terdeteksi.",
    proposed_behavior: (analysisData.suggestions || [])
      .map(s => `[${s.target}] ${s.suggestion}`)
      .join(" | ") || "Tidak ada saran.",
    frequent_tools: analysisData.frequent_tools || [],
    failure_patterns: analysisData.failure_patterns || [],
    user_patterns: analysisData.user_patterns || [],
    suggestions: analysisData.suggestions || [],
    observations_analyzed: observations.length,
    status: "active"
  };

  // Simpan patch
  if (!fs.existsSync(PATCHES_PATH)) fs.mkdirSync(PATCHES_PATH, { recursive: true });
  fs.writeFileSync(path.join(PATCHES_PATH, `${patchId}.json`), JSON.stringify(patch, null, 2));

  // Clear observasi yang sudah dianalisis (mini cycle selesai)
  fs.writeFileSync(OBSERVATIONS_PATH, "");

  return patch;
}
