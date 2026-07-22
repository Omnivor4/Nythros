// src/tooling/desktopTools.js
// Desktop automation tools for Windows — screenshot, mouse, keyboard, window management
// Menggunakan PowerShell + .NET APIs (built-in di Windows, no dependencies needed)

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { safeError } from '../shared/utils/error.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const POWERSHELL = process.platform === 'win32' ? 'powershell.exe' : null;

// Mock support untuk testing — tanpa mock, panggil PowerShell beneran
let _mockPS = null;

/**
 * Set mock function untuk menggantikan eksekusi PowerShell.
 * Mock function dipanggil dengan (script, options) dan harus return string (stdout).
 * Call _clearPSMock() untuk restore ke PowerShell beneran.
 */
export function _setPSMock(fn) {
  _mockPS = fn;
}

/** Restore eksekusi PowerShell beneran setelah mock. */
export function _clearPSMock() {
  _mockPS = null;
}

function isWindows() {
  return process.platform === 'win32';
}

function execPS(script, options = {}) {
  if (_mockPS) {
    return _mockPS(script, options);
  }
  if (!isWindows()) {
    throw new Error('Desktop tools hanya support Windows.');
  }
  const { timeout = 15000, maxBuffer = 10 * 1024 * 1024 } = options;
  try {
    const result = execFileSync(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
      {
        encoding: 'utf-8',
        timeout,
        maxBuffer,
        windowsHide: true,
      },
    );
    return result.trim();
  } catch (e) {
    const stderr = e.stderr || e.message || '';
    throw new Error(`PowerShell error: ${stderr.slice(0, 1000)}`, { cause: e });
  }
}

function execPSJson(script, options = {}) {
  const out = execPS(script, options);
  if (!out) throw new Error('PowerShell returned empty output.');
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`PowerShell JSON parse error: ${out.slice(0, 200)}`);
  }
}

// ── Screenshot ──────────────────────────────────────────────────────────────

const WIN32_SCREENSHOT = `
Add-Type -AssemblyName System.Windows.Forms;
Add-Type -AssemblyName System.Drawing;
try {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
  $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height;
  $g = [System.Drawing.Graphics]::FromImage($bmp);
  $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);
  $g.Dispose();
  $path = [Environment]::GetFolderPath('UserProfile') + '\\.nythros\\screenshots\\screen_' + [DateTime]::Now.ToString('yyyyMMdd_HHmmss') + '.png';
  $dir = [System.IO.Path]::GetDirectoryName($path);
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null; }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png);
  $bmp.Dispose();
  $fi = New-Object System.IO.FileInfo($path);
  Write-Output "{""path"":""$($path.Replace('\\','/'))"",""width"":$($bounds.Width),""height"":$($bounds.Height),""size_kb"":$([Math]::Round($fi.Length / 1024, 1))}";
} catch {
  Write-Output "{""error"":""$($_.Exception.Message.Replace('"','\\"'))""}";
}
`;

