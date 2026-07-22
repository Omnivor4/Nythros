// tests/desktop.test.js
// Unit test untuk src/tooling/desktopTools.js — screenshot, mouse, keyboard, window management
// Jalanin: node tests/desktop.test.js
//
// STRATEGI:
// - Input validation tests: NO PowerShell — jalan di platform mana pun
// - Mock-based tests: pake _setPSMock() untuk simulasi PowerShell deterministic
// - Real smoke tests: screenshot + get_screen_size (read-only, aman)
// - Semua tes aman dan deterministic

import assert from 'node:assert/strict';
import process from 'node:process';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

console.log('\n🧪 Desktop Tools Tests\n');

// ── Import ─────────────────────────────────────────────────────────────────
const desktop = await import('../src/tooling/desktopTools.js');
const isWin = process.platform === 'win32';

// ── Helpers ────────────────────────────────────────────────────────────────

function mockPS(jsonData) {
  desktop._setPSMock(() => JSON.stringify(jsonData));
}

function mockPSThrow(errorMsg) {
  desktop._setPSMock(() => {
    throw new Error(errorMsg);
  });
}

function clearMock() {
  desktop._clearPSMock();
}

// ====================================================================
// 1. Ekspor & Struktur
// ====================================================================

test('desktopTools export berisi 10 tools', () => {
  assert.equal(desktop.desktopTools.length, 10);
});

test('Semua tool punya properti name, description, input_schema, execute', () => {
  for (const tool of desktop.desktopTools) {
    assert.ok(typeof tool.name === 'string' && tool.name.length > 0);
    assert.ok(
      typeof tool.description === 'string' && tool.description.length > 0,
      `Tool ${tool.name} harus punya description`,
    );
    assert.ok(
      tool.input_schema && typeof tool.input_schema === 'object',
      `Tool ${tool.name} harus punya input_schema`,
    );
    assert.ok(typeof tool.execute === 'function', `Tool ${tool.name} harus punya execute function`);
  }
});

test('Semua nama tool sesuai standar', () => {
  const names = desktop.desktopTools.map((t) => t.name);
  const expected = [
    'screenshot',
    'mouse_move',
    'mouse_click',
    'get_cursor_pos',
    'get_screen_size',
    'type_text',
    'press_key',
    'list_windows',
    'focus_window',
    'launch_app',
  ];
  for (const name of expected) {
    assert.ok(names.includes(name), `Tool "${name}" harus ada`);
  }
});

test('isDesktopSupported() mengembalikan true di Windows, false di non-Windows', () => {
  assert.equal(typeof desktop.isDesktopSupported(), 'boolean');
  assert.equal(desktop.isDesktopSupported(), isWin);
});

// ====================================================================
// 2. _setPSMock / _clearPSMock mechanism
// ====================================================================

test('_setPSMock dan _clearPSMock tersedia', () => {
  assert.equal(typeof desktop._setPSMock, 'function');
  assert.equal(typeof desktop._clearPSMock, 'function');
});

testAsync('Mock menghasilkan data yang bisa diparse tool', async () => {
  mockPS({ x: 500, y: 300 });
  try {
    const result = await desktop.getCursorPosTool.execute({});
    assert.ok(result.includes('500'), 'Mock data x=500 harus muncul');
    assert.ok(result.includes('300'), 'Mock data y=300 harus muncul');
  } finally {
    clearMock();
  }
});

testAsync('Mock throw ditangani graceful oleh tool', async () => {
  mockPSThrow('PowerShell tidak tersedia');
  try {
    const result = await desktop.getCursorPosTool.execute({});
    assert.ok(result.includes('❌'), 'Error harus ada icon');
    assert.ok(result.includes('PowerShell'), 'Error harus mention PowerShell');
  } finally {
    clearMock();
  }
});

// ====================================================================
// 3. Input Validation — Mouse Tools (NO PowerShell)
// ====================================================================

test('mouse_move error: x missing', async () => {
  const result = await desktop.mouseMoveTool.execute({ y: 100 });
  assert.ok(result.includes('angka'), 'Harus minta angka');
});

test('mouse_move error: y missing', async () => {
  const result = await desktop.mouseMoveTool.execute({ x: 100 });
  assert.ok(result.includes('angka'), 'Harus minta angka');
});

test('mouse_move error: x bukan angka', async () => {
  const result = await desktop.mouseMoveTool.execute({ x: 'abc', y: 100 });
  assert.ok(result.includes('angka'), 'Harus minta angka');
});

