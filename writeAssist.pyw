# writeAssist.pyw
# Write Assist: small Windows writing assistant. Fill in a Draft to have it
# reviewed (grammar, spelling, typos, punctuation), a Prompt to have a text
# written, or both. Also a context-aware thesaurus and translator (on demand), offline
# speech-to-text, and an English or Spanish interface. It runs an AI's local CLI headless, so it uses your existing
# subscription and needs no API key: Claude (Claude Code), ChatGPT (Codex CLI) or
# GitHub Copilot,
# or a free AI model that runs on this computer (Ollama), set up on first use.
# If the chosen AI hits a usage limit, the request goes to the other one.
# This file is the desktop window (pywebview on Microsoft WebView2, page in
# ui/) and the bridge the page calls; the logic is in waCore.py / waSpeech.py.
#
# Author:  Luis Martinez
# Email:   16788942+luigihmtz@users.noreply.github.com
# Version: v02.05.01
# Date:    2026-11-24
#
# Usage: installed by install.ps1 (Start Menu shortcut + global hotkey, default
#        Win+Ctrl+W, via hotkeyListener.pyw), or run `pythonw writeAssist.pyw`.
#        Needs Python 3.10+ with pywebview, the WebView2 runtime (built into
#        Windows 10/11), and Claude Code and/or GitHub Copilot CLI signed in.
#        Only one window runs at a time: launching again brings it forward.

import base64
import os
import socket
import subprocess
import threading
import time
from pathlib import Path

import webview

import waCore as core
import waSpeech as speech

UI_FILE = core.APP_DIR / "ui" / "index.html"
ICON_FILE = core.APP_DIR / "assets" / "writeAssist.ico"
LISTENER_SCRIPT = core.APP_DIR / "hotkeyListener.pyw"

# Same ID as the Start Menu shortcut install.ps1 creates, so the pinned taskbar
# icon and the running window share one taskbar button.
APP_ID = "LuisMartinez.WriteAssist"
INSTANCE_PORT = 47613   # detects an open window and asks it to come forward
LISTENER_PORT = 47614   # hotkeyListener.pyw control port (hotkey reload)
NEW_CONSOLE = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)


# --------------------------------------------------------------------------- #
# WinForms / WebView2 helpers (pywebview's Windows backend)
# --------------------------------------------------------------------------- #
def on_ui_thread(window, fn):
    """Runs fn(form) on the window's UI thread and returns its result."""
    from System import Action
    form = window.native
    box = {}

    def call():
        try:
            box["value"] = fn(form)
        except Exception as exc:  # re-raised on the caller's thread
            box["error"] = exc
    form.Invoke(Action(call))
    if "error" in box:
        raise box["error"]
    return box.get("value")


def set_window_icon(window):
    import clr
    clr.AddReference("System.Drawing")
    from System.Drawing import Icon
    on_ui_thread(window, lambda form: setattr(form, "Icon", Icon(str(ICON_FILE))))


def tune_webview(window):
    """Lets the page use the microphone and clipboard without prompts, and turns
    the right-click menu (with spelling suggestions) back on."""
    from Microsoft.Web.WebView2.Core import CoreWebView2PermissionKind, CoreWebView2PermissionState
    allowed = {CoreWebView2PermissionKind.Microphone, CoreWebView2PermissionKind.ClipboardRead}

    def on_permission(_sender, args):
        if args.PermissionKind in allowed:
            args.State = CoreWebView2PermissionState.Allow

    def attach(form):
        browser = form.webview.CoreWebView2
        browser.PermissionRequested += on_permission
        browser.Settings.AreDefaultContextMenusEnabled = True
    on_ui_thread(window, attach)


def clipboard_get_text(window):
    from System.Windows.Forms import Clipboard
    return on_ui_thread(window, lambda form: Clipboard.GetText() if Clipboard.ContainsText() else "")


def clipboard_set_text(window, text):
    from System.Windows.Forms import Clipboard
    on_ui_thread(window, lambda form: Clipboard.SetText(text) if text else Clipboard.Clear())


# --------------------------------------------------------------------------- #
# Hotkey listener control
# --------------------------------------------------------------------------- #
def reload_hotkey_listener():
    """Asks the listener to apply the saved hotkey, starting it if needed. Returns (ok, message)."""
    for attempt in range(3):
        try:
            with socket.create_connection(("127.0.0.1", LISTENER_PORT), timeout=4) as conn:
                conn.sendall(b"reload")
                reply = conn.recv(512).decode("utf-8", "replace")
            status, _, message = reply.partition(" ")
            return status == "ok", message
        except OSError:
            if attempt == 0 and LISTENER_SCRIPT.exists():
                subprocess.Popen([core.pythonw_exe(), str(LISTENER_SCRIPT)], cwd=core.APP_DIR)
            time.sleep(1.5)
    return False, "the hotkey listener isn't running"


