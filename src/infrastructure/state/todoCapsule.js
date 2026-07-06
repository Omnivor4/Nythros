import fs from "node:fs";
import path from "node:path";
import { PROJECT_DIR, ensureProjectDirs } from "../utils/paths.js";

const CAPSULE_FILE = "todo-capsule.json";

function capsulePath() {
  return path.join(PROJECT_DIR, CAPSULE_FILE);
}

export function readCapsule() {
  const p = capsulePath();
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    return data.text || null;
  } catch (err) {
    return null;
  }
}

export function writeCapsule(text) {
  ensureProjectDirs();
  fs.writeFileSync(capsulePath(), JSON.stringify({ text }, null, 2));
}

export const updateTodoTool = {
  name: "update_todo",
  description: "Update atau simpan catatan todo list langkah-langkah yang sedang/akan dikerjakan. Selalu pakai ini kalau ada progress baru.",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Isi lengkap todo list dalam format markdown" },
    },
    required: ["text"],
  },
  execute: ({ text }) => {
    writeCapsule(text);
    return `Todo list berhasil disimpan (${text.length} karakter).`;
  },
};
