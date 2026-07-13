import fs from "node:fs";
import path from "node:path";
import { isProtectedPath, looksDangerous, commandTouchesProtectedPath, askConfirmation, getConfirmMode, needsNetwork } from "../shared/utils/confirm.js";
import { updateTodoTool } from "../infrastructure/state/todoCapsule.js";
import { runInDocker } from "../infrastructure/core/dockerSandbox.js";
import { loadConfig } from "../shared/config.js";

const PROTECTED_PATHS = ["~/.nythros", ".nythros", "config.json"];

// Bug (audit): read_file/edit_file punya enforcement lebih longgar dari write_file,
// sehingga bisa dipakai baca/edit file di luar project root (termasuk ~/.nythros/config.json
// yang menyimpan API key plaintext). Helper ini menyatukan aturan untuk read/write/edit,
// dan juga menghormati safety.protected_paths dari config (bukan cuma 3 path hardcoded).
function pathSafetyError(p, { allowOutsideProject = false } = {}) {
  if (!p || typeof p !== "string") return "Error: path harus berupa string.";
  if (p.indexOf("\0") !== -1) return "Error: Security block (Null byte detected).";

  let configuredProtected = [];
  try {
    configuredProtected = loadConfig()?.safety?.protected_paths || [];
  } catch (e) {
    // fall back to hardcoded list only
  }
  if (isProtectedPath(p, [...PROTECTED_PATHS, ...configuredProtected])) {
    return `Error: Security block. Path "${p}" is protected.`;
  }

  if (!allowOutsideProject) {
    const resolvedPath = path.resolve(p);
    const projectRoot = path.resolve(process.cwd());
    if (!(resolvedPath === projectRoot || resolvedPath.startsWith(projectRoot + path.sep))) {
      return `Error: Security block. Cannot access files outside of the project directory (${projectRoot}).`;
    }
  }
  return null;
}

export const readFileTool = {
  name: "read_file",
  description: "Baca isi sebuah file dari project.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  execute: ({ path: p }) => {
    const safetyError = pathSafetyError(p);
    if (safetyError) return safetyError;
    if (!fs.existsSync(p)) return `Error: File "${p}" tidak ditemukan.`;
    
    // Bug 35: OOM Risk in read_file
    const stat = fs.statSync(p);
    if (stat.size > 2 * 1024 * 1024) return `Error: File terlalu besar (${stat.size} bytes). Maksimal 2MB.`;
    
    if (stat.isDirectory()) return `Error: "${p}" adalah sebuah folder, bukan file. Gunakan list_dir untuk melihat isinya.`;
    return fs.readFileSync(p, "utf-8");
  },
};

export const writeFileTool = {
  name: "write_file",
  description: "Tulis/overwrite sebuah file dengan konten baru. Bikin folder kalau belum ada.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  execute: ({ path: p, content }) => {
    const safetyError = pathSafetyError(p);
    if (safetyError) return safetyError;
    
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      return `Error: "${p}" adalah nama folder yang sudah ada, tidak bisa ditimpa dengan file.`;
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return `File "${p}" tersimpan (${content.length} karakter).`;
  },
};