test('mouse_move error: keduanya missing', async () => {
  const result = await desktop.mouseMoveTool.execute({});
  assert.ok(result.includes('angka'), 'Harus minta angka');
});

test('mouse_click tidak throw tanpa argumen', async () => {
  const result = await desktop.mouseClickTool.execute({});
  assert.ok(typeof result === 'string');
});

test('mouse_click tidak throw dengan button invalid', async () => {
  const result = await desktop.mouseClickTool.execute({ button: 'invalid' });
  assert.ok(typeof result === 'string');
});

test('get_cursor_pos tidak throw tanpa argumen', async () => {
  const result = await desktop.getCursorPosTool.execute({});
  assert.ok(typeof result === 'string');
});

// ====================================================================
// 4. Mock-based: Mouse Tools
// ====================================================================

testAsync('mouse_move dengan mock berhasil', async () => {
  mockPS({ x: 100, y: 200 });
  try {
    const result = await desktop.mouseMoveTool.execute({ x: 100, y: 200 });
    assert.ok(result.includes('Pindah'), 'Harus sukses');
    assert.ok(result.includes('100'), 'Koordinat x');
    assert.ok(result.includes('200'), 'Koordinat y');
  } finally {
    clearMock();
  }
});

testAsync('mouse_click dengan mock (left)', async () => {
  mockPS({ x: 300, y: 400, button: 'left' });
  try {
    const result = await desktop.mouseClickTool.execute({ button: 'left' });
    assert.ok(result.includes('left-click'), 'Harus left-click');
    assert.ok(result.match(/\d+/), 'Ada koordinat');
  } finally {
    clearMock();
  }
});

testAsync('mouse_click dengan mock (right)', async () => {
  mockPS({ x: 100, y: 100, button: 'right' });
  try {
    const result = await desktop.mouseClickTool.execute({ button: 'right' });
    assert.ok(result.includes('right-click'), 'Harus right-click');
  } finally {
    clearMock();
  }
});

testAsync('mouse_click dengan mock x,y (move then click)', async () => {
  mockPS({ x: 800, y: 600, button: 'left' });
  try {
    const result = await desktop.mouseClickTool.execute({ x: 800, y: 600, button: 'left' });
    assert.ok(result.includes('left-click'), 'Harus click');
    assert.ok(result.includes('800'), 'Koordinat x');
  } finally {
    clearMock();
  }
});

// ====================================================================
// 5. Input Validation — Keyboard Tools (NO PowerShell)
// ====================================================================

test('type_text error: text missing', async () => {
  const result = await desktop.typeTextTool.execute({});
  assert.ok(result.includes('string'), 'Harus minta string');
});

test('type_text error: text empty', async () => {
  const result = await desktop.typeTextTool.execute({ text: '' });
  assert.ok(result.includes('string'), 'Harus minta string');
});

test('type_text error: text bukan string', async () => {
  const result = await desktop.typeTextTool.execute({ text: 123 });
  assert.ok(result.includes('string'), 'Harus minta string');
});

test('press_key error: key missing', async () => {
  const result = await desktop.pressKeyTool.execute({});
  assert.ok(result.includes('string'), 'Harus minta string');
});

test('press_key error: key empty', async () => {
  const result = await desktop.pressKeyTool.execute({ key: '' });
  assert.ok(result.includes('string'), 'Harus minta string');
});

// ====================================================================
// 6. Mock-based: Keyboard Tools
// ====================================================================

testAsync('type_text dengan mock', async () => {
  mockPS({ chars: 5, delay_ms: 10 });
  try {
    const result = await desktop.typeTextTool.execute({ text: 'hello' });
    assert.ok(result.includes('5 karakter'), 'Harus 5 karakter');
    assert.ok(result.includes('diketik'), 'Harus sukses');
  } finally {
    clearMock();
  }
});

testAsync('press_key dengan mock (ctrl+c)', async () => {
  mockPS({ key: '^c' });
  try {
    const result = await desktop.pressKeyTool.execute({ key: 'ctrl+c' });
    assert.ok(result.includes('ctrl+c'), 'Harus mention key');
    assert.ok(result.includes('ditekan'), 'Harus sukses');
  } finally {
    clearMock();
  }
});

testAsync('press_key dengan mock (escape)', async () => {
  mockPS({ key: '{ESC}' });
  try {
    const result = await desktop.pressKeyTool.execute({ key: 'escape' });
    assert.ok(result.includes('escape'), 'Harus mention key');
    assert.ok(result.includes('ditekan'), 'Harus sukses');
  } finally {
    clearMock();
  }
});

