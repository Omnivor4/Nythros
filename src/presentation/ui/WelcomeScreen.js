import React, { useState } from 'react';
import { Text, Box } from 'ink';
import { html } from './htm.js';
import { theme } from './theme.js';
import { CROWN_LOGO, NYTHROS_TEXT } from './logo.js';

const TIPS = [
  // Shortcuts
  { icon: '⌨', text: 'Tab — switch mode: General → Plan → Execute' },
  { icon: '⌨', text: 'Ctrl+E — cycle effort: Low → Medium → High' },
  { icon: '⌨', text: 'Ctrl+A — select all teks di input box' },
  { icon: '⌨', text: 'Paste path gambar (.png/.jpg) → auto-jadi [Image: ...]' },

  // Features
  { icon: '🛠', text: '/tools — lihat semua tool yang aktif sesi ini' },
  { icon: '🛠', text: '/skill add <repo> — install skill baru dari GitHub' },
  { icon: '🛠', text: '/memory — lihat apa yang Nythros ingat di project ini' },
  { icon: '🛠', text: '/archive — lihat ringkasan percakapan yang sudah diarsipkan' },
  { icon: '🛠', text: '/budget — cek token budget sesi ini' },
  { icon: '🛠', text: '/cost — lihat estimasi biaya API sesi ini' },
  { icon: '🛠', text: '/growth — lihat progress Nythros belajar dari pemakaianmu' },
  { icon: '🛠', text: '/endpoints — lihat status semua endpoint yang terdaftar' },

  // Workflow tips
  { icon: '💡', text: 'Mode Plan: Nythros hanya baca file — aman untuk eksplorasi' },
  { icon: '💡', text: 'Mode Execute: akses penuh — edit file, jalankan command' },
  { icon: '💡', text: 'Effort High: jawaban lebih panjang dan detail' },
  { icon: '💡', text: 'Effort Low: jawaban singkat — cocok untuk pertanyaan cepat' },
  { icon: '💡', text: 'Circuit breaker aktif otomatis kalau API error 3x beruntun' },
  { icon: '💡', text: 'Token budget mencegah tagihan meledak dari halusinasi loop' },

  // Game-dev
  { icon: '🎮', text: '"baca GDD bagian combat" — Nythros cari section, bukan dump semua' },
  { icon: '🎮', text: 'File .meta Unity diabaikan otomatis — hanya source yang diprioritaskan' },
  { icon: '🎮', text: 'Nythros bisa generate Excel balance tracker langsung dari chat' },

  // Philosophy
  { icon: '🔒', text: 'Semua data tersimpan lokal di ~/.nythros/ — tidak ada cloud, tidak ada telemetry' },
  { icon: '🔒', text: 'BYOK: bawa API key sendiri, pilih model sendiri, kendali penuh di tanganmu' },
  { icon: '🌱', text: 'Makin sering dipakai, makin Nythros paham workflow dan preferensimu' },
];

const ICON_COLORS = {
  '⌨': '#83A598',   // teal
  '🛠': '#FABD2F',   // kuning
  '💡': '#E8833A',   // orange
  '🎮': '#B8BB26',   // hijau
  '🔒': '#928374',   // abu
  '🌱': '#8EC07C',   // hijau muda
};

export const WelcomeScreen = () => {
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);

  return html`
    <${Box} flexDirection="column" alignItems="center" marginBottom=${1}>
      <${Box} flexDirection="row" alignItems="center">
        <${Box} flexDirection="column" marginRight=${1}>
          ${CROWN_LOGO.map((row, i) => html`<${Text} key=${"c" + i}>${row}<//>`)}
        <//>
        <${Box} flexDirection="column">
          ${NYTHROS_TEXT.map((row, i) => html`
            <${Text} key=${"t" + i} color=${theme.colors.khaki} bold>${row}<//>
          `)}
          <${Box} marginTop=${0} paddingLeft=${1}>
            <${Text} color=${theme.colors.tagline}>
              BYOK · Local · Extensible · Game-Dev Ready
            <//>
          <//>
        <//>
      <//>

      <${Box} marginTop=${2} marginBottom=${0} paddingLeft=${2}>
        <${Text} color=${theme.colors.dim}>Welcome to Nythros! Type your message or <//>
        <${Text} color=${theme.colors.accent}>/help<//>
        <${Text} color=${theme.colors.dim}> for commands....<//>
      <//>

      <${Box} marginTop=${1} marginBottom=${0} paddingLeft=${2}>
        <${Text} color=${ICON_COLORS[tip.icon] || theme.colors.dim}>
          ${tip.icon}${' '}
        <//>
        <${Text} color=${theme.colors.dim} dimColor>
          ${tip.text}
        <//>
      <//>
    <//>
  `;
};
