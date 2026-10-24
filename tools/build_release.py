"""Create distinct GitHub-source and Firebase-web packages from reviewed lists."""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_PARTS = {".secrets", ".pilot-data", ".backups", ".git", "__pycache__", "node_modules", ".venv"}
SECRET_PATTERNS = {
    "OpenAI key": re.compile(r"sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}"),
    "Google API key": re.compile(r"AIza[A-Za-z0-9_-]{30,}"),
    "GitHub token": re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})"),
    "Private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "Provider key assignment": re.compile(r"(?i)(?:VWORLD|JUSO)[_A-Z]*(?:API_KEY|KEY)\s*[:=]\s*[\"'][A-Za-z0-9-]{28,}[\"']"),
    "Credential in query": re.compile(r"(?i)[?&](?:key|api[_-]?key|serviceKey|confmKey|access_token)=[A-Za-z0-9_%.-]{16,}"),
}
# Exact existing synthetic fixtures, never a general exemption for tests/URLs.
QUERY_FIXTURES = {
    "tests/study-review-snapshot.test.js": {"DO_NOT_ARCHIVE_URL_KEY"},
    "tests/test_parcel_context.py": {"PRIVATE_TEST_KEY"},
}
# Hosting must distribute the notices accompanying its bundled JavaScript.
# Keep these exact paths separate from the app's general static-file policy.
HOSTING_NOTICE_FILES = {"NOTICE.md", "vendor/polygon-clipping-LICENSE.md"}
STATELESS_DEPLOYMENT_CONFIG = (
    "window.FORMEQUA_DEPLOYMENT = Object.freeze({\n"
    "  reviewStorageEnabled: false,\n"
    "  remoteStudiesEnabled: false\n"
    "});\n"
)
ARCHIVE_DEPLOYMENT_CONFIG = (
    "window.FORMEQUA_DEPLOYMENT = Object.freeze({\n"
    "  reviewStorageEnabled: true,\n"
    "  remoteStudiesEnabled: true\n"
    "});\n"
)


def listed_files(name):
    entries = json.loads((ROOT / "deploy" / "release-files.json").read_text(encoding="utf-8"))[name]
    if len(entries) != len(set(entries)):
        raise ValueError("Duplicate release path")
    result = []
    for entry in entries:
        path = ROOT / entry
        if path.is_symlink() or not path.is_file() or any(part in FORBIDDEN_PARTS for part in Path(entry).parts):
            raise ValueError("Missing or unsafe release path: " + entry)
        resolved = path.resolve().relative_to(ROOT)
        if any(part in FORBIDDEN_PARTS for part in resolved.parts) or any(parent.is_symlink() for parent in path.parents if parent != ROOT and ROOT in parent.parents):
            raise ValueError("Unsafe linked release path: " + entry)
        result.append((entry, path))
    return result


def scan(files):
    findings = []
    for name, path in files:
        if path.stat().st_size > 50 * 1024 * 1024:
            raise ValueError("Large file needs separate review: " + name)
        if path.suffix.lower() not in {".py", ".js", ".json", ".geojson", ".html", ".css", ".md", ".txt", ".yml", ".yaml", ".ps1"} and path.name != "Dockerfile":
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for kind, pattern in SECRET_PATTERNS.items():
                for match in pattern.finditer(line):
                    if kind == "Credential in query" and match.group().split("=", 1)[-1] in QUERY_FIXTURES.get(name, set()):
                        continue
                    findings.append({"file": name, "line": number, "kind": kind})
    if findings:
        # Values are deliberately never printed, even on a failed build.
        raise ValueError("Credential-pattern review required: " + json.dumps(findings))


def prepare_output(name):
    path = (ROOT / "dist" / name).resolve()
    expected_parent = (ROOT / "dist").resolve()
    if path.parent != expected_parent or path.name not in {"github", "web"} or (ROOT / "dist").is_symlink() or path.is_symlink():
        raise ValueError("Refusing unsafe output directory")
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)
    return path


def build():
    source, web = listed_files("source"), listed_files("web")
    scan(source)
    names = {name for name, _ in source}
    if not {name for name, _ in web} <= names or "dashboard.html" in {name for name, _ in web}:
        raise ValueError("Web package must be a source subset and exclude the protected dashboard")
    import_path = str(ROOT)
    if import_path not in sys.path:
        sys.path.insert(0, import_path)
    import pilot_security
    for name, _ in web:
        if name not in {"robots.txt", *HOSTING_NOTICE_FILES} and not pilot_security.static_allowed("/" + name):
            raise ValueError("Not permitted for public Hosting: " + name)
    storage_mode = os.environ.get("FORMEQUA_REVIEW_STORAGE", "").strip().lower()
    deployment_config = {"disabled": STATELESS_DEPLOYMENT_CONFIG,
                         "enabled": ARCHIVE_DEPLOYMENT_CONFIG}.get(storage_mode)
    report = {"schemaVersion": 1, "packages": {}}
    for name, files in (("github", source), ("web", web)):
        output = prepare_output(name)
        for relative, path in files:
            target = output / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if deployment_config is not None and relative == "deployment-config.js":
                target.write_text(deployment_config, encoding="utf-8", newline="\n")
            else:
                shutil.copy2(path, target)
        final_files = [(relative, output / relative) for relative, _ in files]
        report["packages"][name] = {"files": len(final_files), "bytes": sum(path.stat().st_size for _, path in final_files),
                                   "manifest": [{"file": relative, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for relative, path in final_files]}
    report_path = ROOT / "dist" / "release-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"github": report["packages"]["github"]["files"], "web": report["packages"]["web"]["files"], "secretPatternFindings": 0}


if __name__ == "__main__":
    argparse.ArgumentParser(description=__doc__).parse_args()
    try:
        print(json.dumps(build()))
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