testAsync('press_key dengan mock (alt+tab)', async () => {
  mockPS({ key: '%{TAB}' });
  try {
    const result = await desktop.pressKeyTool.execute({ key: 'alt+tab' });
    assert.ok(result.includes('alt+tab'), 'Harus mention kombinasi');
  } finally {
    clearMock();
  }
});

// ====================================================================
// 7. Input Validation — Window & Launch Tools (NO PowerShell)
// ====================================================================

test('focus_window error: title dan pid kosong', async () => {
  const result = await desktop.focusWindowTool.execute({});
  assert.ok(result.includes('title') || result.includes('PID'), 'Harus minta title');
});

test('launch_app error: target missing', async () => {
  const result = await desktop.launchAppTool.execute({});
  assert.ok(result.includes('string'), 'Harus minta target');
});

test('launch_app error: target empty', async () => {
  const result = await desktop.launchAppTool.execute({ target: '' });
  assert.ok(result.includes('string'), 'Harus minta target');
});

// ====================================================================
// 8. Mock-based: Screen, Window & Launch Tools
// ====================================================================

testAsync('get_screen_size dengan mock', async () => {
  mockPS({
    width: 1920,
    height: 1080,
    working_width: 1920,
    working_height: 1040,
    bits_per_pixel: 32,
  });
  try {
    const result = await desktop.getScreenSizeTool.execute({});
    assert.ok(result.includes('1920'), 'Width 1920');
    assert.ok(result.includes('1080'), 'Height 1080');
    assert.ok(result.includes('32 bpp'), 'Bit depth');
    assert.ok(result.includes('Resolusi'), 'Header');
  } finally {
    clearMock();
  }
});

testAsync('get_cursor_pos dengan mock', async () => {
  mockPS({ x: 777, y: 333 });
  try {
    const result = await desktop.getCursorPosTool.execute({});
    assert.ok(result.includes('777'), 'x=777');
    assert.ok(result.includes('333'), 'y=333');
    assert.ok(result.includes('Posisi kursor'), 'Header');
  } finally {
    clearMock();
  }
});

testAsync('list_windows dengan mock (2 windows)', async () => {
  mockPS([
    { hwnd: '100', title: 'Visual Studio Code', pid: 1234, focused: true },
    { hwnd: '200', title: 'Notepad', pid: 5678, focused: false },
  ]);
  try {
    const result = await desktop.listWindowsTool.execute({});
    assert.ok(result.includes('2)'), '2 windows');
    assert.ok(result.includes('Visual Studio Code'), 'VS Code');
    assert.ok(result.includes('Notepad'), 'Notepad');
    assert.ok(result.includes('[1234]'), 'PID 1234');
    assert.ok(result.includes('⬅'), 'Indicator fokus');
  } finally {
    clearMock();
  }
});

testAsync('list_windows dengan mock & filter', async () => {
  mockPS([
    { hwnd: '100', title: 'Google Chrome', pid: 9001, focused: true },
    { hwnd: '200', title: 'Notepad', pid: 5678, focused: false },
    { hwnd: '300', title: 'Chrome DevTools', pid: 9001, focused: false },
  ]);
  try {
    const result = await desktop.listWindowsTool.execute({ filter: 'chrome' });
    assert.ok(result.includes('2)'), '2 chrome windows');
    assert.ok(result.includes('Google Chrome'), 'Chrome');
    assert.ok(result.includes('Chrome DevTools'), 'DevTools');
    assert.ok(!result.includes('Notepad'), 'Notepad tidak masuk filter');
  } finally {
    clearMock();
  }
});

testAsync('list_windows dengan mock (empty results)', async () => {
  mockPS([]);
  try {
    const result = await desktop.listWindowsTool.execute({ filter: 'zzz' });
    assert.ok(result.includes('Tidak ada window'), 'Harus empty message');
  } finally {
    clearMock();
  }
});

testAsync('focus_window dengan mock (by title)', async () => {
  mockPS({ title: 'Visual Studio Code', success: true });
  try {
    const result = await desktop.focusWindowTool.execute({ title: 'Visual Studio Code' });
    assert.ok(result.includes('difokuskan'), 'Harus sukses');
    assert.ok(result.includes('Visual Studio Code'), 'Title sesuai');
  } finally {
    clearMock();
  }
});

