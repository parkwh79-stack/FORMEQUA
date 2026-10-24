"""Load local provider settings from outside the HTTP document root.

Environment variables take precedence. Credential values are never returned by
the web API or written to logs, browser assets or project files.
"""
import json
import os
from pathlib import Path

SETTINGS_PATH = Path(__file__).resolve().parent.parent / ".secrets" / "formequa-providers.json"
ALLOWED_KEYS = {"JUSO_API_KEY", "VWORLD_API_KEY", "VWORLD_PRICE_API_KEY", "VWORLD_TWIN_API_KEY", "VWORLD_DOMAIN"}


def load_settings(path=None):
    settings_path = Path(path) if path else SETTINGS_PATH
    if not settings_path.exists():
        return
    try:
        if settings_path.stat().st_size > 16384:
            raise ValueError()
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        if not isinstance(settings, dict) or set(settings) - ALLOWED_KEYS:
            raise ValueError()
        if any(not isinstance(v, str) or len(v) > 1024 or any(ord(c) < 32 for c in v) for v in settings.values()):
            raise ValueError()
    except (OSError, ValueError, UnicodeError):
        raise ValueError("Local public-data provider settings are invalid.") from None
    for key, value in settings.items():
        if not os.environ.get(key):
            os.environ[key] = value
