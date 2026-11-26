# waPlatform.py
# What differs between Windows and macOS for Write Assist, in one place:
# where its folders are, the clipboard on macOS, the system language, how a
# downloaded installer is started for an update, and the hidden-window flag
# for helper programs. Everything else in the app is shared.
#
# Author:  Luis Martinez
# Email:   16788942+luigihmtz@users.noreply.github.com
# Version: v01.00.00
# Date:    2026-11-25
#
# Usage: imported by writeAssist.pyw, waCore.py, waGrammar.py and waSpeech.py.
#        macOS support is a first pass, not yet tested on a Mac.

import locale
import os
import subprocess
import sys
from pathlib import Path

IS_WINDOWS = os.name == "nt"
IS_MAC = sys.platform == "darwin"
NAME = "windows" if IS_WINDOWS else "mac" if IS_MAC else "other"

# Helper programs (AI command lines, servers) run without a console window on Windows.
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

_MAC_SUPPORT = Path.home() / "Library" / "Application Support"


def user_dir():
    """Per-user settings (user_settings.json, state.json), kept across updates."""
    if IS_WINDOWS:
        return Path(os.environ.get("APPDATA") or Path.home()) / "WriteAssist"
    if IS_MAC:
        return _MAC_SUPPORT / "WriteAssist"
    return Path.home() / ".config" / "WriteAssist"


def data_dir(name):
    """A folder for downloaded tools and caches, e.g. "WriteAssist-LanguageTool"."""
    if IS_WINDOWS:
        return Path(os.environ.get("LOCALAPPDATA") or Path.home()) / name
    if IS_MAC:
        return _MAC_SUPPORT / name
    return Path.home() / ".local" / "share" / name


def in_virtualenv():
    """True when running from a virtual environment (the macOS install uses one)."""
    return sys.prefix != getattr(sys, "base_prefix", sys.prefix)


def system_language():
    """The system's display language, e.g. "en-US"."""
    if IS_WINDOWS:
        import ctypes
        buffer = ctypes.create_unicode_buffer(85)
        lcid = ctypes.windll.kernel32.GetUserDefaultUILanguage()
        ctypes.windll.kernel32.LCIDToLocaleName(lcid, buffer, 85, 0)
        return buffer.value or "en-US"
    if IS_MAC:
        try:
            out = subprocess.run(["defaults", "read", "-g", "AppleLanguages"],
                                 capture_output=True, text=True, timeout=5).stdout
            first = next((part.strip(' "\n') for part in out.strip("()\n ").split(",") if part.strip(' "\n')), "")
            if first:
                return first
        except (OSError, subprocess.SubprocessError):
            pass
    lang = (locale.getlocale()[0] or "en_US").replace("_", "-")
    return lang


# ---------------------------------------------------------------------------
# Clipboard on macOS (Windows uses the window's own clipboard, see writeAssist.pyw)
# ---------------------------------------------------------------------------
_UTF8 = {**os.environ, "LANG": "en_US.UTF-8", "LC_CTYPE": "UTF-8"}   # keeps emojis and accents


def mac_clipboard_get():
    return subprocess.run(["pbpaste"], capture_output=True, env=_UTF8).stdout.decode("utf-8", "replace")


def mac_clipboard_set(text):
    subprocess.run(["pbcopy"], input=(text or "").encode("utf-8"), env=_UTF8, check=True)


# ---------------------------------------------------------------------------
# Updates: run the downloaded installer where the user can see it
# ---------------------------------------------------------------------------
def installer_name():
    return "install.ps1" if IS_WINDOWS else "install.sh"


def launch_installer(script):
    """Starts the downloaded installer in a visible window, from the temp folder
    (Windows won't delete a folder that a running program stands in)."""
    script = Path(script)
    if IS_WINDOWS:
        subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)],
                         cwd=str(script.parent), creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0))
    elif IS_MAC:
        command = f'cd /tmp && bash \\"{script}\\"'
        subprocess.Popen(["osascript", "-e", f'tell application "Terminal" to do script "{command}"',
                          "-e", 'tell application "Terminal" to activate'], cwd=str(script.parent))
    else:
        subprocess.Popen(["bash", str(script)], cwd=str(script.parent))
