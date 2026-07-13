# Design Spec: Nythros Smarter, Stronger, and Faster (v0.4.0)
Date: 2026-07-07

## 1. Overview
Tujuan: Meningkatkan kecerdasan (proaktif & berpikir), kekuatan (otomasi OS/GUI), dan performa (speed & konteks) Nythros agar setara dengan state-of-the-art agent (seperti Claude Code) namun tetap ringan.

## 2. Brain: Smarter Agent Loop
Tujuan: Menghilangkan jawaban asal dan meningkatkan logika penalaran.

### 2.1 Thinking Process
- **Requirement**: Agent wajib melakukan penalaran internal sebelum memberikan jawaban atau menggunakan tool.
- **Implementation**:
    - Update `src/agent/systemPrompt.js` untuk mewajibkan penggunaan tag `<thought>`.
    - Update `src/agent/loop.js` untuk mendeteksi dan mengekstrak isi `<thought>`.
    - **UI Integration**: Isi `<thought>` di-stream secara real-time ke UI sebagai "Thinking Trace" sehingga user tahu proses berpikir agent.
- **Clarification Gate**:
    - Agent dilarang menebak prompt yang ambigu.
    - Jika confidence score rendah atau prompt tidak lengkap, agent wajib memberikan pertanyaan klarifikasi sebelum eksekusi.

## 3. Arms: Stronger OS Automation
Tujuan: Akses laptop total melalui arsitektur MCP agar core tetap ringan.

### 3.1 MCP-Driven Control
- **Strategy**: Menggunakan MCP server external untuk akses OS/GUI.
- **Capabilities**:
    - Window Management: List apps, focus window, close/open app.
    - Input Control: Mouse movement, click, keyboard typing.
    - System Info: Deep monitoring (CPU, RAM, Process).
- **Permission Model**: Setiap aksi yang memodifikasi system state (klik, ketik, tutup app) wajib melalui konfirmasi user.

### 3.2 Auto-MCP Onboarding
- **Presets**: Implementasi `src/infrastructure/mcp/presets.js` berisi daftar server essential:
    - `sequential-thinking`: Untuk pemecahan masalah kompleks.
    - `os-control`: Untuk otomasi laptop.
- **Auto-Install**: Nythros akan mengecek ketersediaan preset saat boot dan menawarkan instalasi otomatis jika belum terpasang.

## 4. Performance: Faster Response
Tujuan: Mengurangi latency dan mencegah "context bloat".

### 4.1 Context Optimization
- **Sliding Window**: Hanya mengirimkan N pesan terakhir yang paling relevan.
- **Context Pruning**: Implementasi logic untuk membuang data tool output yang terlalu besar atau tidak relevan sebelum dikirim kembali ke LLM.
- **Summary Injection**: Menggunakan rangkuman status dari `todoCapsule.js` dan `memory.js` sebagai pengganti full history.

### 4.2 Execution Speed
- **Parallel Tooling**: Mengubah eksekusi tool dari sequential menjadi parallel menggunakan `Promise.all` jika agent memanggil beberapa tool dalam satu turn.
- **Streaming Response**: Optimasi streaming output agar user menerima informasi segera setelah token pertama dihasilkan.

## 5. Success Criteria
- [ ] Agent bertanya kembali saat diberikan prompt ambigu.
- [ ] Muncul trace `<thought>` di terminal/UI sebelum jawaban akhir.
- [ ] Bisa mengontrol aplikasi laptop via MCP (contoh: buka browser).
- [ ] Server `sequential-thinking` terinstall otomatis.
- [ ] Respon terasa lebih cepat saat history percakapan sudah panjang.
