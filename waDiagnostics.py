# waDiagnostics.py
# A plain-text report of Write Assist's setup, to paste into a bug report or a
# chat when something goes wrong: version, system, effective settings, which
# AIs are installed (with their versions and models), the free local AI, the
# grammar checker, dictation, history counts and the last few errors. The
# "About you" text is left out; recent errors may quote part of a text.
# Also keeps those recent errors (last_errors.json in the user folder).
#
# Author:  Luis Martinez
# Email:   16788942+luigihmtz@users.noreply.github.com
# Version: v01.00.00
# Date:    2026-11-26
#
# Usage: Write Assist > About > Copy diagnostics, or from a terminal (also when
#        the app won't open):
#          python "%LOCALAPPDATA%\WriteAssist\waDiagnostics.py"   (installed copy)
#          python waDiagnostics.py                                (from the repo)
#        It prints the report, copies it to the clipboard and saves it as
#        diagnostics.txt in the user folder (%APPDATA%\WriteAssist).

import json
import platform as system_info
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waCore as core          # noqa: E402
import waPlatform as platform  # noqa: E402

ERRORS_FILE = core.USER_DIR / "last_errors.json"
REPORT_FILE = core.USER_DIR / "diagnostics.txt"
MAX_ERRORS = 5
# Request fields kept with an error; other text fields are kept as their length only.
SAFE_KEYS = ("provider", "model", "task", "mode", "tone", "language", "target", "format")
# Settings left out of the report (private, or too long to help).
PRIVATE_SETTINGS = {"profile"}
LONG_SETTINGS = {"providers", "prompt_presets", "file", "description", "author", "email", "version", "date"}


def record_error(call, exc, args=()):
    """Keeps the last few errors from the app's calls, with the request's
    options (not its texts)."""
    try:
        context = {}
        for arg in args:
            if not isinstance(arg, dict):
                continue
            for key, value in arg.items():
                if key in SAFE_KEYS:
                    context[key] = value
                elif isinstance(value, str) and value:
                    context[f"{key}_chars"] = len(value)
        entry = {"time": datetime.now().isoformat(timespec="seconds"), "call": call,
                 "error": str(exc) or exc.__class__.__name__, "context": context}
        errors = core.load_json(ERRORS_FILE, [])
        core.save_json(ERRORS_FILE, ([entry] + (errors if isinstance(errors, list) else []))[:MAX_ERRORS])
    except Exception:
        pass   # diagnostics must never break the app


def _cli_version(path):
    try:
        proc = subprocess.run([path, "--version"], capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=10, creationflags=platform.NO_WINDOW)
        return (proc.stdout or proc.stderr).strip().splitlines()[0][:80]
    except Exception as exc:
        return f"(no version: {exc.__class__.__name__})"


def _settings_lines(data, indent="  "):
    lines = []
    for key in sorted(data):
        if key in LONG_SETTINGS:
            continue
        value = data[key]
        if key in PRIVATE_SETTINGS:
            value = f"(left out, {len(str(value))} characters)" if value else "(empty)"
        lines.append(f"{indent}{key}: {json.dumps(value, ensure_ascii=False)}")
    return lines


