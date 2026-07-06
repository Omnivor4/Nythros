#!/usr/bin/env python3
"""
analyze_image.py — Ekstrak informasi dari file gambar untuk dikirim ke LLM.

Baca path dari stdin (JSON: {"path": "/path/to/image.png"})
Print hasil ke stdout sebagai JSON.

Requires: pip install Pillow
Optional: pip install pytesseract (untuk OCR)
"""

import sys
import json
from pathlib import Path

def analyze(image_path):
    try:
        from PIL import Image, ImageStat
    except ImportError:
        return {"error": "Pillow tidak ter-install. Jalankan: pip install Pillow"}

    path = Path(image_path)
    if not path.exists():
        return {"error": f"File tidak ditemukan: {image_path}"}

    try:
        img = Image.open(image_path)
        stat = ImageStat.Stat(img)

        # Info dasar
        result = {
            "filename": path.name,
            "format": img.format or path.suffix.upper().lstrip('.'),
            "mode": img.mode,
            "width": img.width,
            "height": img.height,
            "size_bytes": path.stat().st_size,
            "size_kb": round(path.stat().st_size / 1024, 1),
        }

        # Warna dominan (5 warna teratas)
        if img.mode in ('RGB', 'RGBA'):
            img_small = img.convert('RGB').resize((50, 50))
            pixels = list(img_small.getdata())
            # Kuantisasi warna
            from collections import Counter
            # Kelompokkan per 32px bucket untuk mengurangi noise
            bucketed = [(r//32*32, g//32*32, b//32*32) for r,g,b in pixels]
            common = Counter(bucketed).most_common(5)
            result["dominant_colors"] = [
                f"rgb({r},{g},{b})" for (r,g,b), _ in common
            ]

        # Rata-rata brightness
        if img.mode in ('RGB', 'RGBA', 'L'):
            gray = img.convert('L')
            brightness = sum(gray.getdata()) / (gray.width * gray.height)
            result["brightness"] = round(brightness / 255 * 100, 1)
            result["is_dark"] = brightness < 128

        # OCR (opsional — hanya kalau pytesseract tersedia)
        try:
            import pytesseract
            text = pytesseract.image_to_string(img).strip()
            if text:
                result["detected_text"] = text[:500]  # max 500 chars
        except (ImportError, Exception):
            pass  # OCR tidak tersedia, skip

        return result

    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.stdin.read())
        image_path = input_data.get("path", "")
        result = analyze(image_path)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
