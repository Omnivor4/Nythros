import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig } from "../shared/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const promptPath = path.join(__dirname, "../../PROMPT.md");

let cachedBasePrompt = "";
try {
  cachedBasePrompt = fs.readFileSync(promptPath, "utf-8");
} catch (e) {
  cachedBasePrompt = "Kamu adalah Nythros, AI coding agent.";
}

const thinkingInstruction = `
<THINKING_INSTRUCTION>
Sebelum beraksi, KAMU WAJIB:
1. Nilai ambiguitas prompt. Jika tidak jelas, tanya balik.
2. Berpikir langkah-demi-langkah.
3. Output pemikiran di dalam tag <thought>.
</THINKING_INSTRUCTION>
`;

export async function buildSystemPrompt({ memory, skillsSummary, todo, lastError, doctorWarnings, obsidianConnected, mode = "general" }) {
  const obsidianText = obsidianConnected
    ? "Vault user terhubung. Kamu bisa cari/baca/tulis note pakai tool obsidian_search, obsidian_read_note, obsidian_write_note."
    : "(Obsidian Vault belum di-configure)";

  let archiveSummary = "";
  try {
    const { readRecentArchive } = await import("../memory/archive.js");
    const recent = readRecentArchive(2); // 2 arsip terbaru
    if (recent.length > 0) {
      archiveSummary = "\n\n## Konteks Arsip Percakapan Sebelumnya\n"
        + recent.map(e =>
            `[${new Date(e.timestamp).toLocaleDateString("id-ID")}] ${e.summary.substring(0, 300)}`
          ).join("\n\n");
    }
  } catch (e) {}

  let finalPrompt = cachedBasePrompt
    .replace("{{MEMORY}}", memory || "(belum ada catatan)")
    .replace("{{ARCHIVE_SUMMARY}}", archiveSummary)
    .replace("{{SKILLS_SUMMARY}}", skillsSummary || "(belum ada skill)")
    .replace("{{TODO_CAPSULE}}", todo || "(belum ada todo)")
    .replace("{{LAST_ERROR}}", lastError || "")
    .replace("{{DOCTOR_WARNINGS}}", doctorWarnings || "")
    .replace("{{OBSIDIAN_VAULT}}", obsidianText)
    .replace("{{THINKING_INSTRUCTION}}", thinkingInstruction);

  const languageInstruction = `\n## Bahasa\nSelalu balas pakai bahasa yang dipakai user di prompt mereka.\n`; 
  finalPrompt = finalPrompt.replace("{{LANGUAGE_INSTRUCTION}}", languageInstruction);

  const toolsByMode = {
    execute: [
      "read_file, write_file, edit_file, list_dir, run_command",
      "remember, update_todo, load_skill",
      "read_gdd, read_balance",
      "generate_docx, generate_xlsx, generate_pdf",
      "execute_python, analyze_image",
      obsidianConnected ? "obsidian_search, obsidian_read_note, obsidian_write_note" : null
    ].filter(Boolean).join(", "),
    plan: [
      "read_file, list_dir",
      obsidianConnected ? "obsidian_search, obsidian_read_note" : null
    ].filter(Boolean).join(", "),
    general: [
      "read_file, write_file, edit_file, list_dir, run_command",
      "remember, update_todo, load_skill",
      "read_gdd, read_balance",
      "generate_docx, generate_xlsx, generate_pdf",
      "execute_python, analyze_image",
      obsidianConnected ? "obsidian_search, obsidian_read_note, obsidian_write_note" : null
    ].filter(Boolean).join(", ")
  };

  const activeTools = toolsByMode[mode] || toolsByMode.general;
  finalPrompt = finalPrompt.replace("{{ACTIVE_TOOLS}}", activeTools);

  let modeInstruction = "";
  if (mode === "plan") {
    modeInstruction = "🚨 [CURRENT MODE: PLAN] 🚨\nKamu hanya menganalisa, mencari informasi, membaca file, dan membuat rencana. Tidak mengubah file atau menjalankan perintah.\n\n";
  } else if (mode === "execute" || mode === "general") {
    modeInstruction = `⚡ [CURRENT MODE: ${mode.toUpperCase()}] ⚡\nKamu memiliki akses penuh ke sistem, termasuk modifikasi file dan eksekusi terminal.\n\n`;
  }
  return modeInstruction + finalPrompt;
}
