import readline from "node:readline";
import os from "node:os";
import path from "node:path";

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/i, /\brm\b/i, /\bdel\b/i, /\bformat\b/i, /\bsudo\b/i,
  /\bshutdown\b/i, /\breg\s+delete\b/i, /\bdiskpart\b/i, /\bmkfs\b/i,
  />\s*\/dev\//i,
];
export function looksDangerous(command) {
  return DANGEROUS_PATTERNS.some((re) => re.test(command));
}

const NETWORK_PATTERNS = [
  /\bnpm\s+install\b/i, /\byarn\s+install\b/i, /\bpnpm\s+install\b/i,
  /\bpip\s+install\b/i, /\bcurl\b/i, /\bwget\b/i, /\bgit\s+clone\b/i,
  /\bgit\s+fetch\b/i, /\bgit\s+pull\b/i, /\bgit\s+push\b/i, /\bapt\s+get\b/i,
  /\bapt-get\b/i, /\bapk\s+add\b/i
];
export function needsNetwork(command) {
  return NETWORK_PATTERNS.some((re) => re.test(command));
}

function expandHome(p) {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}
export function isProtectedPath(targetPath, protectedPaths = []) {
  if (!targetPath) return false;
  const resolved = path.resolve(expandHome(String(targetPath)));
  return protectedPaths.some((p) => {
    const r = path.resolve(expandHome(p));
    return resolved === r || resolved.startsWith(r + path.sep);
  });
}
export function commandTouchesProtectedPath(command, protectedPaths = []) {
  return protectedPaths.some((p) => command.includes(p.replace(/^~/, "")) || command.includes(p));
}
export async function askConfirmation(message) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      const n = answer.trim().toLowerCase();
      resolve(n === "y" || n === "yes");
    });
  });
}
let confirmMode = "block";
export function setConfirmMode(mode) { confirmMode = mode; }
export function getConfirmMode() { return confirmMode; }
