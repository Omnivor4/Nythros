# Nythros

AI coding agent CLI — BYOK (bring your own key), ringan, storage lokal doang.
Nythros nggak nge-host AI atau database apa pun. Dia cuma "tempat" — otaknya
manggil keluar ke provider AI pilihan kamu sendiri (Anthropic langsung, atau
gateway OpenAI-compatible apa pun: OpenRouter, 9router, Ollama lokal, dst).

## Kenapa Nythros beda dari OpenCode/Claude Code/Hermes

Bukan coba nyamain breadth mereka (itu kerjaan tim/lab besar). Dua hal yang
jadi fokus utama Nythros:

1. **Error-resilient by default** — kalau API gagal 3x beruntun dalam 2
   menit, circuit breaker nyala otomatis. Nythros stop nyoba lagi (nggak
   token buat retry buta), dan kasih tau kamu apa yang terjadi. State
   error & percakapan tetap tersimpan lokal, jadi pas kamu lanjut nanti
   nggak perlu jelasin ulang dari nol.
2. **Skill installable dari GitHub** — `nythros skill add <repo-url>` clone
   repo yang punya `SKILL.md`, daftarin otomatis.
3. **Docker Execution Sandbox** — Nythros dapat menjalankan `run_command` dalam
   container Docker ephemeral secara otomatis untuk isolasi ekstra.
   Nythros akan mengecek instalasi Docker daemon (`docker version`) pada
   saat booting. Jika tidak ditemukan, Nythros otomatis _fallback_
   ke mode _host-exec_ bawaan (tanpa isolasi Docker).

## Install

```bash
git clone <repo-kamu> nythros
cd nythros
npm install
npm link        # supaya command `nythros` bisa dipanggil dari mana aja
```

Temen kamu yang mau pakai juga cukup `npm install -g nythros` (setelah
di-publish ke npm) atau clone + `npm link` yang sama.

## Konfigurasi

```bash
# Pakai Anthropic langsung
nythros config set --provider anthropic --key sk-ant-xxx --model claude-sonnet-4-6

# Atau pakai gateway OpenAI-compatible (OpenRouter, 9router, Ollama, dst)
nythros config set --provider openai-compatible --key xxx --base-url https://openrouter.ai/api/v1 --model anthropic/claude-sonnet-4
```

Config tersimpan di `~/.nythros/config.json` — nggak ada server yang harus
kamu hosting.

## Pakai

```bash
cd project-kamu
nythros chat "tolong jelasin struktur folder ini"
```

Tiap project punya foldernya sendiri di `.nythros/` (memory, error state) —
jangan di-commit ke git project utama, masukin ke `.gitignore`.

## Skill

```bash
nythros skill add https://github.com/username/nama-skill
nythros skill list
nythros skill remove nama-skill
```

Skill harus punya file `SKILL.md` dengan frontmatter minimal:

```markdown
---
name: nama-skill
description: Kapan dan kenapa skill ini dipakai.
---

Isi lengkap instruksi skill di sini.
```

## Memory

Agent bisa nyimpen fakta penting sendiri lewat tool `remember`, atau kamu
lihat manual:

```bash
nythros memory
```

Isinya di `.nythros/MEMORY.md` per project — file teks biasa, bisa diedit
manual juga.

## Struktur project

```
bin/nythros.js          entry point CLI
src/cli.js               daftar semua command
src/config.js            load/save config (~/.nythros/config.json)
src/providers/           adapter Anthropic & OpenAI-compatible
src/agent/loop.js         agent loop inti (tool-use loop + circuit breaker)
src/agent/tools.js        tool dasar: read_file, write_file, edit_file, list_dir
src/memory/               baca/tulis MEMORY.md per project
src/skills/               installer + loader skill dari GitHub
src/state/errorWatchdog.js  circuit breaker
```

## Roadmap (belum dikerjain, sengaja dipisah biar Fase 1 ini selesai dulu)

- Web editor buat GDD (butuh backend di-refactor jadi HTTP API dulu, biar
  CLI dan web sama-sama jadi client dari satu backend yang sama — pattern
  yang sama kayak `opencode serve`)
- Tool generate Excel/Word/PDF (`generate_docx`, `generate_xlsx`, `generate_pdf`)
- Tool khusus game-dev: `read_gdd` (cari section relevan, bukan dump semua),
  filter file Unity (`.meta`, `Library/`), `read_balance` buat spreadsheet
  entity tracker
- Todo capsule + auto-resume context setelah error (circuit breaker-nya
  udah ada, capsule todo-nya belum)

## Catatan jujur

Ini skeleton Fase 1 — udah ketest jalan untuk: CLI commands, config,
install/list/remove skill (clone + parse SKILL.md), baca/tulis memory, dan
error handling + circuit breaker (ketest manggil API Anthropic asli sampai
circuit breaker nyala). Yang BELUM ketest end-to-end: jalur tool-use loop
penuh pakai API key valid (karena nggak ada key buat tes di sini) — bentuk
request/response-nya sesuai dokumentasi resmi Anthropic Messages API &
OpenAI chat/completions, tapi tetep cek hasil pertama kali kamu coba
beneran.