export const screenshotTool = {
  name: 'screenshot',
  description:
    'Ambil screenshot layar utama. Menyimpan ke ~/.nythros/screenshots/ dan mengembalikan path + metadata. Hanya untuk Windows.',
  input_schema: {
    type: 'object',
    properties: {
      output_path: {
        type: 'string',
        description:
          'Path custom untuk menyimpan screenshot (opsional). Default: timestamp-based di ~/.nythros/screenshots/',
      },
    },
    required: [],
  },
  execute: async ({ output_path } = {}) => {
    if (!isWindows()) return '❌ Screenshot hanya support di Windows (PowerShell + .NET Drawing).';
    try {
      let result;
      if (output_path) {
        const dir = path.dirname(output_path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const absPath = path.resolve(output_path);
        const script = `
          Add-Type -AssemblyName System.Windows.Forms;
          Add-Type -AssemblyName System.Drawing;
          try {
            $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
            $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height;
            $g = [System.Drawing.Graphics]::FromImage($bmp);
            $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);
            $g.Dispose();
            $bmp.Save('${absPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png);
            $bmp.Dispose();
            $fi = New-Object System.IO.FileInfo('${absPath.replace(/\\/g, '\\\\')}');
            Write-Output "{""path"":""$('${absPath.replace(/\\/g, '/')}')"",""width"":$($bounds.Width),""height"":$($bounds.Height),""size_kb"":$([Math]::Round($fi.Length / 1024, 1))}";
          } catch {
            Write-Output "{""error"":""$($_.Exception.Message.Replace('"','\\"'))""}";
          }
        `;
        result = execPSJson(script, { timeout: 10000 });
      } else {
        result = execPSJson(WIN32_SCREENSHOT, { timeout: 10000 });
      }
      if (result.error) return `❌ Gagal screenshot: ${result.error}`;
      const lines = [
        '📸 Screenshot tersimpan:',
        `  Path   : ${result.path}`,
        `  Size   : ${result.width} × ${result.height} px`,
        `  File   : ${result.size_kb} KB`,
      ];
      return lines.join('\n');
    } catch (e) {
      return `❌ Gagal screenshot: ${safeError(e)}`;
    }
  },
};

// ── Mouse ──────────────────────────────────────────────────────────────────

export const mouseMoveTool = {
  name: 'mouse_move',
  description: 'Pindahkan kursor mouse ke koordinat (x, y) di layar. Hanya Windows.',
  input_schema: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'Koordinat X target' },
      y: { type: 'number', description: 'Koordinat Y target' },
    },
    required: ['x', 'y'],
  },
  execute: async ({ x, y }) => {
    if (!isWindows()) return '❌ Mouse control hanya support di Windows.';
    if (typeof x !== 'number' || typeof y !== 'number') return '❌ x dan y harus angka.';
    try {
      const script = `
        Add-Type -AssemblyName System.Windows.Forms;
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y);
        $pos = [System.Windows.Forms.Cursor]::Position;
        Write-Output "{""x"":$($pos.X),""y"":$($pos.Y)}";
      `;
      const result = execPSJson(script);
      return `🖱️ Pindah ke (${result.x}, ${result.y})`;
    } catch (e) {
      return `❌ Gagal move mouse: ${safeError(e)}`;
    }
  },
};

export const mouseClickTool = {
  name: 'mouse_click',
  description:
    'Klik mouse di posisi kursor saat ini. Bisa left, right, atau double. Hanya Windows.',
  input_schema: {
    type: 'object',
    properties: {
      button: {
        type: 'string',
        enum: ['left', 'right', 'double'],
        description: 'Tombol mouse (default: left)',
      },
      x: {
        type: 'number',
        description: 'Opsional: pindah ke koordinat X dulu sebelum klik',
      },
      y: {
        type: 'number',
        description: 'Opsional: pindah ke koordinat Y dulu sebelum klik',
      },
    },
    required: [],
  },
  execute: async ({ button = 'left', x, y } = {}) => {
    if (!isWindows()) return '❌ Mouse control hanya support di Windows.';
    try {
      const isDouble = button === 'double';
      const btnFlag = button === 'right' ? '0x0008' : '0x0002'; // MOUSEEVENTF_RIGHTDOWN or LEFTDOWN
      const btnUpFlag = button === 'right' ? '0x0010' : '0x0004'; // MOUSEEVENTF_RIGHTUP or LEFTUP
      const moveScript =
        x !== undefined && y !== undefined
          ? `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y);`
          : '';

      // Double-click needs: down → up → down → up (two complete cycles)
      const clickSequence = isDouble
        ? `
        [Win32Mouse]::mouse_event(${btnFlag}, 0, 0, 0, 0);
        Start-Sleep -Milliseconds 50;
        [Win32Mouse]::mouse_event(${btnUpFlag}, 0, 0, 0, 0);
        Start-Sleep -Milliseconds 50;
        [Win32Mouse]::mouse_event(${btnFlag}, 0, 0, 0, 0);
        Start-Sleep -Milliseconds 50;
        [Win32Mouse]::mouse_event(${btnUpFlag}, 0, 0, 0, 0);`
        : `
        [Win32Mouse]::mouse_event(${btnFlag}, 0, 0, 0, 0);
        Start-Sleep -Milliseconds 50;
        [Win32Mouse]::mouse_event(${btnUpFlag}, 0, 0, 0, 0);`;

      const script = `
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32Mouse {
          [DllImport("user32.dll")]
          public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
        }
"@;
        ${moveScript}
        Start-Sleep -Milliseconds 50;${clickSequence}
        $pos = [System.Windows.Forms.Cursor]::Position;
        Write-Output "{""x"":$($pos.X),""y"":$($pos.Y),""button"":""${button}""}";
      `;
      const result = execPSJson(script);
      const action = button === 'double' ? 'double-click' : `${button}-click`;
      return `🖱️ ${action} di (${result.x}, ${result.y})`;
    } catch (e) {
      return `❌ Gagal klik: ${safeError(e)}`;
    }
  },
};

