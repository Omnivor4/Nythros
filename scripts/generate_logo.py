#!/usr/bin/env python3
"""
generate_logo.py — Generate ANSI art dari file gambar untuk Nythros logo.

Usage:
  python3 scripts/generate_logo.py BG.png
  python3 scripts/generate_logo.py BG.png --width 20 --output src/ui/logo.js

Requires: pip install Pillow
"""

import sys
import json
import argparse
from pathlib import Path

def check_pillow():
    try:
        from PIL import Image
        return True
    except ImportError:
        print(json.dumps({
            "error": "Pillow tidak ter-install. Jalankan: pip install Pillow",
            "success": False
        }))
        return False

def rgb_to_ansi_fg(r, g, b):
    return f"\x1b[38;2;{r};{g};{b}m"

def rgb_to_ansi_bg(r, g, b):
    return f"\x1b[48;2;{r};{g};{b}m"

RESET = "\x1b[0m"

def image_to_ansi(image_path, target_width=20, target_height=6):
    """
    Convert gambar ke ANSI art menggunakan teknik half-block (▀).
    Setiap karakter merepresentasikan 2 pixel vertikal:
    - foreground color = pixel atas
    - background color = pixel bawah
    """
    from PIL import Image

    img = Image.open(image_path).convert("RGBA")

    # Resize ke target dimensions (tinggi x2 karena half-block)
    img = img.resize((target_width, target_height * 2), Image.LANCZOS)
    pixels = img.load()

    rows = []
    for row in range(target_height):
        line = ""
        for col in range(target_width):
            top_r, top_g, top_b, top_a = pixels[col, row * 2]
            bot_r, bot_g, bot_b, bot_a = pixels[col, row * 2 + 1]

            # Pixel transparan → skip (background terminal)
            if top_a < 10 and bot_a < 10:
                line += " "
                continue

            if top_a < 10:
                # Hanya bawah yang ada isi
                line += f"{rgb_to_ansi_bg(bot_r, bot_g, bot_b)} {RESET}"
            elif bot_a < 10:
                # Hanya atas yang ada isi
                line += f"{rgb_to_ansi_fg(top_r, top_g, top_b)}▀{RESET}"
            else:
                # Keduanya ada isi
                line += f"{rgb_to_ansi_fg(top_r, top_g, top_b)}{rgb_to_ansi_bg(bot_r, bot_g, bot_b)}▀{RESET}"

        rows.append(line)

    return rows

def generate_js_output(rows, image_path):
    """Generate konten logo.js yang siap di-paste."""
    escaped_rows = []
    for row in rows:
        # Escape backslash dan quote untuk JS string literal
        escaped = row.replace("\\", "\\\\").replace('"', '\\"')
        escaped_rows.append(f'  "{escaped}"')

    rows_str = ",\n".join(escaped_rows)

    # Calculate actual visible width (stripping ANSI escape sequences)
    import re
    ansi_escape = re.compile(r'\x1b\[[0-9;]*m')
    visible_widths = [len(ansi_escape.sub('', row)) for row in rows]
    max_width = max(visible_widths) if visible_widths else 20

    return f'''// Logo Nythros — di-generate otomatis dari {Path(image_path).name}
// Jangan edit manual! Re-generate dengan:
//   python3 scripts/generate_logo.py {Path(image_path).name}
// Requires: pip install Pillow

export const CROWN_LOGO = [
{rows_str},
];

export const CROWN_LOGO_WIDTH = {max_width};
'''

def main():
    parser = argparse.ArgumentParser(description='Generate ANSI logo dari gambar')
    parser.add_argument('image', help='Path ke file gambar (PNG/JPG)')
    parser.add_argument('--width', type=int, default=20, help='Lebar output (karakter)')
    parser.add_argument('--height', type=int, default=6, help='Tinggi output (baris)')
    parser.add_argument('--output', help='Output file (default: print ke stdout)')
    parser.add_argument('--preview', action='store_true', help='Preview di terminal tanpa save')
    args = parser.parse_args()

    if not check_pillow():
        sys.exit(1)

    if not Path(args.image).exists():
        print(f"Error: File tidak ditemukan: {args.image}", file=sys.stderr)
        sys.exit(1)

    rows = image_to_ansi(args.image, args.width, args.height)

    if args.preview:
        print("\nPreview logo:")
        for row in rows:
            print(row)
        print()
        return

    js_content = generate_js_output(rows, args.image)

    if args.output:
        # Pertahankan NYTHROS_TEXT dari file lama (kalau ada)
        output_path = Path(args.output)
        nythros_text_section = ""
        if output_path.exists():
            content = output_path.read_text()
            # Ambil bagian NYTHROS_TEXT yang sudah ada
            start = content.find("export const NYTHROS_TEXT")
            if start != -1:
                nythros_text_section = "\n" + content[start:]

        output_path.write_text(js_content + nythros_text_section)
        print(f"✅ Logo di-generate ke {args.output}")
    else:
        print(js_content)

if __name__ == "__main__":
    main()
