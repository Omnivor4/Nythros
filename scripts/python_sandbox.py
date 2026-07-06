#!/usr/bin/env python3
"""
python_sandbox.py — Jalankan kode Python dari stdin dengan sandbox minimal.

Input (stdin JSON):
  {
    "code": "print('hello world')",
    "timeout": 10,
    "working_dir": "/path/to/project"
  }

Output (stdout JSON):
  {
    "stdout": "hello world\n",
    "stderr": "",
    "success": true,
    "exec_time_ms": 45
  }
"""

import sys
import json
import time
import subprocess
import tempfile
import os
from pathlib import Path

def run_code(code, timeout=10, working_dir=None):
    start = time.time()

    # Tulis kode ke temp file supaya tidak ada shell injection
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py',
                                     delete=False, encoding='utf-8') as f:
        f.write(code)
        tmp_path = f.name

    try:
        result = subprocess.run(
            [sys.executable, tmp_path],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=working_dir or os.getcwd(),
            # Batasi environment — hanya yang essential
            env={
                'PATH': os.environ.get('PATH', ''),
                'HOME': os.environ.get('HOME', os.environ.get('USERPROFILE', '')),
                'PYTHONPATH': os.environ.get('PYTHONPATH', ''),
                'SYSTEMROOT': os.environ.get('SYSTEMROOT', ''),
                'TEMP': os.environ.get('TEMP', ''),
                'TMP': os.environ.get('TMP', ''),
            }
        )

        exec_time = round((time.time() - start) * 1000)

        return {
            "stdout": result.stdout[:5000],  # max 5000 chars output
            "stderr": result.stderr[:2000],  # max 2000 chars error
            "success": result.returncode == 0,
            "return_code": result.returncode,
            "exec_time_ms": exec_time
        }

    except subprocess.TimeoutExpired:
        return {
            "stdout": "",
            "stderr": f"Timeout: eksekusi melebihi {timeout} detik",
            "success": False,
            "exec_time_ms": timeout * 1000
        }
    except Exception as e:
        return {
            "stdout": "",
            "stderr": str(e),
            "success": False,
            "exec_time_ms": 0
        }
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.stdin.read())
        code = input_data.get("code", "")
        timeout = min(input_data.get("timeout", 10), 30)  # max 30 detik
        working_dir = input_data.get("working_dir", None)

        if not code.strip():
            print(json.dumps({"error": "Tidak ada kode untuk dijalankan"}))
            sys.exit(1)

        result = run_code(code, timeout, working_dir)
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"error": str(e), "success": False}))