export const getCursorPosTool = {
  name: 'get_cursor_pos',
  description: 'Dapatkan posisi kursor mouse saat ini (x, y). Hanya Windows.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async () => {
    if (!isWindows()) return '❌ Cursor position hanya support di Windows.';
    try {
      const script = `
        Add-Type -AssemblyName System.Windows.Forms;
        $pos = [System.Windows.Forms.Cursor]::Position;
        Write-Output "{""x"":$($pos.X),""y"":$($pos.Y)}";
      `;
      const result = execPSJson(script);
      return `📍 Posisi kursor: (${result.x}, ${result.y})`;
    } catch (e) {
      return `❌ Gagal get cursor: ${safeError(e)}`;
    }
  },
};

// ── Screen ─────────────────────────────────────────────────────────────────

export const getScreenSizeTool = {
  name: 'get_screen_size',
  description: 'Dapatkan resolusi layar utama (lebar × tinggi). Hanya Windows.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async () => {
    if (!isWindows()) return '❌ Screen size hanya support di Windows.';
    try {
      const script = `
        Add-Type -AssemblyName System.Windows.Forms;
        $s = [System.Windows.Forms.Screen]::PrimaryScreen;
        $b = $s.Bounds;
        Write-Output "{""width"":$($b.Width),""height"":$($b.Height),""working_width"":$($s.WorkingArea.Width),""working_height"":$($s.WorkingArea.Height),""bits_per_pixel"":$($s.BitsPerPixel)}";
      `;
      const result = execPSJson(script);
      return [
        '🖥️ Layar:',
        `  Resolusi : ${result.width} × ${result.height}`,
        `  Area kerja: ${result.working_width} × ${result.working_height}`,
        `  Bit depth: ${result.bits_per_pixel} bpp`,
      ].join('\n');
    } catch (e) {
      return `❌ Gagal get screen size: ${safeError(e)}`;
    }
  },
};

// ── Keyboard ───────────────────────────────────────────────────────────────

