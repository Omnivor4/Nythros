import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_DIR, ensureProjectDirs } from '../../shared/utils/paths.js';

const STATE_FILE = 'error-state.json';
const MAX_CONSECUTIVE_FAILURES = 3;
const WINDOW_MS = 2 * 60 * 1000; // 2 menit

function statePath() {
  return path.join(PROJECT_DIR, STATE_FILE);
}

function readState() {
  const p = statePath();
  if (!fs.existsSync(p)) return { failures: [] };
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function writeState(state) {
  ensureProjectDirs();
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

export function recordFailure(errorMessage) {
  const state = readState();
  const now = Date.now();
  state.failures = state.failures.filter((f) => now - f.at < WINDOW_MS);
  state.failures.push({ at: now, message: errorMessage });
  writeState(state);
  return state.failures.length;
}

export function recordSuccess() {
  writeState({ failures: [] });
}

export function isCircuitOpen() {
  const state = readState();
  const now = Date.now();
  const recent = state.failures.filter((f) => now - f.at < WINDOW_MS);
  return recent.length >= MAX_CONSECUTIVE_FAILURES;
}

export function failureSummary() {
  const state = readState();
  if (state.failures.length === 0) return null;
  const last = state.failures[state.failures.length - 1];
  return `${state.failures.length}x gagal beruntun, terakhir: ${last.message}`;
}