export const editFileTool = {
  name: "edit_file",
  description: "Ganti satu potongan teks unik di dalam file (find & replace persis, bukan overwrite seluruh file).",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_text: { type: "string" },
      new_text: { type: "string" },
    },
    required: ["path", "old_text", "new_text"],
  },
  execute: ({ path: p, old_text, new_text }) => {
    const safetyError = pathSafetyError(p);
    if (safetyError) return safetyError;
    if (!old_text) return "Error: old_text cannot be empty.";
    if (!fs.existsSync(p)) return `Error: file "${p}" tidak ditemukan.`;
    
    // Bug 31: OOM Risk di edit_file
    const stat = fs.statSync(p);
    if (stat.size > 2 * 1024 * 1024) return `Error: File terlalu besar (${stat.size} bytes). Maksimal 2MB.`;
    
    if (fs.statSync(p).isDirectory()) return `Error: "${p}" adalah folder, tidak bisa diedit.`;
    try {
      const original = fs.readFileSync(p, "utf-8");
      const occurrences = original.split(old_text).length - 1;
      if (occurrences === 0) return `Error: teks lama tidak ditemukan di "${p}".`;
      if (occurrences > 1) {
        // Bug 30: Edit File Tanpa Konteks
        const lines = original.split("\n");
        const matches = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(old_text)) matches.push(`Baris ${i+1}: ${lines[i].trim()}`);
        }
        return `Error: teks lama muncul ${occurrences}x, harus unik. Ditemukan di:\n${matches.slice(0, 3).join("\n")}\n...`;
      }
      // Use split/join to replace all occurrences if needed, though we enforced unique
      fs.writeFileSync(p, original.split(old_text).join(new_text));
      return `File "${p}" berhasil diedit.`;
    } catch (e) {
      return `Error saat edit file: ${e.message}`; // Feature 3 & Bug 8: Graceful Tool Errors
    }
  },
};

export const listDirTool = {
  name: "list_dir",
  description: "Lihat daftar file & folder di suatu direktori.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string", description: "Default: direktori saat ini" } },
    required: [],
  },
  execute: ({ path: p = "." }) => {
    if (!fs.existsSync(p)) return `Error: direktori "${p}" tidak ditemukan.`;
    if (!fs.statSync(p).isDirectory()) return `Error: "${p}" adalah file, bukan folder. Gunakan read_file untuk membacanya.`;
    const ignoreList = [".git", "node_modules", ".meta", "Library", "Temp", "Logs", "obj"];
    
    // Feature 4: Smart Directory Listing (Folders first, then files)
    const entries = fs.readdirSync(p, { withFileTypes: true })
      .filter(e => !ignoreList.some(ign => e.name.endsWith(ign)))
      // Bug 36: Dotfile Hiding Flaw (except .gitignore and .nythros)
      .filter(e => !e.name.startsWith(".") || e.name === ".gitignore" || e.name === ".nythros");
      
    // Bug 33: Case Sensitivity Sort
    const folders = entries.filter(e => e.isDirectory()).sort((a,b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'})).map(e => `${e.name}/`);
    const files = entries.filter(e => !e.isDirectory()).sort((a,b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'})).map(e => e.name);
    
    let result = [...folders, ...files];
    if (result.length > 100) {
      // Bug 32: Blind Spot Truncation
      const first50 = result.slice(0, 50);
      const last50 = result.slice(-50);
      return [...first50, `... [${result.length - 100} hidden items] ...`, ...last50].join("\n");
    }
    return result.join("\n");
  },
};

export const runCommandTool = {
  name: "run_command",
  description: "Menjalankan perintah shell/terminal (misal: npm test, git grep, ls). Hati-hati dengan command destruktif.",
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Perintah shell untuk dijalankan" },
    },
    required: ["command"],
  },
  execute: async ({ command }) => {
    if (commandTouchesProtectedPath(command, PROTECTED_PATHS)) {
      return "Error: Security block. Command touches protected path.";
    }
    if (!command || typeof command !== 'string') return "Error: Command must be a non-empty string.";
    
    const config = loadConfig();
    let sandboxMode = config?.safety?.sandbox_mode || "auto";
    const { execSync, exec } = await import("node:child_process");

    if (sandboxMode === "auto") {
      try {
        execSync("docker info", { stdio: "ignore" });
        sandboxMode = "docker";
      } catch (e) {
        sandboxMode = "host";
      }
    }

    if (sandboxMode === "host") {
      if (looksDangerous(command)) {
        if (getConfirmMode() === "ask") {
          const confirmed = await askConfirmation(`Command "${command}" looks dangerous and will run directly on host. Execute?`);
          if (!confirmed) return "Command execution cancelled by user.";
        } else {
          return "Error: Security block. Dangerous command detected and confirm mode is not 'ask'.";
        }
      } else if (getConfirmMode() === "ask" && config?.safety?.sandbox_mode === "auto") {
        // Warn explicitly if auto mode fell back to host-exec
        const confirmed = await askConfirmation(`⚠️ Sandbox warning: Docker not found. Command will run directly on host: "${command}". Execute?`);
        if (!confirmed) return "Command execution cancelled by user.";
      }
    }
    
    if (sandboxMode === "docker") {
      let network = false;
      const userNetworkMode = config?.safety?.docker_network || "auto";
      
      if (userNetworkMode === "auto") {
        if (needsNetwork(command)) {
          if (getConfirmMode() === "ask") {
            network = await askConfirmation(`Command "${command}" kelihatannya butuh akses internet. Izinkan container ini akses network untuk kali ini?`);
          }
        }
      } else {
        network = (userNetworkMode === true || userNetworkMode === "true");
      }
      
      const image = config?.safety?.docker_image || "node:20-bookworm-slim";
      
      try {
        const out = await runInDocker(command, { projectRoot: process.cwd(), image, network, timeoutMs: 60000 });
        let safeOut = out || "Command executed successfully with no output.";
        if (safeOut.length > 8000) {
          safeOut = safeOut.slice(0, 8000) + "\n...[OUTPUT TRUNCATED]...";
        }
        return safeOut;
      } catch (err) {
        return `[ERROR]\n${err.message}`;
      }
    }

    return new Promise((resolve) => {
      // Bug 29: Buffer Overflow
      const child = exec(command, { maxBuffer: 1024 * 1024 * 2, timeout: 60000 }, (error, stdout, stderr) => {
        let out = "";
        if (stdout) out += `[STDOUT]\n${stdout}\n`;
        if (stderr) out += `[STDERR]\n${stderr}\n`;
        if (error) {
          if (error.killed && error.signal === 'SIGTERM') {
            out += `[ERROR]\nCommand timed out after 60 seconds.\n`;
          } else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            out += `[ERROR]\nOutput exceeded 2MB buffer limit. Use paging or output to file.\n`;
          } else {
            out += `[ERROR]\nExit code: ${error.code || 'unknown'}\nMessage: ${error.message}\n`;
          }
        }
        if (!out) out = "Command executed successfully with no output.";
        
        // Truncate to save tokens if output is huge
        if (out.length > 8000) {
          out = out.slice(0, 8000) + "\n...[OUTPUT TRUNCATED]...";
        }
        resolve(out);
      });
    });
  },
};

