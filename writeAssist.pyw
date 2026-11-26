# writeAssist.pyw
# Write Assist: small writing assistant for Windows (and macOS, first pass). Fill in a Draft to have it
# reviewed (grammar, spelling, typos, punctuation), a Prompt to have a text
# written, or both. Also a context-aware thesaurus and translator (on demand),
# offline speech-to-text, live grammar underlines (LanguageTool, self-hosted),
# and an English, Spanish or French interface. It runs an AI's
# local CLI headless, so it uses your existing subscription and needs no API
# key: Claude (Claude Code), ChatGPT (Codex CLI) or GitHub Copilot, or a free AI
# model that runs on this computer (Ollama), set up on first use.
# If the chosen AI hits a usage limit, the request goes to the other one.
# This file is the desktop window (pywebview on Microsoft WebView2, or WebKit on
# macOS; page in ui/) and the bridge the page calls; the logic is in waCore.py,
# waSpeech.py and waGrammar.py, version history in waHistory.py, exports in
# waExport.py, and platform differences in waPlatform.py.
#
# Author:  Luis Martinez
# Email:   16788942+luigihmtz@users.noreply.github.com
# Version: v02.12.00
# Date:    2026-11-26
#
# Usage: installed by install.ps1 (Start Menu shortcut + global hotkey, default
#        Win+Ctrl+W, via hotkeyListener.pyw), or run `pythonw writeAssist.pyw`.
#        Needs Python 3.10+ with pywebview, the WebView2 runtime (built into
#        Windows 10/11), and Claude Code and/or GitHub Copilot CLI signed in.
#        Only one window runs at a time: launching again brings it forward.
#        macOS: installed by install.sh as ~/Applications/Write Assist.app (no
#        global hotkey yet). macOS support is a first pass, not yet tested.

import base64
import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path

import webview

import waCore as core
import waGrammar as grammar
import waExport as export
import waHistory as history
import waDiagnostics as diagnostics
import waPlatform as platform
import waSpeech as speech

UI_FILE = core.APP_DIR / "ui" / "index.html"
ICON_FILE = core.APP_DIR / "assets" / "writeAssist.ico"
ICON_PNG = core.APP_DIR / "assets" / "writeAssist.png"   # macOS Dock icon
LISTENER_SCRIPT = core.APP_DIR / "hotkeyListener.pyw"

# Same ID as the Start Menu shortcut install.ps1 creates, so the pinned taskbar
# icon and the running window share one taskbar button.
APP_ID = "LuisMartinez.WriteAssist"
INSTANCE_PORT = 47613   # detects an open window and asks it to come forward
LISTENER_PORT = 47614   # hotkeyListener.pyw control port (hotkey reload)


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
    if not platform.IS_WINDOWS:
        return platform.mac_clipboard_get()
    from System.Windows.Forms import Clipboard
    return on_ui_thread(window, lambda form: Clipboard.GetText() if Clipboard.ContainsText() else "")


def set_mac_dock_icon():
    """Shows Write Assist's icon in the Dock (otherwise it's Python's)."""
    from AppKit import NSApplication, NSImage
    image = NSImage.alloc().initWithContentsOfFile_(str(ICON_PNG))
    if image is not None:
        NSApplication.sharedApplication().setApplicationIconImage_(image)


def cf_html(fragment):
    """Windows' "HTML Format" clipboard data: a header with byte offsets, then
    the fragment between StartFragment/EndFragment markers (UTF-8)."""
    header = "Version:0.9\r\nStartHTML:{:010d}\r\nEndHTML:{:010d}\r\nStartFragment:{:010d}\r\nEndFragment:{:010d}\r\n"
    before = "<html><body>\r\n<!--StartFragment-->"
    after = "<!--EndFragment-->\r\n</body></html>"
    start_html = len(header.format(0, 0, 0, 0).encode("utf-8"))
    start_fragment = start_html + len(before.encode("utf-8"))
    end_fragment = start_fragment + len(fragment.encode("utf-8"))
    end_html = end_fragment + len(after.encode("utf-8"))
    return (header.format(start_html, end_html, start_fragment, end_fragment) + before + fragment + after).encode("utf-8")


