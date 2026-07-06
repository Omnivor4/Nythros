# Nythros — Project Brief & Instruksi buat AI Agent

Dokumen ini ditulis buat dibaca AI (Codex, atau agent lain), bukan
cuma manusia. Tujuannya: AI yang lanjutin project ini nggak perlu ditanya
ulang "ini project apa, gimana arsitekturnya, apa yang udah jalan" — semua
udah ada di sini. Ini juga contoh hidup dari filosofi Nythros sendiri:
jangan bikin orang (atau AI) ngulang jelasin konteks dari nol.

Kalau kamu AI yang baru baca ini: baca seluruh dokumen ini DULU, baca
`README.md` dan isi `src/` yang udah ada, baru mulai nulis kode. Jangan
nebak struktur — semua kontrak arsitektur ada di bawah dan harus dipatuhi.

---

## 1. Apa ini dan kenapa dia ada

Nythros adalah AI coding agent CLI, dibuat oleh Farrel (pelajar SMK
PPLG, fokus software engineering & game development, project utamanya
"Wirabaya: The Legend of Surabaya"). Nythros lahir dari keresahan nyata
pas pakai tool sejenis (Codex, OpenCode, Hermes Agent): API kadang
error (529/500/timeout) di tengah kerjaan, dan itu bikin kamu harus
ngulang jelasin todo/context dari awal — buang waktu dan token.

Nythros BUKAN coba nyamain breadth OpenCode (160k+ star, 900 contributor)
atau Hermes Agent (dibangun lab riset AI, 20+ platform, 40+ tool). Itu
nggak realistis buat solo/tim kecil dan bukan tujuannya. Nythros sengaja
SEMPIT: dua headline feature yang jadi alasan dia exist, plus niche
spesifik ke workflow game-dev pelajar Indonesia.

## 2. Filosofi inti (jangan dilanggar)

- **BYOK murni** — Nythros nggak nge-host AI model atau server backend
  apa pun yang harus dibayar/maintain developer (Farrel). Semua AI call
  keluar ke provider yang user pilih sendiri (Anthropic, atau gateway
  OpenAI-compatible: OpenRouter, 9router, Ollama lokal, dst).
- **Storage lokal doang** — nggak ada database hosted. Semua state
  (config, memory, skill, error log) adalah file biasa: JSON atau
  Markdown, di `~/.nythros/` (global) atau `<project>/.nythros/`
  (per-project). Kalau ada ide nambah fitur yang butuh server pusat /
  database hosted / akun cloud — STOP, itu melanggar prinsip inti, tolak
  atau diskusikan ulang dulu sebelum dibangun.
- **Ringan & sengaja terbatas** — setiap fitur baru harus lolos
  pertanyaan: "apa ini benar-benar dipakai buat workflow Farrel (coding
  sekolah + game dev), atau cuma niru fitur tool lain biar kelihatan
  lengkap?" Kalau jawabannya yang kedua, jangan dibangun (lihat §5).

## 3. Dua headline differentiator (inti produk, bukan fitur tambahan)

1. **Error-resilient by default** — circuit breaker yang stop auto-retry
   setelah gagal beruntun (default: 3x dalam 2 menit), biar nggak buang
   token retry buta. State percakapan & error tersimpan lokal, jadi pas
   user lanjut nanti nggak perlu jelasin ulang dari nol. Status: SUDAH
   ADA di `src/state/errorWatchdog.js` + terintegrasi di
   `src/agent/loop.js`, sudah ketest manggil API Anthropic asli sampai
   circuit breaker beneran nyala.
2. **Skill installable dari GitHub** — `nythros skill add <repo-url>`
   clone repo yang punya `SKILL.md`, parse frontmatter (name +
   description), daftar ke registry. Deskripsi singkat nempel terus di
   system prompt; isi lengkap baru dimuat lewat tool `load_skill` kalau
   model beneran milih pakai — biar nambah banyak skill nggak otomatis
   bikin context boros. Status: SUDAH ADA di `src/skills/`, sudah ketest
   end-to-end (clone, parse, register, remove).