# --------------------------------------------------------------------------- #
# Bridge: every public method is callable from the page as
# window.pywebview.api.<name>(...) and returns a Promise.
# --------------------------------------------------------------------------- #
def safely(fn):
    """Wraps a bridge call so errors come back as {ok: false, error}."""
    def wrapper(*args, **kwargs):
        try:
            return {"ok": True, **(fn(*args, **kwargs) or {})}
        except Exception as exc:
            return {"ok": False, "error": str(exc) or exc.__class__.__name__}
    wrapper.__name__ = fn.__name__
    return wrapper


class Bridge:
    def __init__(self):
        self._window = None
        self._settings = core.load_settings()
        self._state = core.load_json(core.STATE_FILE, {})
        self._version, self._repo = core.read_release()
        self._thesaurus_cache = {}
        self._translate_cache = {}
        self._transcriber = speech.Transcriber()
        self._speech_install_lock = threading.Lock()
        self._local_setup = {"running": False}   # progress of the local AI download

    # ---- startup ---------------------------------------------------------- #
    @safely
    def init(self):
        providers = []
        for name, p in self._settings["providers"].items():
            providers.append({
                "name": name,
                "type": p.get("type", "claude"),
                "models": p.get("models") or [],
                "default_model": p.get("default_model", ""),
                "installed": core.provider_ready(p),
            })
        user = core.load_user_settings()
        return {
            "app_name": core.APP_NAME,
            "version": self._version,
            "is_dev": core.IS_DEV,
            "providers": providers,
            "default_provider": self._default_provider(),
            "presets": self._settings.get("prompt_presets", []),
            "font_size": self._settings.get("font_size", 11),
            "auto_copy_default": self._settings.get("auto_copy", False),
            "hotkey": self._settings.get("hotkey", ""),
            "ui_language": self._settings.get("ui_language", ""),
            "microphone": self._settings.get("microphone", ""),
            "state": self._state,
            "needs_profile": "profile" not in user,
        }

    @safely
    def save_state(self, state):
        self._state.update(state or {})
        core.save_json(core.STATE_FILE, self._state)

    def _default_provider(self):
        """The AI chosen in settings if it's set up, else the cheapest one that is
        (providers are listed cheapest first), else the first one."""
        providers = self._settings["providers"]
        wanted = self._settings.get("default_provider", "")
        if wanted in providers and core.provider_ready(providers[wanted]):
            return wanted
        for name, p in providers.items():
            if core.provider_ready(p):
                return name
        return next(iter(providers), "")

    # ---- Automatic fallback ----------------------------------------------- #
    def _backup_for(self, provider_name):
        """The cheapest other AI that's set up, for when provider_name hits a usage limit."""
        if not self._settings.get("auto_fallback", True):
            return None
        for name, p in self._settings["providers"].items():
            if name != provider_name and core.provider_ready(p):
                return name, p
        return None

    def _ask_with_fallback(self, request, call):
        """Runs call(name, provider, model) with the chosen AI; if it hits a usage
        limit, runs it again with a backup AI. Returns (result, extra fields)."""
        name = request["provider"]
        provider = self._settings["providers"][name]
        model = (request.get("model") or "").strip() or provider.get("default_model", "")
        try:
            return call(name, provider, model), {"provider": name}
        except core.LimitReached as exc:
            backup = self._backup_for(name)
            if not backup:
                raise RuntimeError(f"{name} hit a usage limit and no other AI is installed to take over.\n\n{exc}")
            backup_name, backup_provider = backup
            result = call(backup_name, backup_provider, backup_provider.get("default_model", ""))
            limit_note = str(exc).strip().splitlines()[0][:120]
            return result, {"provider": backup_name, "fallback_from": name, "limit_note": limit_note}

    # ---- Review / Create -------------------------------------------------- #
    @safely
    def run(self, request):
        task = core.detect_task(request.get("prompt", ""), request.get("draft", ""))
        if not task:
            raise RuntimeError("Paste a draft to review, or write a prompt to create.")
        started = time.time()
        result, extra = self._ask_with_fallback(request, lambda name, provider, model: core.run_text_task(
            name, provider, model, task, request.get("prompt", ""), request.get("draft", ""),
            request.get("mode", "polish"), request.get("tone", "keep"),
            core.load_user_settings().get("profile", ""), self._settings.get("timeout_seconds", 120),
            request.get("language", "")))
        return {"task": task, "elapsed": time.time() - started, **extra, **result}

    # ---- Thesaurus (only when the user asks) ------------------------------ #
    @safely
    def thesaurus(self, request):
        word = (request.get("word") or "").strip()
        if not word:
            raise RuntimeError("Select a word first.")
        context = (request.get("context") or "").strip()
        key = (word.lower(), context, request["provider"], request.get("model", ""))
        if key in self._thesaurus_cache:
            return self._thesaurus_cache[key]
        result, extra = self._ask_with_fallback(request, lambda name, provider, model: core.run_thesaurus(
            name, provider, model, word, context, self._settings.get("timeout_seconds", 120)))
        if "fallback_from" not in extra:  # cache only real answers from the chosen AI
            self._thesaurus_cache[key] = result
        return {**result, **extra}

    # ---- Translate (only when the user asks) ------------------------------ #
    @safely
    def translate(self, request):
        text = (request.get("text") or "").strip()
        if not text:
            raise RuntimeError("Select some text or type it in the box first.")
        target = request.get("target") or "auto"
        context = (request.get("context") or "").strip()
        key = (text, target, context, request["provider"], request.get("model", ""))
        if key in self._translate_cache:
            return self._translate_cache[key]
        result, extra = self._ask_with_fallback(request, lambda name, provider, model: core.run_translate(
            name, provider, model, text, target, context, self._settings.get("timeout_seconds", 120)))
        if "fallback_from" not in extra:
            self._translate_cache[key] = result
        return {**result, **extra}

    # ---- Local AI (free, on this computer) --------------------------------- #
    def _local_provider(self):
        for name, p in self._settings["providers"].items():
            if p.get("type") == "ollama":
                return name, p
        raise RuntimeError("The local AI isn't configured in settings.json.")

    @safely
    def local_info(self, model=""):
        """What setting up the local AI would download, for the warning shown first."""
        name, p = self._local_provider()
        model = model or p.get("default_model", "")
        ollama = bool(core.find_cli("ollama", p.get("path", "")))
        present = core.local_model_present(model)
        model_mb = 0 if present else core.LOCAL_MODEL_MB.get(model, 4000)
        download_mb = model_mb + (0 if ollama else core.OLLAMA_DOWNLOAD_MB)
        disk_mb = model_mb + (0 if ollama else core.OLLAMA_DISK_MB)
        return {"provider": name, "model": model, "ready": ollama and present, "ollama_installed": ollama,
                "download_mb": download_mb, "disk_mb": disk_mb}

    @safely
    def start_local_setup(self, model=""):
        """Installs Ollama if needed and downloads the model, in the background;
        the page follows it with local_progress()."""
        if self._local_setup.get("running"):
            return {}
        name, p = self._local_provider()
        model = model or p.get("default_model", "")
        self._local_setup = {"running": True, "stage": "starting", "done_mb": 0, "total_mb": 0,
                             "model": model, "error": "", "finished": False}

        def work():
            state = self._local_setup
            try:
                cli = core.find_cli("ollama", p.get("path", ""))
                if not cli:
                    state["stage"] = "installing"
                    core.install_ollama()
                    cli = core.find_cli("ollama", p.get("path", ""))
                state["stage"] = "downloading"

                def progress(done_mb, total_mb):
                    state["done_mb"], state["total_mb"] = done_mb, total_mb
                core.pull_local_model(cli, model, progress)
                state["finished"] = True
            except Exception as exc:
                state["error"] = str(exc) or exc.__class__.__name__
            finally:
                state["running"] = False
        threading.Thread(target=work, daemon=True).start()
        return {}

    @safely
    def local_progress(self):
        return dict(self._local_setup)

    # ---- Speech ----------------------------------------------------------- #
    def _speech_model(self):
        return self._settings.get("speech_model", "small")

    @safely
    def speech_info(self):
        model = self._speech_model()
        return {"installed": speech.is_installed(), "model": model,
                "model_cached": speech.model_is_cached(model),
                "download_mb": speech.download_size_mb(model)}

    @safely
    def install_speech(self):
        with self._speech_install_lock:
            if speech.is_installed():
                return {}
            ok, message = speech.install(core.python_exe())
            if not ok:
                raise RuntimeError(f"Couldn't install the speech engine:\n{message}")
        return {}

    @safely
    def transcribe(self, audio_base64, mime):
        audio = base64.b64decode(audio_base64)
        suffix = ".ogg" if "ogg" in (mime or "") else ".webm"
        text = self._transcriber.transcribe(audio, suffix, self._speech_model(),
                                            self._settings.get("speech_language", ""))
        return {"text": text}

    # ---- Clipboard -------------------------------------------------------- #
    @safely
    def clipboard_get(self):
        return {"text": clipboard_get_text(self._window)}

    @safely
    def clipboard_set(self, text):
        clipboard_set_text(self._window, text)

    # ---- Settings --------------------------------------------------------- #
    @safely
    def get_settings(self):
        user = core.load_user_settings()
        return {"profile": user.get("profile", ""), "hotkey": self._settings.get("hotkey", ""),
                "speech_model": self._speech_model(), "speech_language": self._settings.get("speech_language", ""),
                "ui_language": self._settings.get("ui_language", ""),
                "microphone": self._settings.get("microphone", ""),
                "version": self._version, "is_dev": core.IS_DEV}

    @safely
    def save_settings(self, values):
        user = core.load_user_settings()
        user["profile"] = (values.get("profile") or "").strip()
        for key in ("speech_model", "speech_language", "ui_language", "microphone"):
            if key in values:
                user[key] = values[key]
        new_hotkey = (values.get("hotkey") or "").strip()
        hotkey_changed = bool(new_hotkey) and new_hotkey != self._settings.get("hotkey")
        if hotkey_changed:
            user["hotkey"] = new_hotkey
        core.save_user_settings(user)
        self._settings = core.load_settings()
        if not hotkey_changed:
            return {"hotkey_changed": False}
        ok, message = reload_hotkey_listener()
        return {"hotkey_changed": True, "hotkey_ok": ok, "hotkey_message": message}

    @safely
    def skip_profile(self):
        user = core.load_user_settings()
        user.setdefault("profile", "")   # don't ask again on next launch
        core.save_user_settings(user)

    # ---- Updates ---------------------------------------------------------- #
    @safely
    def check_update(self):
        if core.IS_DEV or not self._repo:
            return {"tag": None}
        tag = core.latest_release(self._repo)
        newer = bool(tag) and core.version_tuple(tag) > core.version_tuple(self._version)
        return {"tag": tag if newer else None, "current": self._version}

    @safely
    def start_update(self):
        script = core.download_installer(self._repo)
        # Started from the temp folder: a process whose working folder is the app
        # folder keeps Windows from deleting it, and the update replaces it.
        subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)],
                         cwd=str(script.parent), creationflags=NEW_CONSOLE)
        threading.Timer(0.3, self._window.destroy).start()

    # ---- Window ----------------------------------------------------------- #
    def bring_to_front(self):
        window = self._window
        try:
            window.restore()
            window.show()
            window.on_top = True
            time.sleep(0.2)
            window.on_top = False
            on_ui_thread(window, lambda form: form.Activate())
            window.evaluate_js("window.WA && WA.focusDraft()")
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# Single instance: a second launch (e.g. the hotkey) wakes the open window
# --------------------------------------------------------------------------- #
def claim_instance():
    """Returns a listening socket if this is the first instance, else None."""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
        server.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    try:
        server.bind(("127.0.0.1", INSTANCE_PORT))
    except OSError:
        server.close()
        return None
    server.listen(4)
    return server