testAsync('focus_window dengan mock (by pid)', async () => {
  mockPS({ title: 'Terminal', success: true });
  try {
    const result = await desktop.focusWindowTool.execute({ pid: 12345 });
    assert.ok(result.includes('difokuskan'), 'Harus sukses');
  } finally {
    clearMock();
  }
});

testAsync('focus_window dengan mock (not found)', async () => {
  mockPS({ success: false, error: 'Window tidak ditemukan' });
  try {
    const result = await desktop.focusWindowTool.execute({ title: 'nonexistent' });
    assert.ok(result.includes('❌'), 'Error icon');
    assert.ok(result.includes('tidak ditemukan'), 'Not found message');
  } finally {
    clearMock();
  }
});

testAsync('launch_app dengan mock', async () => {
  mockPS({ pid: 9999, process: 'notepad', success: true });
  try {
    const result = await desktop.launchAppTool.execute({ target: 'notepad.exe' });
    assert.ok(result.includes('PID: 9999'), 'PID sesuai');
    assert.ok(result.includes('notepad'), 'Nama app');
    assert.ok(result.includes('dijalankan'), 'Sukses');
  } finally {
    clearMock();
  }
});

testAsync('launch_app dengan mock (launch fail)', async () => {
  mockPS({ success: false, error: 'File not found' });
  try {
    const result = await desktop.launchAppTool.execute({ target: 'bad.exe' });
    assert.ok(result.includes('❌'), 'Error icon');
    assert.ok(result.includes('File not found'), 'Error message');
  } finally {
    clearMock();
  }
});

// ====================================================================
// 9. PowerShell Error Handling (mock throws)
// ====================================================================

testAsync('Tool catch error PowerShell graceful', async () => {
  mockPSThrow('Access denied');
  try {
    const results = await Promise.all([
      desktop.getScreenSizeTool.execute({}),
      desktop.getCursorPosTool.execute({}),
      desktop.mouseMoveTool.execute({ x: 1, y: 1 }),
      desktop.mouseClickTool.execute({}),
      desktop.typeTextTool.execute({ text: 'x' }),
      desktop.pressKeyTool.execute({ key: 'enter' }),
      desktop.listWindowsTool.execute({}),
      desktop.launchAppTool.execute({ target: 'test' }),
    ]);
    for (const r of results) {
      assert.ok(typeof r === 'string', 'Semua harus return string');
      assert.ok(r.length > 0, 'Tidak boleh empty');
      assert.ok(r.includes('❌'), 'Harus ada error icon');
    }
  } finally {
    clearMock();
  }
});

// ====================================================================
// 10. Real Smoke Tests (Windows only, aman & read-only)
// ====================================================================

if (isWin) {
  // Pastikan mock sudah clear sebelum tes real
  clearMock();

  testAsync('[REAL] get_screen_size mengembalikan resolusi', async () => {
    const result = await desktop.getScreenSizeTool.execute({});
    assert.ok(result.includes('×'), 'Ada dimensi');
    assert.ok(result.includes('Resolusi'), 'Header');
    assert.ok(result.includes('bpp'), 'Bit depth');
    assert.match(result, /\d+/g, 'Angka dimensi');
  });

  testAsync('[REAL] screenshot return path + metadata', async () => {
    const result = await desktop.screenshotTool.execute({});
    assert.ok(result.includes('.png'), 'File PNG');
    assert.ok(result.includes('px'), 'Dimensi');
    assert.ok(result.includes('KB'), 'Ukuran file');
    const pathMatch = result.match(/Path\s+:\s(.+\.png)/);
    if (pathMatch) {
      const fs = await import('node:fs');
      assert.ok(fs.existsSync(pathMatch[1]), 'File harus ada di disk');
    }
  });

  testAsync('[REAL] list_windows return daftar window', async () => {
    const result = await desktop.listWindowsTool.execute({});
    assert.ok(result.includes('Window'), 'Header');
    assert.match(result, /\[\d+\]/, 'Ada PID');
  });
} else {
  // Non-Windows: verifikasi platform error
  test('Screenshot returns platform error di non-Windows', async () => {
    const result = await desktop.screenshotTool.execute({});
    assert.ok(result.includes('Windows'), 'Bilang Windows-only');
  });

  test('get_screen_size returns platform error di non-Windows', async () => {
    const result = await desktop.getScreenSizeTool.execute({});
    assert.ok(result.includes('Windows'), 'Bilang Windows-only');
  });
}

// ====================================================================
// Cleanup & Summary
// ====================================================================

clearMock(); // ensure clean state

console.log(`\n📊 Hasil: ${passed} passed, ${failed} failed from ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