Fitur apa pun yang ditambahin ke Nythros idealnya nyambung ke salah satu
dari dua hal ini, atau ke niche game-dev (§4). Kalau nggak nyambung ke
keduanya, pertimbangkan ulang.

## 4. Status saat ini — Fase 2 (v0.3.0 — GOD MODE UPDATE)

Struktur project:

```
bin/nythros.js              entry point CLI (shebang, import src/cli.js)
src/cli.js                  semua command: chat, config, skill, memory + interactive setup
src/config.js               load/save ~/.nythros/config.json (auto-strips deprecated keys)
src/repl.js                 interactive chat REPL (multi-turn conversation)
src/providers/
  openaiCompatible.js        fetch ke {baseURL}/chat/completions (format OpenAI, stream:false)
  index.js                   factory createProvider(config) — langsung return OpenAICompatible
src/agent/
  loop.js                    agent loop inti: tool-use loop + circuit breaker + context token optimizer
  tools.js                   tool dasar: read_file, write_file, edit_file, list_dir (Unity filtered), run_command (Terminal/Shell execution)
  systemPrompt.js            builder system prompt (gabung memory + skill list + language)
src/memory/memory.js        baca/tulis MEMORY.md per project, tool "remember"
src/skills/
  installer.js               clone, parse SKILL.md, registry.json
  loader.js                  ringkasan buat prompt + tool load_skill on-demand
src/state/errorWatchdog.js  circuit breaker (failures window, isCircuitOpen)
src/state/todoCapsule.js    todo capsule (real-time todo state)
src/obsidian/vault.js       integrasi Obsidian vault (search, read, write, appendChatLog)
src/utils/paths.js          HOME_DIR (~/.nythros) & PROJECT_DIR (.nythros)
src/utils/ui.js             Spinner, highlightMarkdown, COLORS
src/utils/banner.js         animated CLI banner with Nox mascot (cyber-fox)
src/utils/i18n.js           internationalization (en/id)
PROMPT.md                   system prompt template with placeholders
```

PENTING: `anthropic.js` SUDAH DIHAPUS. Nythros kini 100% Pure BYOK —
hanya menggunakan satu provider universal (OpenAI-compatible format).

Yang SUDAH ketest pada QA session (9Router + MANHATTAN):
- Endpoint verify, API send, full agent loop end-to-end
- Built-in tools awal, memory, circuit breaker, config, i18n, invalid URL rejection, Token context limit
- Obsidian vault integration
- **Interactive REPL / chat mode** (sudah aktif dengan TUI di `src/repl.js` & `src/ui/`)
- **Todo capsule + auto-resume context** (`src/state/todoCapsule.js` sudah disuntikkan ke system prompt)
- **Unity-aware file filter** (`list_dir` otomatis skip `.meta`, `Library`, dll)
- **Tool khusus game-dev** (`read_gdd` & `read_balance` aktif di `src/agent/gamedevTools.js`)
- **Tool generate dokumen** (`generate_docx`, `generate_xlsx`, `generate_pdf` aktif di `src/agent/docTools.js`)
Lihat detail: Obsidian `Nythros/QA_Training_Report.md` & `Changelog_v0.3.0.md`

## 5. Batasan keras — JANGAN dibangun (kecuali Farrel minta eksplisit)

Ini bukan "belum waktunya", ini "secara sengaja di luar scope":
- LSP integration (diagnostics dari language server)
- Subagent paralel / multi-agent orchestration
- Plugin marketplace / ekstensi pihak ketiga
- Ekstensi IDE (VS Code, JetBrains)
- Multi-platform messaging gateway (Telegram/Discord/Slack/dst — ini fitur
  besar Hermes Agent, nggak relevan buat use case Farrel)
- Sesi cloud/remote, akun terpusat, telemetry apa pun
- Vector DB / semantic memory — memory Nythros sengaja cuma flat
  Markdown file, jangan diupgrade ke sistem yang butuh embedding/infra
  tambahan tanpa diskusi ulang