def wake_existing_instance():
    """Asks the open window to come forward. Returns True if one answered."""
    try:  # this process was just launched by the user, so it may hand over focus
        import ctypes
        ctypes.windll.user32.AllowSetForegroundWindow(-1)  # ASFW_ANY
    except Exception:
        pass
    try:
        with socket.create_connection(("127.0.0.1", INSTANCE_PORT), timeout=2) as conn:
            conn.sendall(b"show")
        return True
    except OSError:
        return False


def listen_for_wakeups(server, bridge):
    def serve():
        while True:
            try:
                conn, _ = server.accept()
            except OSError:
                return
            with conn:
                if conn.recv(16).startswith(b"show"):
                    threading.Thread(target=bridge.bring_to_front, daemon=True).start()
    threading.Thread(target=serve, daemon=True).start()


def main():
    server = claim_instance()
    if server is None and wake_existing_instance():
        return
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except Exception:
        pass

    bridge = Bridge()
    size = bridge._state.get("window") or {}
    window = webview.create_window(
        core.APP_NAME, str(UI_FILE), js_api=bridge,
        width=size.get("width", 1180), height=size.get("height", 800),
        min_size=(820, 560), text_select=True)
    bridge._window = window

    def on_shown():
        try:
            set_window_icon(window)
        except Exception:
            pass

    tuned = {"done": False}

    def on_loaded():
        if not tuned["done"]:
            try:
                tune_webview(window)
                tuned["done"] = True
            except Exception:
                pass

    def on_closing():
        try:
            bridge._state["window"] = {"width": window.width, "height": window.height}
            core.save_json(core.STATE_FILE, bridge._state)
        except Exception:
            pass

    window.events.shown += on_shown
    window.events.loaded += on_loaded
    window.events.closing += on_closing
    if server is not None:
        listen_for_wakeups(server, bridge)
    webview.start(gui="edgechromium", http_server=True, private_mode=True)


if __name__ == "__main__":
    main()
