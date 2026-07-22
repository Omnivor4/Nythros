// src/gdd-editor/server.js
// GDD Web Editor — HTTP API server + static file serving
// Jalanin: nythros gdd
// atau: node src/gdd-editor/server.js

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig } from '../shared/config.js';
import { PROJECT_DIR } from '../shared/utils/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ── Parse GDD markdown into sections ─────────────────────────
function parseGDD(content) {
  const lines = content.split('\n');
  const sections = [];
  let currentSection = null;

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        level: headerMatch[1].length,
        title: headerMatch[2].trim(),
        header: line,
        content: [],
      };
    } else if (currentSection) {
      currentSection.content.push(line);
    }
  }
  if (currentSection) sections.push(currentSection);

  return sections;
}

// ── Rebuild GDD from sections ────────────────────────────────
function rebuildGDD(sections, targetHeader, newContent) {
  return (
    sections
      .map((s) => {
        if (s.header === targetHeader) {
          return s.header + '\n' + newContent.replace(/\n+$/, '');
        }
        return s.header + '\n' + s.content.join('\n').replace(/\n+$/, '');
      })
      .join('\n\n') + '\n'
  );
}

// ── Get GDD folder path ──────────────────────────────────────
function getGDDFolder(config) {
  return config?.gdd?.folder || path.join(PROJECT_DIR, '..', 'gdd');
}

// ── List .md files in GDD folder ─────────────────────────────
function listGDDFiles(folder) {
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({
      name: f,
      path: path.join(folder, f),
      size: fs.statSync(path.join(folder, f)).size,
      modified: fs.statSync(path.join(folder, f)).mtime,
    }));
}

// ── Create HTTP server ───────────────────────────────────────
export function startGDDServer(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const method = req.method;
      const pathname = url.pathname;

      // Helper: send JSON response
      const sendJSON = (data, status = 200) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(data));
      };

      // Helper: send error
      const sendError = (msg, status = 400) => {
        sendJSON({ error: msg }, status);
      };

      // Helper: read request body
      const readBody = () =>
        new Promise((resolve) => {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(null);
            }
          });
        });

      try {
        const config = loadConfig();

        // ── API Routes ──────────────────────────────────────────

        // GET /api/config — get GDD folder config
        if (method === 'GET' && pathname === '/api/config') {
          const folder = getGDDFolder(config);
          return sendJSON({
            folder,
            exists: fs.existsSync(folder),
            configured: !!config?.gdd?.folder,
          });
        }

        // PUT /api/config — set GDD folder config
        if (method === 'PUT' && pathname === '/api/config') {
          const body = await readBody();
          if (!body?.folder) return sendError('folder is required');
          const resolved = path.resolve(body.folder);
          config.gdd = config.gdd || {};
          config.gdd.folder = resolved;
          saveConfig(config);
          return sendJSON({ folder: resolved });
        }

        // GET /api/gdd/files — list GDD files
        if (method === 'GET' && pathname === '/api/gdd/files') {
          const folder = getGDDFolder(config);
          if (!fs.existsSync(folder)) {
            return sendJSON({ files: [], folder, exists: false });
          }
          return sendJSON({
            files: listGDDFiles(folder),
            folder,
            exists: true,
          });
        }

        // GET /api/gdd/:filename — get parsed GDD
        const fileMatch = pathname.match(/^\/api\/gdd\/(.+)$/);
        if (method === 'GET' && fileMatch) {
          const filename = path.basename(decodeURIComponent(fileMatch[1]));
          const folder = getGDDFolder(config);
          const filepath = path.join(folder, filename);

          if (!fs.existsSync(filepath)) {
            return sendError(`File ${filename} tidak ditemukan`, 404);
          }

          const content = fs.readFileSync(filepath, 'utf-8');
          const sections = parseGDD(content);
          return sendJSON({
            filename,
            content,
            sections,
            lineCount: content.split('\n').length,
            size: fs.statSync(filepath).size,
          });
        }

        // PUT /api/gdd/:filename — update section
        if (method === 'PUT' && fileMatch) {
          const filename = path.basename(decodeURIComponent(fileMatch[1]));
          const body = await readBody();
          if (!body?.section || body?.content === undefined) {
            return sendError('section and content are required');
          }

          const folder = getGDDFolder(config);
          const filepath = path.join(folder, filename);

          // Path traversal protection
          const resolved = path.resolve(filepath);
          if (!resolved.startsWith(path.resolve(folder))) {
            return sendError('Invalid path', 403);
          }

          if (!fs.existsSync(filepath)) {
            return sendError(`File ${filename} tidak ditemukan`, 404);
          }

          const content = fs.readFileSync(filepath, 'utf-8');
          const sections = parseGDD(content);

          const targetSection = sections.find((s) => s.header === body.section);
          if (!targetSection) {
            return sendError(`Section "${body.section}" tidak ditemukan`, 404);
          }

          const newContent = rebuildGDD(sections, body.section, body.content);
          fs.writeFileSync(filepath, newContent, 'utf-8');

          return sendJSON({
            success: true,
            filename,
            section: body.section,
            size: fs.statSync(filepath).size,
          });
        }

        // ── Static file serving ──────────────────────────────
        let filePath =
          pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);

        if (!fs.existsSync(filePath)) {
          // Fallback to index.html for SPA
          filePath = path.join(PUBLIC_DIR, 'index.html');
        }

        const ext = path.extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const content = fs.readFileSync(filePath);

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } catch (err) {
        sendJSON({ error: err.message }, 500);
      }
    });

    server.listen(port, () => {
      const addr = server.address();
      resolve({ server, port: addr.port, url: `http://localhost:${addr.port}` });
    });
  });
}

// ── Direct run: standalone server ────────────────────────────
const isMain = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const DEFAULT_PORT = 3456;
  const { url } = await startGDDServer(DEFAULT_PORT);
  console.log(`\n📄 GDD Editor running at ${url}`);
  console.log(`   Press Ctrl+C to stop\n`);
}
