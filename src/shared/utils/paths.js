import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// ~/.nythros — tempat config, skill yang ke-install, dan registry global.
// Ini SATU-SATUNYA "database" yang Nythros punya: folder biasa di laptop user.
// Nggak ada server yang harus kita hosting.
export const HOME_DIR = path.join(os.homedir(), ".nythros");

function findProjectRoot(currentPath) {
  const root = path.parse(currentPath).root;
  let curr = currentPath;
  while (curr !== root) {
    try {
      if (fs.existsSync(path.join(curr, ".nythros")) || fs.existsSync(path.join(curr, ".git"))) {
        return curr;
      }
      curr = path.dirname(curr);
    } catch (e) {
      break; // Bug 20: Stop on EPERM crash
    }
  }
  // Bug 19: Return HOME_DIR instead of cwd to prevent littering arbitrary folders
  return HOME_DIR; 
}

export const PROJECT_DIR = path.join(findProjectRoot(process.cwd()), ".nythros");

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function ensureHomeDirs() {
  ensureDir(HOME_DIR);
  // Core structure based on Master Architecture
  ensureDir(path.join(HOME_DIR, "memory", "sessions"));
  ensureDir(path.join(HOME_DIR, "memory", "summaries"));
  ensureDir(path.join(HOME_DIR, "knowledge", "docs"));
  ensureDir(path.join(HOME_DIR, "personas"));
  ensureDir(path.join(HOME_DIR, "tools", "plugins"));
  ensureDir(path.join(HOME_DIR, "tools", "learned"));
  ensureDir(path.join(HOME_DIR, "cache", "screenshots"));
  ensureDir(path.join(HOME_DIR, "cache", "responses"));
  ensureDir(path.join(HOME_DIR, "logs"));
  ensureDir(path.join(HOME_DIR, "evolution", "behavior_patches"));
  ensureDir(path.join(HOME_DIR, "evolution", "pattern_reports"));
  return HOME_DIR;
}

export function ensureProjectDirs() {
  ensureDir(PROJECT_DIR);
  return PROJECT_DIR;
}