def clipboard_set_text(window, text, html=None):
    """Plain text, plus the formatted version (html) when there is one: Teams,
    Outlook and Word paste the formatting, plain-text apps the text."""
    if not platform.IS_WINDOWS:
        platform.mac_clipboard_set(text, html)
        return
    from System import Array, Byte
    from System.IO import MemoryStream
    from System.Windows.Forms import Clipboard, DataFormats, DataObject

    def put(form):
        if not text:
            Clipboard.Clear()
            return
        if not html:
            Clipboard.SetText(text)
            return
        data = DataObject()
        data.SetData(DataFormats.UnicodeText, text)
        # As exact UTF-8 bytes: .NET's own string conversion can garble accents and emojis.
        data.SetData(DataFormats.Html, MemoryStream(Array[Byte](cf_html(html))))
        Clipboard.SetDataObject(data, True)
    on_ui_thread(window, put)


# --------------------------------------------------------------------------- #
# Hotkey listener control
# --------------------------------------------------------------------------- #
def reload_hotkey_listener():
    """Asks the listener to apply the saved hotkey, starting it if needed. Returns (ok, message)."""
    if not platform.IS_WINDOWS:
        return False, "the global hotkey isn't available on this system yet"
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
            diagnostics.record_error(fn.__name__, exc, args[1:])   # for About > Copy diagnostics
            return {"ok": False, "error": str(exc) or exc.__class__.__name__}
    wrapper.__name__ = fn.__name__
    return wrapper


AUTOSAVE_FILE = core.USER_DIR / "autosave.json"   # the work in progress, reopened at the next start
# Interface language -> the language the AI explains its changes and notes in.
EXPLAIN_LANGUAGES = {"en": "English", "es": "Spanish", "fr": "French"}