export const typeTextTool = {
  name: 'type_text',
  description: 'Ketik teks di jendela yang sedang aktif/fokus. Hanya Windows.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Teks yang akan diketik' },
      delay_ms: {
        type: 'number',
        description:
          'Delay antar karakter dalam ms (default: 10, lebih tinggi = lebih lambat & realistis)',
      },
    },
    required: ['text'],
  },
  execute: async ({ text, delay_ms = 10 }) => {
    if (!isWindows()) return '❌ Keyboard hanya support di Windows.';
    if (!text || typeof text !== 'string') return '❌ text harus string.';
    try {
      // Escape text for PowerShell double-quoted string.
      // ORDER MATTERS: backtick FIRST so it doesn't double-up on inserted backticks!
      // $ = variable expansion → `$
      // ` = escape char     → ``
      // \ = path sep        → \\
      // ", \n, \r, \t     → standard escapes
      const escaped = text
        .replace(/`/g, '``') // backtick FIRST! (before \n/\t/\$ insert them)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '`n')
        .replace(/\r/g, '')
        .replace(/\t/g, '`t')
        .replace(/\$/g, '`$');
      // Use clipboard + Ctrl+V for reliable typing (no SendKeys escaping issues)
      // delay_ms is accepted but not implemented for per-char delay (clipboard is instant)
      const script = `
        Add-Type -AssemblyName System.Windows.Forms;
        $text = "${escaped}";
        [System.Windows.Forms.Clipboard]::SetText($text);
        Start-Sleep -Milliseconds 100;
        [System.Windows.Forms.SendKeys]::SendWait("^v");
        Write-Output "{""chars"":$($text.Length),""delay_ms"":${delay_ms}}";
      `;
      const result = execPSJson(script, { timeout: 30000 }); // longer timeout for long texts
      return `⌨️ ${result.chars} karakter diketik${result.delay_ms > 10 ? ` (delay ${result.delay_ms}ms/char)` : ''}.`;
    } catch (e) {
      return `❌ Gagal type: ${safeError(e)}`;
    }
  },
};

const KEY_MAP = {
  enter: '{ENTER}',
  tab: '{TAB}',
  escape: '{ESC}',
  esc: '{ESC}',
  backspace: '{BACKSPACE}',
  delete: '{DELETE}',
  space: ' ',
  home: '{HOME}',
  end: '{END}',
  up: '{UP}',
  down: '{DOWN}',
  left: '{LEFT}',
  right: '{RIGHT}',
  pageup: '{PGUP}',
  pagedown: '{PGDN}',
  f1: '{F1}',
  f2: '{F2}',
  f3: '{F3}',
  f4: '{F4}',
  f5: '{F5}',
  f6: '{F6}',
  f7: '{F7}',
  f8: '{F8}',
  f9: '{F9}',
  f10: '{F10}',
  f11: '{F11}',
  f12: '{F12}',
  shift: '+',
  ctrl: '^',
  alt: '%',
  capslock: '{CAPSLOCK}',
  insert: '{INSERT}',
  printscreen: '{PRTSC}',
  scrolllock: '{SCROLLLOCK}',
  pause: '{PAUSE}',
  numlock: '{NUMLOCK}',
};

export const pressKeyTool = {
  name: 'press_key',
  description:
    'Tekan tombol keyboard khusus (Enter, Tab, Escape, F1-F12, dll). Lihat daftar lengkap di key_map_description. Hanya Windows.',
  input_schema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description:
          'Nama tombol. Support: enter, tab, escape, backspace, delete, space, home, end, up/down/left/right, pageup/pagedown, f1-f12, shift, ctrl, alt, capslock, insert, printscreen, numlock. Bisa kombinasi: "ctrl+c", "alt+tab", "shift+enter"',
      },
    },
    required: ['key'],
  },
  execute: async ({ key }) => {
    if (!isWindows()) return '❌ Keyboard hanya support di Windows.';
    if (!key || typeof key !== 'string') return '❌ key harus string.';
    try {
      // For combination keys like ctrl+c, alt+tab
      const parts = key.toLowerCase().split('+');
      let sendKey = '';
      for (const part of parts) {
        const trimmed = part.trim();
        sendKey += KEY_MAP[trimmed] || trimmed;
      }
      const escapedSendKey = sendKey.replace(/"/g, '""');
      const script = `
        Add-Type -AssemblyName System.Windows.Forms;
        [System.Windows.Forms.SendKeys]::SendWait("${escapedSendKey}");
        Write-Output "{""key"":""${escapedSendKey}""}";
      `;
      execPSJson(script);
      return `⌨️ Key "${key}" ditekan.`;
    } catch (e) {
      return `❌ Gagal press key: ${safeError(e)}`;
    }
  },
};

// ── Window Management ──────────────────────────────────────────────────────

