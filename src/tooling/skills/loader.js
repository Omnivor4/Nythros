import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSkills, readSkillBody } from "./installer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILLS_DIR = path.join(__dirname, "../../.agents/skills");

// Bug 46: Skill Init Lag (Cache after first read)
let cachedSkills = null;

// Cuma nama + deskripsi singkat yang nempel terus di system prompt — biar
// nggak boros context walau skill yang ke-install banyak. Isi lengkap
// SKILL.md baru dimuat kalau model beneran milih buat pakai skill itu,
// lewat tool load_skill di bawah. Pattern ini sama kayak gimana skill
// bawaan Claude sendiri kerja: deskripsi nempel, isi lengkap dimuat on-demand.
export function skillsSummaryForPrompt() {
  const skills = listSkills();
  if (skills.length === 0) return "(belum ada skill yang di-install)";
  return skills.map((s) => {
    // Bug 18: Prompt Injection di Skills (Strip markdown links completely)
    let desc = s.description.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1"); 
    desc = desc.replace(/[\r\n`]/g, " ").trim();
    if (desc.length > 200) desc = desc.substring(0, 197) + "...";
    return `- ${s.name}: ${desc}`;
  }).join("\n");
}

export const loadSkillTool = {
  name: "load_skill",
  description:
    "Muat isi lengkap satu skill yang sudah terinstall, kalau dirasa relevan buat menyelesaikan task saat ini.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Nama skill, sesuai yang muncul di daftar skill" },
    },
    required: ["name"],
  },
  execute: ({ name }) => {
    // Bug 47: Path Traversal di loadSkill
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
      return `Error: Security Block. Nama skill "${name}" tidak valid.`;
    }
    return readSkillBody(name);
  }
};