class Bridge:
    def __init__(self):
        self._window = None
        self._settings = core.load_settings()
        self._state = core.load_json(core.STATE_FILE, {})
        self._version, self._repo = core.read_release()
        self._thesaurus_cache = {}
        self._translate_cache = {}
        self._transcriber = speech.Transcriber()
        self._history = history.History(core.USER_DIR / "history.json")
        self._grammar = grammar.Checker()
        self._grammar_setup = {"running": False}   # progress of the grammar checker download
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
            "platform": platform.NAME,
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
            "check_mode": self._check_mode(),
            "on_close": self.on_close_mode(),
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
            request.get("language", ""), EXPLAIN_LANGUAGES.get(request.get("ui_language", ""), "")))
        self._remember(task, request, extra, result)
        return {"task": task, "elapsed": time.time() - started, **extra, **result}

    def _remember(self, task, request, extra, result):
        """History: the draft that was reviewed (if any) and the result, with the
        AI's changes, notes and highlights (they can't be rebuilt later)."""
        result_text = result["text"]
        if not self._settings.get("history", True):
            return
        provider = extra.get("provider", request.get("provider", ""))
        details = {
            "task": task, "prompt": (request.get("prompt") or "").strip(),
            "mode": request.get("mode", "") if task == "review" else "", "tone": request.get("tone", ""),
            "provider": provider,
            "model": (request.get("model") or "").strip() if provider == request.get("provider") else "",
        }
        chosen = request.get("language", "")
        draft = request.get("draft", "")
        if task == "review":
            self._history.add(draft, "draft", **details,
                              language=chosen if chosen not in ("", "auto") else core.detect_language(draft))
        self._history.add(result_text, "result", **details,
                          language=chosen if chosen not in ("", "auto") else core.detect_language(result_text),
                          changes=result.get("changes"), notes=result.get("notes"), spans=result.get("spans"))

    # ---- Version history -------------------------------------------------- #
    @safely
    def history_list(self):
        return {**self._history.list(), "enabled": bool(self._settings.get("history", True))}

    @safely
    def history_save(self, text, label="", rich=None):
        version = self._history.add(text, "saved", label, language=core.detect_language(text), rich=rich)
        return {"version": version}

    @safely
    def history_delete(self, version_id):
        self._history.delete(version_id)

    @safely
    def history_clear(self):
        self._history.clear()

    @safely
    def history_new_group(self):
        return {"group": self._history.new_group()}

    @safely
    def history_compare(self, old, new):
        return {"parts": history.compare(old, new)}

    # ---- Sessions (.wasession) ---------------------------------------------- #
    SESSION_FORMAT = "write-assist-session"

    @safely
    def session_save(self, data):
        """Saves the page's texts and options plus this text's versions to a
        .wasession file the user picks."""
        from datetime import datetime
        name = export.suggested_name(data.get("draft") or data.get("result_text") or "Write Assist", "wasession")
        save = getattr(getattr(webview, "FileDialog", None), "SAVE", None) or webview.SAVE_DIALOG
        chosen = self._window.create_file_dialog(save, save_filename=name,
                                                 file_types=("Write Assist session (*.wasession)",))
        if not chosen:
            return {"cancelled": True}
        path = Path(chosen[0] if isinstance(chosen, (list, tuple)) else chosen)
        if path.suffix.lower() != ".wasession":
            path = path.with_name(path.name + ".wasession")
        session = {"format": self.SESSION_FORMAT, "format_version": 1, "app_version": self._version,
                   "saved": datetime.now().astimezone().isoformat(timespec="seconds"),
                   **data, "history": self._history.current_group()}
        path.write_text(json.dumps(session, ensure_ascii=False, indent=1), encoding="utf-8")
        return {"path": str(path), "folder": str(path.parent)}

    @safely
    def session_open(self):
        open_dialog = getattr(getattr(webview, "FileDialog", None), "OPEN", None) or webview.OPEN_DIALOG
        chosen = self._window.create_file_dialog(open_dialog, file_types=("Write Assist session (*.wasession)",))
        if not chosen:
            return {"cancelled": True}
        return self._read_session(chosen[0] if isinstance(chosen, (list, tuple)) else chosen)

    def _read_session(self, path):
        """Reads a session file and adds its versions to History (as a new text)."""
        path = Path(path)
        try:
            session = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            session = None
        if not isinstance(session, dict) or session.get("format") != self.SESSION_FORMAT:
            raise RuntimeError(f"{path.name} isn't a Write Assist session file.")
        if self._settings.get("history", True):
            self._history.import_versions(session.get("history"))
        return {"session": session, "name": path.name}

    @safely
    def startup_session(self):
        """A session file Write Assist was opened with (double-click), if any."""
        path, self._startup_path = getattr(self, "_startup_path", None), None
        return self._read_session(path) if path else {"session": None}

    def open_session_file(self, path):
        """A session double-clicked while the window was already open."""
        try:
            data = self._read_session(path)
            self._window.evaluate_js(f"window.WA && WA.applySession({json.dumps(data)})")
        except Exception as exc:
            self._window.evaluate_js(f"window.WA && WA.showError({json.dumps(str(exc))})")

    @safely
    def diagnostics(self):
        """The setup report for a bug report (waDiagnostics.py)."""
        return {"text": diagnostics.report()}

    @safely
    def open_url(self, url):
        if str(url).startswith(("https://", "http://")):
            import webbrowser
            webbrowser.open(url)

    # ---- Export ----------------------------------------------------------- #
    def _author(self):
        return (self._settings.get("author_name") or "").strip() or export.account_name()

    @safely
    def export_targets(self):
        return {"clouds": export.cloud_folders(), "pdf": platform.IS_WINDOWS, "author": self._author()}

    @safely
    def export_file(self, request):
        """Saves text as request["format"] (docx, pdf, txt, md) to a file the user
        picks ("dialog") or to a synced cloud folder (its key), in a "Write Assist"
        subfolder. request["details"] is the side-text: [[label, value], ...]."""
        from datetime import datetime
        text, fmt = request.get("text") or "", request.get("format", "docx")
        if not text.strip():
            raise RuntimeError("There's no text to export.")
        if fmt not in export.FORMATS or (fmt == "pdf" and not platform.IS_WINDOWS):
            raise RuntimeError(f"Unsupported format: {fmt}")
        when = datetime.fromisoformat(request["when"]) if request.get("when") else datetime.now()
        when = when if when.tzinfo else when.astimezone()
        name = export.suggested_name(text, fmt, when)
        target = request.get("target", "dialog")
        if target == "dialog":
            save = getattr(getattr(webview, "FileDialog", None), "SAVE", None) or webview.SAVE_DIALOG
            chosen = self._window.create_file_dialog(save, save_filename=name,
                                                     file_types=(f"{export.FORMATS[fmt]} (*.{fmt})",))
            if not chosen:
                return {"cancelled": True}
            path = Path(chosen[0] if isinstance(chosen, (list, tuple)) else chosen)
            if path.suffix.lower() != f".{fmt}":
                path = path.with_name(path.name + f".{fmt}")
        else:
            cloud = next((c for c in export.cloud_folders() if c["key"] == target), None)
            if not cloud:
                raise RuntimeError("That cloud folder isn't available on this computer anymore.")
            folder = Path(cloud["path"]) / "Write Assist"
            path = folder / name
            counter = 2
            while path.exists():
                path = folder / f"{Path(name).stem} ({counter}).{fmt}"
                counter += 1
        if fmt == "pdf":
            path.parent.mkdir(parents=True, exist_ok=True)
            self._print_pdf(path)   # the page has filled its print area
        else:
            export.write(path, fmt, text, export.title_of(text), self._author(), when, request.get("details") or [],
                         rich=request.get("rich"))
        return {"path": str(path), "folder": str(path.parent)}

    def _print_pdf(self, path):
        """PDF through WebView2's print-to-PDF: the page shows only its print area
        when printing, so the PDF looks like the app's text, emojis included."""
        def start(form):
            browser = form.webview.CoreWebView2
            settings = browser.Environment.CreatePrintSettings()
            settings.ShouldPrintHeaderAndFooter = False
            settings.ShouldPrintBackgrounds = False
            return browser.PrintToPdfAsync(str(path), settings)
        task = on_ui_thread(self._window, start)
        for _ in range(600):   # up to a minute
            if task.IsCompleted:
                break
            time.sleep(0.1)
        if not task.IsCompleted or task.IsFaulted or not task.Result:
            raise RuntimeError("The PDF couldn't be created.")

    @safely
    def open_folder(self, folder):
        if platform.IS_WINDOWS:
            os.startfile(folder)
        else:
            subprocess.Popen(["open" if platform.IS_MAC else "xdg-open", folder])

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

    # ---- Live grammar (LanguageTool on this computer) ---------------------- #
    @safely
    def grammar_info(self):
        return {"installed": grammar.is_installed(), "download_mb": grammar.DOWNLOAD_MB, "disk_mb": grammar.DISK_MB}

    @safely
    def start_grammar_setup(self):
        """Downloads the checker in the background; the page follows grammar_progress()."""
        if self._grammar_setup.get("running"):
            return {}
        self._grammar_setup = {"running": True, "done_mb": 0, "total_mb": grammar.DOWNLOAD_MB, "error": ""}

        def work():
            state = self._grammar_setup
            try:
                def progress(done_mb, total_mb):
                    state["done_mb"], state["total_mb"] = done_mb, total_mb
                grammar.install(progress)
            except Exception as exc:
                state["error"] = str(exc) or exc.__class__.__name__
            finally:
                state["running"] = False
        threading.Thread(target=work, daemon=True).start()
        return {}

    @safely
    def grammar_progress(self):
        return dict(self._grammar_setup)

    @safely
    def grammar_check(self, text, language="auto"):
        return self._grammar.check(text, language, core.load_user_settings().get("profile", ""))

    _CHECK_MODES = ("off", "spelling", "grammar")

    def _check_mode(self):
        """How Prompt and Draft are underlined: "off", "spelling" (the built-in
        spellchecker) or "grammar" (LanguageTool, once it's downloaded)."""
        mode = self._settings.get("check_mode")
        if mode not in self._CHECK_MODES:   # before v02.08.01 it was a live_grammar on/off switch
            mode = "grammar" if self._settings.get("live_grammar") else "spelling"
        if mode == "grammar" and not grammar.is_installed():
            mode = "spelling"
        return mode

    @safely
    def set_check_mode(self, mode):
        if mode not in self._CHECK_MODES:
            raise RuntimeError(f"Unknown check mode: {mode}")
        user = core.load_user_settings()
        user["check_mode"] = mode
        user.pop("live_grammar", None)
        core.save_user_settings(user)
        self._settings = core.load_settings()

    def stop_grammar(self):
        self._grammar.stop()

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
    def clipboard_set(self, text, html=None):
        clipboard_set_text(self._window, text, html)

    # ---- Settings --------------------------------------------------------- #
    @safely
    def get_settings(self):
        user = core.load_user_settings()
        return {"profile": user.get("profile", ""), "hotkey": self._settings.get("hotkey", ""),
                "speech_model": self._speech_model(), "speech_language": self._settings.get("speech_language", ""),
                "ui_language": self._settings.get("ui_language", ""),
                "microphone": self._settings.get("microphone", ""),
                "check_mode": self._check_mode(),
                "history": bool(self._settings.get("history", True)),
                "on_close": self.on_close_mode(),
                "author_name": self._settings.get("author_name", ""), "author_default": export.account_name(),
                "version": self._version, "is_dev": core.IS_DEV}

    @safely
    def save_settings(self, values):
        user = core.load_user_settings()
        user["profile"] = (values.get("profile") or "").strip()
        for key in ("speech_model", "speech_language", "ui_language", "microphone", "check_mode",
                    "history", "author_name", "on_close"):
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
        platform.launch_installer(script)   # in a visible window (Terminal on macOS), from the temp folder
        self._close_ok = True                 # the page already asked about unsaved work
        threading.Timer(0.3, self._window.destroy).start()

    # ---- Closing: keep the work for next time (like VS Code), or ask ------- #
    def on_close_mode(self):
        """"keep" (the default: the work comes back next time), "ask" (offer to
        save a session file) or "nothing"."""
        mode = self._settings.get("on_close", "keep")
        return mode if mode in ("keep", "ask", "nothing") else "keep"

    @safely
    def autosave(self, data):
        """The page's current work, saved as it changes; reopened at the next start."""
        if self.on_close_mode() == "keep" and data:
            core.save_json(AUTOSAVE_FILE, data)
        else:
            AUTOSAVE_FILE.unlink(missing_ok=True)

    @safely
    def autosave_load(self):
        if self.on_close_mode() != "keep":
            return {"session": None}
        return {"session": core.load_json(AUTOSAVE_FILE, None)}

    @safely
    def set_unsaved(self, unsaved):
        """The page says whether it has work that isn't in a saved session."""
        self._unsaved = bool(unsaved)

    @safely
    def quit(self):
        """Closes after the page asked (saved or not)."""
        self._close_ok = True
        threading.Timer(0.1, self._window.destroy).start()

    # ---- Window ----------------------------------------------------------- #
    def bring_to_front(self):
        window = self._window
        try:
            window.restore()
            window.show()
            window.on_top = True
            time.sleep(0.2)
            window.on_top = False
            if platform.IS_WINDOWS:
                on_ui_thread(window, lambda form: form.Activate())
            elif platform.IS_MAC:
                from AppKit import NSApplication
                NSApplication.sharedApplication().activateIgnoringOtherApps_(True)
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