const WIN32_WINDOW_ENUM = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Window {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@
$result = New-Object System.Collections.ArrayList;
$enumProc = [Win32Window+EnumWindowsProc]{
  param($hWnd, $lParam)
  if ([Win32Window]::IsWindowVisible($hWnd)) {
    $sb = New-Object System.Text.StringBuilder 256;
    [Win32Window]::GetWindowText($hWnd, $sb, 256);
    $title = $sb.ToString();
    if ($title -ne "") {
      $procId = 0;
      [Win32Window]::GetWindowThreadProcessId($hWnd, [ref]$procId);
      $fg = [Win32Window]::GetForegroundWindow();
      [void]$result.Add(@{hwnd=$hWnd.ToString(); title=$title; pid=$procId; focused=($hWnd -eq $fg)});
    }
  }
  return $true;
};
[Win32Window]::EnumWindows($enumProc, [IntPtr]::Zero);
$result | Where-Object { $_.title.Length -gt 0 } | Select-Object -First 50 | ConvertTo-Json -Compress;
`;

export const listWindowsTool = {
  name: 'list_windows',
  description:
    'Daftar jendela aplikasi yang sedang terbuka (title, PID, status fokus). Maks 50 window. Hanya Windows.',
  input_schema: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        description:
          'Filter berdasarkan title (case-insensitive). Contoh: "chrome", "notepad", "code"',
      },
    },
    required: [],
  },
  execute: async ({ filter } = {}) => {
    if (!isWindows()) return '❌ Window list hanya support di Windows.';
    try {
      const result = execPSJson(WIN32_WINDOW_ENUM, { timeout: 10000 });
      const windows = Array.isArray(result) ? result : [result];
      const filtered = filter
        ? windows.filter((w) => w.title.toLowerCase().includes(filter.toLowerCase()))
        : windows;

      if (filtered.length === 0) {
        return filter
          ? `🔍 Tidak ada window dengan title mengandung "${filter}".`
          : 'Tidak ada window terbuka.';
      }

      const lines = [`🪟 Window terbuka (${filtered.length}):`];
      filtered.forEach((w, i) => {
        const focus = w.focused ? ' ⬅️' : '';
        lines.push(`  ${i + 1}. [${w.pid}] "${w.title}"${focus}`);
      });
      return lines.join('\n');
    } catch (e) {
      return `❌ Gagal list windows: ${safeError(e)}`;
    }
  },
};

export const focusWindowTool = {
  name: 'focus_window',
  description: 'Fokuskan jendela aplikasi berdasarkan title (atau sebagai PID). Hanya Windows.',
  input_schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description:
          'Title window untuk difokuskan (case-insensitive, partial match). Contoh: "Visual Studio", "Chrome"',
      },
      pid: {
        type: 'number',
        description: 'Atau PID proses untuk difokuskan (alternatif dari title)',
      },
    },
    required: [],
  },
  execute: async ({ title, pid } = {}) => {
    if (!isWindows()) return '❌ Window focus hanya support di Windows.';
    if (!title && !pid) return '❌ Masukkan title atau PID window.';
    try {
      const script = `
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class Win32Window {
          public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
          [DllImport("user32.dll")]
          public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
          [DllImport("user32.dll")]
          public static extern bool IsWindowVisible(IntPtr hWnd);
          [DllImport("user32.dll", CharSet = CharSet.Auto)]
          public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
          [DllImport("user32.dll")]
          public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
          [DllImport("user32.dll")]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        }
"@
        $target = "${(title || '').replace(/"/g, '\\"')}";
        $targetPid = ${pid || 0};
        $found = $null;
        $enumProc = [Win32Window+EnumWindowsProc]{
          param($hWnd, $lParam)
          if ([Win32Window]::IsWindowVisible($hWnd)) {
            $sb = New-Object System.Text.StringBuilder 256;
            [Win32Window]::GetWindowText($hWnd, $sb, 256);
            $title = $sb.ToString();
            if ($title -ne "") {
              $p = 0;
              [Win32Window]::GetWindowThreadProcessId($hWnd, [ref]$p);
              $matchTitle = ($target -eq "" -or $title -like "*$target*");
              $matchPid = ($targetPid -eq 0 -or $p -eq $targetPid);
              if ($matchTitle -and $matchPid) {
                ${'$found'} = $hWnd;
                return $false; # stop enumeration
              }
            }
          }
          return $true;
        };
        [Win32Window]::EnumWindows($enumProc, [IntPtr]::Zero);
        if (${'$found'} -ne $null) {
          [Win32Window]::ShowWindow(${'$found'}, 9); # SW_RESTORE
          [Win32Window]::SetForegroundWindow(${'$found'});
          Start-Sleep -Milliseconds 200;
          $sb = New-Object System.Text.StringBuilder 256;
          [Win32Window]::GetWindowText(${'$found'}, $sb, 256);
          Write-Output "{""title"":""$($sb.ToString().Replace('"','\\"'))"",""success"":true}";
        } else {
          Write-Output "{""success"":false,""error"":""Window tidak ditemukan""}";
        }
      `;
      const result = execPSJson(script, { timeout: 10000 });
      if (!result.success) return `❌ Window "${title || pid}" tidak ditemukan.`;
      return `🪟 Window "${result.title}" difokuskan.`;
    } catch (e) {
      return `❌ Gagal focus window: ${safeError(e)}`;
    }
  },
};

// ── Launch App ──────────────────────────────────────────────────────────────

export const launchAppTool = {
  name: 'launch_app',
  description:
    'Jalankan aplikasi atau file. Bisa path executable, URL, atau nama aplikasi. Hanya Windows.',
  input_schema: {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        description:
          'Path executable, URL (http://), nama aplikasi (notepad, calc, chrome), atau file',
      },
      args: {
        type: 'string',
        description: 'Argumen untuk executable (opsional)',
      },
    },
    required: ['target'],
  },
  execute: async ({ target, args = '' } = {}) => {
    if (!isWindows()) return '❌ Launch app hanya support di Windows.';
    if (!target || typeof target !== 'string') return '❌ target harus string.';
    try {
      const escapedTarget = target.replace(/"/g, '""');
      const escapedArgs = args.replace(/"/g, '""');
      const script = `
        try {
          $proc = Start-Process -FilePath "${escapedTarget}" ${escapedArgs ? `-ArgumentList "${escapedArgs}"` : ''} -PassThru -WindowStyle Normal;
          Start-Sleep -Milliseconds 500;
          if ($proc -and $proc.Id) {
            $pName = if ($proc.ProcessName) { $proc.ProcessName.Replace('"','\\"') } else { '' };
            Write-Output "{""pid"":$($proc.Id),""process"":""$pName"",""success"":true}";
          } else {
            Write-Output "{""success"":true,""pid"":0}";
          }
        } catch {
          Write-Output "{""success"":false,""error"":""$($_.Exception.Message.Replace('"','\\"'))""}";
        }
      `;
      const result = execPSJson(script, { timeout: 15000 });
      if (!result.success) return `❌ Gagal launch: ${result.error}`;
      const msg = result.pid
        ? `🚀 "${target}" dijalankan (PID: ${result.pid})`
        : `🚀 "${target}" dijalankan.`;
      return msg;
    } catch (e) {
      return `❌ Gagal launch app: ${safeError(e)}`;
    }
  },
};

// ── Tool List ───────────────────────────────────────────────────────────────

export const desktopTools = [
  screenshotTool,
  mouseMoveTool,
  mouseClickTool,
  getCursorPosTool,
  getScreenSizeTool,
  typeTextTool,
  pressKeyTool,
  listWindowsTool,
  focusWindowTool,
  launchAppTool,
];

// ── Platform Check ──────────────────────────────────────────────────────────

export function isDesktopSupported() {
  return isWindows();
}
