import fs from "node:fs";
import path from "node:path";
import { ensureHomeDirs, HOME_DIR } from "../shared/utils/paths.js";

const MEMORY_DIR = path.join(HOME_DIR, "memory");
const LONGTERM_PATH = path.join(MEMORY_DIR, "longterm.json");
const EPISODES_PATH = path.join(MEMORY_DIR, "episodes.json");

const DEFAULT_LONGTERM = {
  user_facts: [],
  preferences: {
    language: "id",
    verbosity: "concise",
    code_style: "modern",
    preferred_editor: "",
    preferred_browser: "",
    preferred_terminal: ""
  },
  projects: [],
  learned_shortcuts: [],
  correction_history: []
};

const DEFAULT_EPISODES = {
  episodes: []
};

let fsLock = Promise.resolve();

function readJsonFile(filePath, defaultData) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    console.error(`Error reading ${filePath}, JSON parse failed.`);
    // Bug 23: Backup corrupted file instead of silent overwrite
    const backupPath = filePath + `.bak-${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
    console.warn(`Corrupted memory backed up to ${backupPath}. Returning empty memory.`);
    return defaultData;
  }
}

function writeJsonFile(filePath, data) {
  ensureHomeDirs();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Helper to queue file operations
async function withLock(operation) {
  const currentLock = fsLock;
  let release;
  fsLock = new Promise(resolve => { release = resolve; });
  await currentLock;
  try {
    return await operation();
  } finally {
    release();
  }
}

// --- LONG TERM MEMORY ---

export function getLongtermMemory() {
  ensureHomeDirs();
  return readJsonFile(LONGTERM_PATH, DEFAULT_LONGTERM);
}

export function saveLongtermMemory(data) {
  writeJsonFile(LONGTERM_PATH, data);
}

export async function addFact(factStr, confidence = 1.0) {
  return withLock(async () => {
    const memory = getLongtermMemory();
    memory.user_facts.push({
      fact: factStr,
      confidence,
      added: new Date().toISOString()
    });
    
    // Prompt A5: Kebersihan Memory Jangka Panjang
    const { loadConfig } = await import("../config.js");
    const config = loadConfig();
    const maxFacts = config?.memory?.longterm_max_facts || 200;
    
    if (memory.user_facts.length > maxFacts) {
      // Sisakan 150 fakta terbaru (atau maxFacts - 50 jika maxFacts < 150, but usually we just keep 150)
      const keepCount = Math.min(150, maxFacts);
      memory.user_facts = memory.user_facts.slice(-keepCount);
    }

    saveLongtermMemory(memory);
    return true;
  });
}

export function getPreferences() {
  const memory = getLongtermMemory();
  return memory.preferences;
}

export function updatePreference(key, value) {
  const memory = getLongtermMemory();
  memory.preferences[key] = value;
  saveLongtermMemory(memory);
  return true;
}

// --- EPISODIC MEMORY ---

export function getEpisodes() {
  ensureHomeDirs();
  return readJsonFile(EPISODES_PATH, DEFAULT_EPISODES);
}

export function saveEpisodes(data) {
  writeJsonFile(EPISODES_PATH, data);
}

export async function addEpisode(description, status = "completed", tags = []) {
  return withLock(async () => {
    const mem = getEpisodes();
    mem.episodes.push({
      id: `ep_${Date.now()}`,
      date: new Date().toISOString(),
      description,
      status,
      tags
    });
    
    // Clean up old episodes to prevent bloat (e.g., keep last 50)
    if (mem.episodes.length > 50) {
      mem.episodes = mem.episodes.slice(-50);
    }
    
    saveEpisodes(mem);
    return true;
  });
}

// --- CONTEXT INJECTOR ---

export function buildMemoryContext() {
  const lt = getLongtermMemory();
  const activeProjects = lt.projects.filter(p => p.status === "active").map(p => p.name).join(", ");
  const facts = lt.user_facts.map(f => `- ${f.fact} (conf: ${f.confidence})`).join("\n");
  const prefs = JSON.stringify(lt.preferences);
  
  let context = `[LONG-TERM MEMORY]\nFacts:\n${facts || "None"}\n\nPreferences: ${prefs}\nActive Projects: ${activeProjects || "None"}\n`;
  
  const eps = getEpisodes().episodes.slice(-5); // get last 5 episodes
  if (eps.length > 0) {
    const epsStr = eps.map(e => `- [${e.date.split("T")[0]}] ${e.description} (${e.status})`).join("\n");
    context += `\n[RECENT EPISODES]\n${epsStr}\n`;
  }
  
  return context;
}

export const rememberTool = {
  name: "remember",
  description:
    "Simpan satu fakta/keputusan penting ke memory project, supaya diingat di sesi berikutnya tanpa user harus jelasin ulang.",
  input_schema: {
    type: "object",
    properties: {
      fact: { type: "string", description: "Fakta singkat yang mau diingat" },
      confidence: { type: "number", description: "Tingkat keyakinan (0.0 - 1.0)", default: 1.0 }
    },
    required: ["fact"],
  },
  execute: ({ fact, confidence }) => {
    addFact(fact, confidence);
    return `Tersimpan ke longterm memory: ${fact}`;
  },
};