def report():
    """The whole report as text."""
    out = []
    add = out.append
    version, repo = core.read_release()
    settings = core.load_settings()
    user = core.load_user_settings()
    state = core.load_json(core.STATE_FILE, {})

    add("Write Assist diagnostics")
    add(f"Made: {datetime.now().astimezone().isoformat(timespec='seconds')}")
    add("(Your 'About you' text is left out. Recent errors may quote part of a text.)")
    add("")
    add("== App ==")
    add(f"  version: {version}  ({'development copy' if core.IS_DEV else 'installed'})")
    add(f"  folder: {core.APP_DIR}")
    add(f"  user folder: {core.USER_DIR}")
    add("")
    add("== System ==")
    add(f"  os: {system_info.platform()}")
    add(f"  python: {sys.version.split()[0]} ({sys.executable})")
    try:
        from importlib.metadata import version as package_version
        add(f"  pywebview: {package_version('pywebview')}")
    except Exception as exc:
        add(f"  pywebview: not available ({exc.__class__.__name__})")
    try:
        add(f"  system language: {platform.system_language()}")
    except Exception:
        pass
    add("")
    add("== Settings (effective) ==")
    out.extend(_settings_lines(settings))
    add("")
    add("== Your changes to the defaults (user_settings.json) ==")
    out.extend(_settings_lines(user) or ["  (none)"])
    if user.get("providers"):
        add(f"  providers: {json.dumps(user['providers'], ensure_ascii=False)}")
    add("")
    add("== AIs ==")
    for name, provider in settings.get("providers", {}).items():
        kind = provider.get("type", "claude")
        cli = core.find_cli(kind, provider.get("path", ""))
        add(f"  {name} ({kind}): {'installed' if cli else 'not installed'}")
        if cli:
            add(f"    path: {cli}")
            add(f"    version: {_cli_version(cli)}")
        add(f"    models: {', '.join(provider.get('models') or [])}  (default {provider.get('default_model', '')})")
        if kind == "ollama":
            present = [m for m in provider.get("models") or [] if core.local_model_present(m)]
            add(f"    downloaded: {', '.join(present) or 'none'}")
            add(f"    running: {core.ollama_running()}")
    add(f"  last used: {state.get('provider', '')} / {(state.get('models') or {}).get(state.get('provider', ''), '')}")
    add("")
    add("== Last-used options (state.json) ==")
    for key in sorted(state):
        if key not in ("models",):
            add(f"  {key}: {json.dumps(state[key], ensure_ascii=False)}")
    add("")
    add("== Grammar checker and dictation ==")
    try:
        import waGrammar as grammar
        add(f"  LanguageTool installed: {grammar.is_installed()}")
    except Exception as exc:
        add(f"  LanguageTool: ({exc.__class__.__name__})")
    try:
        import waSpeech as speech
        add(f"  speech engine installed: {speech.is_installed()}")
        model = settings.get("speech_model", "small")
        add(f"  speech model {model} downloaded: {speech.model_is_cached(model)}")
    except Exception as exc:
        add(f"  speech: ({exc.__class__.__name__})")
    add("")
    add("== History ==")
    history = core.load_json(core.USER_DIR / "history.json", {})
    versions = history.get("versions", []) if isinstance(history, dict) else []
    current = [v for v in versions if v.get("group") == history.get("group")]
    add(f"  on: {settings.get('history', True)}  versions: {len(versions)}  (this text: {len(current)})")
    add("")
    add("== Recent errors (newest first) ==")
    errors = core.load_json(ERRORS_FILE, [])
    if not errors:
        add("  (none)")
    for e in errors if isinstance(errors, list) else []:
        add(f"  [{e.get('time')}] {e.get('call')}  {json.dumps(e.get('context', {}), ensure_ascii=False)}")
        for line in str(e.get("error", "")).splitlines() or [""]:
            add(f"    {line}")
    return "\n".join(out)


def copy_to_clipboard(text):
    if platform.IS_WINDOWS:   # clip.exe reads UTF-16 with a BOM
        subprocess.run(["clip"], input=("﻿" + text).encode("utf-16-le"), creationflags=platform.NO_WINDOW, check=True)
    elif platform.IS_MAC:
        subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)


if __name__ == "__main__":
    text = report()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print(text)
    print()
    try:
        REPORT_FILE.parent.mkdir(parents=True, exist_ok=True)
        REPORT_FILE.write_text(text, encoding="utf-8")
        print(f"Saved to {REPORT_FILE}")
    except OSError as exc:
        print(f"Couldn't save the report: {exc}")
    try:
        copy_to_clipboard(text)
        print("Copied to the clipboard: paste it where you were asked.")
    except Exception:
        print("Couldn't copy it: select the text above and copy it.")
