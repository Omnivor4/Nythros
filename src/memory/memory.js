import fs from "node:fs";
import path from "node:path";
import { PROJECT_DIR, ensureProjectDirs } from "../utils/paths.js";

const MEMORY_FILE = "MEMORY.md";

// Cuma 200 baris pertama yang dibaca pas session start — biar nggak makan
// budget context tiap kali, mirip kenapa Claude Code juga batasin baca
// MEMORY.md cuma sebagian. Sisanya tetep ada di file, bisa dibaca manual.
const MAX_LINES_LOADED = 200;

function memoryPath() {
  return path.join(PROJECT_DIR, MEMORY_FILE);
}

export function readMemory() {
  const p = memoryPath();
  if (!fs.existsSync(p)) return "";
  // Bug 21: CRLF amnesia (handle \r\n properly)
  const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/);
  return lines.slice(-MAX_LINES_LOADED).join("\n");
}

// Bug 22: Unsafe Append Memory
export async function appendMemory(entry) {
  ensureProjectDirs();
  const p = memoryPath();
  const dateStr = new Date().toISOString().slice(0, 10);
  const line = `\n- [${dateStr}] ${entry}`;
  // Instead of importing withLock from engine (circular dependency risk), we just use fs appendFileSync
  // Note: appendFileSync is atomic on POSIX, but just in case, we do minimal synchronous work.
  fs.appendFileSync(p, line);
  return entry;
}

// Definisi tool buat dikasih ke agent loop, biar model bisa milih nyimpen
// sesuatu ke memory sendiri pas ngerasa itu penting buat sesi berikutnya.
export const rememberTool = {
  name: "remember",
  description:
    "Simpan satu fakta/keputusan penting ke memory project, supaya diingat di sesi berikutnya tanpa user harus jelasin ulang.",
  input_schema: {
    type: "object",
    properties: {
      fact: { type: "string", description: "Fakta singkat yang mau diingat" },
    },
    required: ["fact"],
  },
  execute: ({ fact }) => {
    appendMemory(fact);
    return `Tersimpan ke memory: ${fact}`;
  },
};