import { readRecentArchive, searchArchive } from "../memory/archive.js";

export const queryArchiveTool = {
  name: "query_archive",
  description: "Cari atau baca ringkasan percakapan sebelumnya yang sudah diarsipkan. Gunakan ini kalau butuh konteks dari sesi atau percakapan yang sudah lama (tidak ada di working memory saat ini). Input: keyword untuk search, atau kosong untuk baca 5 ringkasan terbaru.",
  input_schema: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "Kata kunci untuk dicari di archive. Kosongkan untuk baca ringkasan terbaru."
      }
    },
    required: []
  },
  execute: async ({ keyword = "" }) => {
    if (keyword.trim()) {
      const results = searchArchive(keyword);
      if (results.length === 0) return `Tidak ada arsip yang mengandung keyword "${keyword}".`;
      return results.map(e =>
        `[${new Date(e.timestamp).toLocaleDateString("id-ID")}]\n${e.summary}\nKey points: ${(e.key_points || []).join(", ") || "-"}`
      ).join("\n\n---\n\n");
    } else {
      const results = readRecentArchive(5);
      if (results.length === 0) return "Belum ada arsip percakapan untuk project ini.";
      return results.map(e =>
        `[${new Date(e.timestamp).toLocaleDateString("id-ID")}] (${e.message_count} pesan)\n${e.summary}`
      ).join("\n\n---\n\n");
    }
  }
};

export const builtinTools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  runCommandTool,
  updateTodoTool,
  queryArchiveTool
];
