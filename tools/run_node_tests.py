"""Run the existing Node regression files; summarize instead of printing secrets."""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

if __name__ == "__main__":
    binary = shutil.which("node")
    if not binary:
        raise SystemExit("Node.js is required")
    tests = sorted((ROOT / "tests").glob("*.test.js"))
    failures = []
    for test in tests:
        result = subprocess.run([binary, str(test)], cwd=ROOT, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=90)
        if result.returncode:
            failures.append(test.name)
            print(test.name + " failed:\n" + result.stderr[-2500:], file=sys.stderr)
    print(f"Node test files: {len(tests)}, passed: {len(tests)-len(failures)}, failed: {len(failures)}")
    raise SystemExit(bool(failures))