def wake_existing_instance(session_path=None):
    """Asks the open window to come forward (and open session_path, if given).
    Returns True if one answered."""
    try:  # this process was just launched by the user, so it may hand over focus
        import ctypes
        ctypes.windll.user32.AllowSetForegroundWindow(-1)  # ASFW_ANY
    except Exception:
        pass
    try:
        with socket.create_connection(("127.0.0.1", INSTANCE_PORT), timeout=2) as conn:
            conn.sendall(f"open {session_path}".encode("utf-8") if session_path else b"show")
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
                message = conn.recv(4096)
                if message.startswith(b"show"):
                    threading.Thread(target=bridge.bring_to_front, daemon=True).start()
                elif message.startswith(b"open "):
                    path = message[5:].decode("utf-8", "replace")

                    def open_it(path=path):
                        bridge.bring_to_front()
                        bridge.open_session_file(path)
                    threading.Thread(target=open_it, daemon=True).start()
    threading.Thread(target=serve, daemon=True).start()


# The window's browser data (WebView2 user data folder). Private mode keeps
# nothing between runs and pywebview deletes the folder when the window closes;
# it's a fixed folder only so its settings can be written before it opens.
WEBVIEW_DIR = platform.data_dir("WriteAssist-WebView")


def prepare_webview_profile():
    """The built-in spellchecker (Underline: spelling) uses only Windows'
    display language by default, so correct Spanish words looked misspelled.
    Its languages are a browser setting, written here before the window opens:
    English (US), Spanish (Mexico), French (France) and Windows' own language.
    Windows supplies the dictionaries (French only when French is added in
    Windows' language settings); a language it has none for is skipped, without
    affecting the others. (Chromium's own .bdic dictionary files are ignored.)"""
    languages = list(dict.fromkeys([platform.system_language(), "en-US", "es-MX", "fr-FR"]))
    core.save_json(WEBVIEW_DIR / "EBWebView" / "Default" / "Preferences",
                   {"spellcheck": {"dictionaries": languages, "use_spelling_service": False}})


