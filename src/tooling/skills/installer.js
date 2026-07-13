import fs from "node:fs";
import path from "node:path";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import matter from "gray-matter";

const execAsync = promisify(exec);
import { HOME_DIR, ensureHomeDirs } from "../../shared/utils/paths.js";

const SKILLS_DIR = path.join(HOME_DIR, "skills");
const REGISTRY_PATH = path.join(HOME_DIR, "skills", "registry.json");

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return [];
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
}

function saveRegistry(list) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(list, null, 2));
}

function repoNameFromUrl(url) {
  const cleaned = url.replace(/\.git$/, "").replace(/\/$/, "");
  return cleaned.split("/").pop();
}

// Bug 46: Skill Init Lag
export function listSkills() {
  return loadRegistry();
}

// Cari SKILL.md di root repo, atau satu level di bawah (banyak repo skill
// nyimpennya di subfolder, kayak pattern /mnt/skills/public/<nama>/SKILL.md
// yang dipakai Claude sendiri).
function findSkillFile(repoDir) {
  const rootCandidate = path.join(repoDir, "SKILL.md");
  if (fs.existsSync(rootCandidate)) return rootCandidate;

  const entries = fs.readdirSync(repoDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = path.join(repoDir, entry.name, "SKILL.md");
      if (fs.existsSync(nested)) return nested;
    }
  }
  return null;
}

export async function installSkill(repoUrl) {
  ensureHomeDirs();
  const name = repoNameFromUrl(repoUrl);
  const dest = path.join(SKILLS_DIR, name);

  if (fs.existsSync(dest)) {
    throw new Error(`Skill "${name}" udah pernah di-install. Hapus dulu pakai: nythros skill remove ${name}`);
  }

  await new Promise((resolve, reject) => {
    const child = spawn("git", ["clone", "--depth", "1", repoUrl, dest], { stdio: "ignore" });
    const timeoutId = setTimeout(() => {
      child.kill();
      reject(new Error("Timeout cloning skill repo. Network might be slow."));
    }, 60000);
    child.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code === 0) resolve();
      else reject(new Error("Git clone failed with code " + code));
    });
    child.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });

  const skillFile = findSkillFile(dest);
  if (!skillFile) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new Error(`Repo "${repoUrl}" nggak punya SKILL.md — bukan skill yang valid.`);
  }

  const { data: frontmatter } = matter(fs.readFileSync(skillFile, "utf-8"));
  const entry = {
    name: frontmatter.name || name,
    description: frontmatter.description || "(tidak ada deskripsi)",
    path: skillFile,
    repoUrl,
  };

  const registry = loadRegistry().filter((s) => s.name !== entry.name);
  registry.push(entry);
  saveRegistry(registry);

  return entry;
}

// Duplicate listSkills removed

export function removeSkill(name) {
  const registry = loadRegistry();
  const entry = registry.find((s) => s.name === name);
  if (!entry) throw new Error(`Skill "${name}" tidak ditemukan.`);

  const skillDir = path.dirname(entry.path);
  fs.rmSync(skillDir, { recursive: true, force: true });
  saveRegistry(registry.filter((s) => s.name !== name));
  return entry;
}

export function readSkillBody(name) {
  const entry = loadRegistry().find((s) => s.name === name);
  if (!entry) throw new Error(`Skill "${name}" tidak ditemukan.`);
  const { content } = matter(fs.readFileSync(entry.path, "utf-8"));
  return content;
}