Kalau ada permintaan yang kelihatannya minta salah satu dari ini, tanya
balik dulu apa benar dibutuhin buat use case nyata, jangan langsung
dibangun karena "tool lain juga punya".

## 6. Roadmap Fase 2 — yang BOLEH dan SEHARUSNYA dibangun selanjutnya

Urutan disaranin sesuai dependency, tapi bisa disesuaikan kalau Farrel
minta urutan beda:

1. **Web editor buat GDD**
   [STATUS: BELUM] — Ini butuh refactor lebih dulu: pisahin agent
   loop + tools jadi HTTP API server (Express/Fastify), CLI jadi salah
   satu client dari server itu (bukan logic nempel langsung di
   `cli.js`). Baru habis itu bangun frontend React+Vite (Farrel udah
   biasa dari project Fapp) sebagai client kedua. Jangan bangun web
   editor sebelum refactor ini, atau bakal ada logic kependekan
   ke-duplikasi antara CLI dan web.

2. **MCP client integration**
   [STATUS: SELESAI] — `/mcp connect`, `/mcp list`, `/mcp disconnect` sudah aktif
   di `src/repl.js`. Auto-connect dari config saat boot. Tools dari MCP server
   otomatis dikonversi ke format Nythros dan disuntikkan ke agent loop.

3. **Evolution / self-improvement**
   [STATUS: SELESAI] — `src/evolution/analyzer.js` kini memanggil LLM asli (1 call
   per cycle) untuk menganalisis 20 observasi terakhir dari `observations.jsonl`.
   Menghasilkan `PatternReport` terstruktur (frequent_tools, failure_patterns,
   user_patterns, suggestions). Graceful failure jika LLM call gagal.

## 7. Konvensi kode & bahasa (WAJIB diikuti biar konsisten)

- Semua comment kode, error message, dan output CLI yang user-facing
  ditulis dalam Bahasa Indonesia casual — samain gaya sama yang udah ada
  di `src/` (lihat contoh: "Belum ada API key...", "Skill ... terinstall").
  Nama variabel/fungsi tetap pakai English (standar JS).
- Plain modern JS (ESM, `"type": "module"`), Node >=18. JANGAN pindah ke
  TypeScript atau nambah build step tanpa diskusi — salah satu alasan
  Fase 1 cepet selesai justru karena nggak ada compile step.
  
- Dependency baru harus seminimal mungkin. Sebelum `npm install` library
  baru, cek dulu apa bisa pakai built-in Node (`fetch`, `fs`, `path`,
  `child_process`) — itu pattern yang udah dipakai sejak awal (provider
  pakai fetch langsung, bukan SDK).
- Setiap fitur baru, sebelum dianggap selesai, HARUS di-smoke-test
  beneran (jalanin command-nya, bukan cuma baca kode dan asumsi jalan).
  Ini standar yang dipakai sejak Fase 1 — circuit breaker dites sampai
  beneran manggil API asli dan beneran ke-block di percobaan ke-4.

## 8. Cara kerja yang diharapkan dari AI yang baca dokumen ini

- Baca dokumen ini + `README.md` + scan `src/` SEBELUM nulis kode baru.
- Kalau ada permintaan fitur yang ambigu, pilih interpretasi paling
  masuk akal berdasarkan §2–§6 di atas, sebut asumsinya secara singkat,
  lanjut kerjain — jangan nunggu konfirmasi buat hal yang udah jelas
  dari brief ini.
- Kalau permintaan kelihatannya melanggar §5 (batasan keras), tanya balik
  dulu, jangan langsung tolak juga jangan langsung nurut buta.
- Update bagian "Status saat ini" (§4) di dokumen ini begitu fitur baru
  selesai dibangun & ketest — biar dokumen ini tetap jadi sumber
  kebenaran yang akurat buat sesi AI berikutnya, bukan cuma rencana awal
  yang ketinggalan jaman.
