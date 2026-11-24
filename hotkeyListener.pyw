# hotkeyListener.pyw
# Tiny background process that registers a global hotkey (default Win+Ctrl+W)
# and opens Write Assist when it's pressed, or brings the open window to the
# front. Needed because shortcut (.lnk) hotkeys can't use the Win key.
#
# Author:  Luis Martinez
# Email:   luis@luigi.mx
# Version: v01.02.00
# Date:    2026-11-24
#
# Usage: started at login by the Startup shortcut that install.ps1 creates (or
#        run `pythonw hotkeyListener.pyw`). The hotkey comes from "hotkey" in
#        %APPDATA%\WriteAssist\user_settings.json, falling back to
#        settings.json; e.g. "Win+Ctrl+W", "Ctrl+Alt+F9". The app's Settings
#        window changes it and tells this listener to reload (local port
#        47614, command "reload"; the reply is "ok <hotkey>" or "error <why>").
#        Only one listener runs per user session.

import ctypes
import json
import os
import socket
import subprocess
import sys
import threading
from ctypes import wintypes
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
APP_SCRIPT = APP_DIR / "writeAssist.pyw"
SETTINGS_FILE = APP_DIR / "settings.json"
USER_SETTINGS_FILE = Path(os.environ.get("APPDATA") or Path.home()) / "WriteAssist" / "user_settings.json"
APP_PORT = 47613               # must match INSTANCE_PORT in writeAssist.pyw
CONTROL_PORT = 47614           # must match LISTENER_PORT in writeAssist.pyw
DEFAULT_HOTKEY = "Win+Ctrl+W"
HOTKEY_ID = 1

MODIFIERS = {"alt": 0x1, "ctrl": 0x2, "control": 0x2, "shift": 0x4, "win": 0x8}
MOD_NOREPEAT = 0x4000
WM_HOTKEY = 0x0312
WM_APP_RELOAD = 0x8001         # WM_APP + 1
PM_NOREMOVE = 0
ERROR_ALREADY_EXISTS = 183

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)


def parse_hotkey(text):
    """'Win+Ctrl+W' -> (modifier flags, virtual-key code)."""
    mods, key = 0, None
    for part in (p.strip().lower() for p in text.split("+")):
        if part in MODIFIERS:
            mods |= MODIFIERS[part]
        elif len(part) == 1 and part.isalnum():
            key = ord(part.upper())
        elif part.startswith("f") and part[1:].isdigit() and 1 <= int(part[1:]) <= 24:
            key = 0x70 + int(part[1:]) - 1
        elif part == "space":
            key = 0x20
        else:
            raise ValueError(f"Unknown key '{part}' in '{text}'")
    if key is None or not mods:
        raise ValueError(f"'{text}' needs at least one modifier (Win, Ctrl, Alt, Shift) and one key")
    return mods, key


def read_hotkey():
    for path in (USER_SETTINGS_FILE, SETTINGS_FILE):
        try:
            value = json.loads(path.read_text(encoding="utf-8")).get("hotkey")
        except (OSError, ValueError):
            continue
        if value:
            return value
    return DEFAULT_HOTKEY


def register_hotkey():
    """(Re)registers the configured hotkey on this thread. Returns (ok, message)."""
    user32.UnregisterHotKey(None, HOTKEY_ID)
    hotkey = read_hotkey()
    try:
        mods, key = parse_hotkey(hotkey)
    except ValueError as exc:
        return False, str(exc)
    if not user32.RegisterHotKey(None, HOTKEY_ID, mods | MOD_NOREPEAT, key):
        return False, f"{hotkey} is already used by Windows or another app"
    return True, hotkey


def show_error(message):
    user32.MessageBoxW(None, message, "Write Assist hotkey", 0x10)  # MB_ICONERROR


def open_or_wake_app():
    # The hotkey gives this process the right to set the foreground window;
    # pass it on to the app so its window can come to the front.
    user32.AllowSetForegroundWindow(-1)  # ASFW_ANY
    try:
        with socket.create_connection(("127.0.0.1", APP_PORT), timeout=1) as conn:
            conn.sendall(b"show")
        return
    except OSError:
        pass  # not running yet
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    exe = str(pythonw if pythonw.exists() else sys.executable)
    subprocess.Popen([exe, str(APP_SCRIPT)], cwd=APP_DIR)


class Control:
    """Local socket the app uses to ask for a hotkey reload."""

    def __init__(self, thread_id):
        self.thread_id = thread_id
        self.done = threading.Event()
        self.result = (False, "")

    def serve(self, server):
        while True:
            try:
                conn, _ = server.accept()
            except OSError:
                return
            with conn:
                if not conn.recv(32).startswith(b"reload"):
                    continue
                self.done.clear()
                user32.PostThreadMessageW(self.thread_id, WM_APP_RELOAD, 0, 0)
                if self.done.wait(3):
                    ok, message = self.result
                    reply = f"{'ok' if ok else 'error'} {message}"
                else:
                    reply = "error The hotkey listener didn't respond"
                conn.sendall(reply.encode("utf-8"))


def main():
    # One listener per user session.
    kernel32.CreateMutexW(None, False, "Local\\LuisMartinez.WriteAssist.Hotkey")
    if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
        return

    msg = wintypes.MSG()
    # Create this thread's message queue before anyone can post to it.
    user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, PM_NOREMOVE)
    control = Control(kernel32.GetCurrentThreadId())
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        server.bind(("127.0.0.1", CONTROL_PORT))
        server.listen(4)
        threading.Thread(target=control.serve, args=(server,), daemon=True).start()
    except OSError:
        pass  # reload from the app won't work, the hotkey still does

    ok, message = register_hotkey()
    if not ok:
        # Keep running so a new hotkey picked in Settings can still be applied.
        show_error(f"Couldn't set the Write Assist hotkey:\n{message}.\n\n"
                   "Pick another one in Write Assist > Settings.")

    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        if msg.message == WM_HOTKEY:
            try:
                open_or_wake_app()
            except Exception as exc:
                show_error(f"Couldn't open Write Assist:\n{exc}")
        elif msg.message == WM_APP_RELOAD:
            control.result = register_hotkey()
            control.done.set()
    user32.UnregisterHotKey(None, HOTKEY_ID)


if __name__ == "__main__":
    main()
