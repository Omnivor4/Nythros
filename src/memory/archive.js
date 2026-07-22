import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_DIR } from '../shared/utils/paths.js';

// Simpan per-project di .nythros/archive.jsonl
// Format tiap entry: { timestamp, summary, key_points[], message_count }

export function appendToArchive(summary, keyPoints = [], messageCount = 0) {
  const archivePath = path.join(PROJECT_DIR, 'archive.jsonl');
  const entry = {
    timestamp: new Date().toISOString(),
    summary,
    key_points: keyPoints,
    message_count: messageCount,
  };
  fs.appendFileSync(archivePath, JSON.stringify(entry) + '\n', 'utf-8');
}

export function readRecentArchive(maxEntries = 5) {
  const archivePath = path.join(PROJECT_DIR, 'archive.jsonl');
  if (!fs.existsSync(archivePath)) return [];

  try {
    const lines = fs.readFileSync(archivePath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .slice(-maxEntries)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function searchArchive(keyword) {
  const archivePath = path.join(PROJECT_DIR, 'archive.jsonl');
  if (!fs.existsSync(archivePath)) return [];

  try {
    const lines = fs.readFileSync(archivePath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(
        (e) =>
          e.summary?.toLowerCase().includes(keyword.toLowerCase()) ||
          e.key_points?.some((p) => p.toLowerCase().includes(keyword.toLowerCase())),
      )
      .slice(-10); // maksimal 10 hasil
  } catch {
    return [];
  }
}
