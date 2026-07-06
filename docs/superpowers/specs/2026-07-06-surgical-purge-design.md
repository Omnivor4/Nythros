# Nythros Surgical Purge & Optimization

## Context
Nythros CLI saat ini terasa lambat (lemot) saat merespons dan memiliki waktu boot yang cukup lama. Analisis codebase menunjukkan bahwa keterlambatan ini tidak berasal dari Ink TUI, melainkan dari "Enterprise Bloat" di backend (Phase 2 refactor yang belum selesai/hollow), seperti `Kernel`, `ServiceContainer`, `ContextPipeline`, dan dependency SQLite (`@libsql/client`) yang melanggar prinsip flat-file storage di `CLAUDE.md`.

## Goal
Menjadikan Nythros lebih efisien dan memiliki performa "superpower" dengan menghapus lapisan abstraksi yang tidak perlu, tanpa menyentuh core TUI (React + Ink) yang menjadi signature project ini.

## Architecture & Changes

### 1. The Surgical Purge (Menghapus Enterprise Bloat)
Lapisan-lapisan berikut hanya menjadi beban cold-start dan mempersulit flow data. Kita akan menghapus:
- **`src/application/`**: `Kernel.js`, `ServiceContainer.js`, `ContextPipeline.js`, `EventBus.js`
- **`src/execution/`**: `Planner.js`, `ExecutionEngine.js`, `ToolExecutor.js`
- **`src/domain/`**: Entity kosong yang tidak terpakai
- **`src/infrastructure/StateManager.js`**: Menghapus implementasi SQLite yang melanggar filosofi storage JSON/Markdown.

### 2. Simplifikasi Execution Engine (`Agent.js`)
Flow eksekusi akan disederhanakan kembali ke pola yang terbukti berjalan (Phase 1):
- `src/presentation/repl.js` langsung menginstansiasi `Agent.js`.
- `Agent.js` mengambil konfigurasi (provider, model, API key) dari `src/shared/config.js` (flat JSON).
- `Agent.js` akan memanggil provider via `src/providers/openaiCompatible.js` secara langsung.
- Tool execution akan dilakukan secara sekuensial di dalam loop `Agent.process()`, memanggil fungsi dari `ToolRegistry` atau daftar tools dari `src/tooling/tools.js`.
- Semua progress/event akan di-stream balik ke REPL menggunakan callback `onProgress` yang sudah ada (tidak lewat EventBus yang rumit).

### 3. State & Storage (Kembali ke Flat Files)
- Menghapus dependency `@libsql/client`.
- Todos, memori, error watchlist (`errorWatchdog.js`), dan archive akan kembali menggunakan JSON murni seperti yang tertulis di `CLAUDE.md`. (Sebagian sudah JSON, tapi `StateManager` mencoba memigrasikannya ke DB—ini dihentikan).

### 4. TUI Preservation (UI Tetap Sama)
- `src/presentation/ui/App.js` dan kawan-kawan (React + Ink) tidak akan dibongkar.
- Interaksi dari UI -> Core tetap menggunakan `runAgentWrapper`, hanya saja di belakang layar `Agent.process` sekarang jauh lebih ringan, langsung menyentuh `openaiCompatible.js` tanpa melewati 5 layer abstraksi.
- UI tidak akan di-block oleh cold-start object factory.

## Trade-offs
- **Pros**: Boot lebih cepat (mengurangi parsing dan instansiasi puluhan kelas), memori lebih kecil, dependency list menyusut, flow debug yang transparan.
- **Cons**: Mengembalikan struktur ke bentuk yang kurang "enterprise", tapi jauh lebih sesuai dengan filosofi "Solo Dev Game-Dev CLI" dari Farrel.

## Next Step
Implementasi akan menghapus file yang disebutkan dan melakukan wiring ulang di `bootstrap.js` (jika masih diperlukan) dan `repl.js` ke `Agent.js`.