def _destroy(window):
    try:
        window.destroy()
    except Exception:
        pass   # already closed


def main():
    import sys
    # Opened with a .wasession file (double-click): an open window gets it,
    # otherwise this window opens it once the page is ready.
    session_path = next((arg for arg in sys.argv[1:] if arg.lower().endswith(".wasession")), None)
    server = claim_instance()
    if server is None and wake_existing_instance(session_path):
        return
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except Exception:
        pass

    bridge = Bridge()
    bridge._startup_path = session_path
    size = bridge._state.get("window") or {}
    window = webview.create_window(
        core.APP_NAME, str(UI_FILE), js_api=bridge,
        width=size.get("width", 1180), height=size.get("height", 800),
        min_size=(820, 560), text_select=True)
    bridge._window = window

    def on_shown():
        try:
            if platform.IS_WINDOWS:
                set_window_icon(window)
            elif platform.IS_MAC:
                set_mac_dock_icon()
        except Exception:
            pass

    tuned = {"done": False}

    def on_loaded():
        if platform.IS_WINDOWS and not tuned["done"]:
            try:
                tune_webview(window)
                tuned["done"] = True
            except Exception:
                pass

    def on_closing():
        mode = bridge.on_close_mode()
        if not getattr(bridge, "_close_ok", False) and mode == "keep":
            # Hold the close until the page has saved the latest work, then close.
            bridge._close_ok = True

            def flush_then_close():
                threading.Timer(5, lambda: _destroy(window)).start()   # if the page doesn't answer
                try:
                    window.evaluate_js("window.WA ? WA.flushAutosave() : null")
                finally:
                    _destroy(window)
            threading.Thread(target=flush_then_close, daemon=True).start()
            return False
        if getattr(bridge, "_unsaved", False) and not getattr(bridge, "_close_ok", False) and mode == "ask":
            # Unsaved work: cancel this close and let the page ask (Save / Don't
            # save / Cancel); it calls quit() when the user has chosen.
            threading.Thread(target=lambda: window.evaluate_js("window.WA && WA.confirmQuit()"), daemon=True).start()
            return False
        try:
            bridge._state["window"] = {"width": window.width, "height": window.height}
            core.save_json(core.STATE_FILE, bridge._state)
        except Exception:
            pass
        bridge.stop_grammar()   # the grammar server's memory goes with the app

    window.events.shown += on_shown
    window.events.loaded += on_loaded
    window.events.closing += on_closing
    if server is not None:
        listen_for_wakeups(server, bridge)
    if platform.IS_WINDOWS:
        prepare_webview_profile()
        webview.start(gui="edgechromium", http_server=True, private_mode=True, storage_path=str(WEBVIEW_DIR))
    else:
        # macOS: WebKit, with the system's own spellchecker and languages.
        webview.start(gui="cocoa" if platform.IS_MAC else None, http_server=True, private_mode=True)


if __name__ == "__main__":
    main()
