# writeAssist.pyw
# Small desktop writing assistant with two tasks, picked from what you fill in:
#   - Review: paste a Draft and get it proofread (grammar, spelling, typos,
#     punctuation). An optional Prompt adds context or extra instructions.
#   - Create: fill in only the Prompt and get the text written from scratch.
# It runs an AI's local CLI headless, so it uses your existing subscription
# and needs no API key:
#   - Claude, through Claude Code (`claude -p`)
#   - GitHub Copilot, through GitHub Copilot CLI (`copilot -s`)
# Checks GitHub for new releases and updates itself through install.ps1.
#
# Author:  Luis Martinez
# Email:   luis@luigi.mx
# Version: v01.05.00
# Date:    2026-11-24
#
# Usage: installed by install.ps1, which adds a Start Menu shortcut and a
#        global hotkey (Win+Ctrl+W by default, via hotkeyListener.pyw). Or run
#        `pythonw writeAssist.pyw`. Only one window runs at a time: launching
#        again brings the open window to the front.
#        Requires Python 3.10+ with tkinter, plus at least one CLI installed
#        and logged in (Claude Code and/or GitHub Copilot CLI).
#        Per-user settings (About you, hotkey, overrides of settings.json) live
#        in %APPDATA%\WriteAssist\user_settings.json. Product version and
#        GitHub repo come from release.json.
#        Ctrl+Enter = run, Ctrl+Shift+V = paste clipboard as draft and review,
#        Ctrl+Shift+C = copy the result.

import difflib
import json
import os
import queue
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.request
from pathlib import Path
from tkinter import font as tkfont
from tkinter import messagebox, ttk

APP_NAME = "Write Assist"

APP_DIR = Path(__file__).resolve().parent
SETTINGS_FILE = APP_DIR / "settings.json"          # shipped defaults
PROMPT_FILE = APP_DIR / "system_prompt.md"
RELEASE_FILE = APP_DIR / "release.json"            # product version + GitHub repo
ICON_FILE = APP_DIR / "assets" / "writeAssist.ico"
LISTENER_SCRIPT = APP_DIR / "hotkeyListener.pyw"
IS_DEV = (APP_DIR / ".git").exists()              # running from the repo: no self-updates

USER_DIR = Path(os.environ.get("APPDATA") or Path.home()) / "WriteAssist"
USER_SETTINGS_FILE = USER_DIR / "user_settings.json"  # per-user, survives updates
STATE_FILE = USER_DIR / "state.json"                   # last-used options, window size

# Same ID as the Start Menu shortcut install.ps1 creates, so the pinned taskbar
# icon and the running window share one taskbar button.
APP_ID = "LuisMartinez.WriteAssist"
INSTANCE_PORT = 47613   # detects an open window and asks it to come forward
LISTENER_PORT = 47614   # hotkeyListener.pyw control port (hotkey reload)

MODES = ["fix", "polish"]
TONES = ["keep", "more formal", "more casual", "friendlier", "more concise"]
PROFILE_EXAMPLE = ("e.g. Native Spanish speaker from Mexico. I mostly write in English "
                   "for work (emails, Teams) and sometimes in Spanish. My name is ...")

DEFAULT_PROVIDERS = {
    "Claude": {"type": "claude", "models": ["opus", "sonnet", "haiku"],
               "default_model": "opus", "effort": "low"},
    "GitHub Copilot": {"type": "copilot", "models": ["auto"], "default_model": "auto", "effort": ""},
}

# Claude Code tools the assistant never needs; denied so pasted text can't make it act.
CLAUDE_DENIED_TOOLS = "Bash PowerShell Read Edit Write NotebookEdit Glob Grep WebFetch WebSearch Agent Skill"

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "original": {"type": "string"},
                    "fixed": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["original", "fixed", "reason"],
            },
        },
        "notes": {"type": "string"},
    },
    "required": ["text", "changes", "notes"],
}

# Providers without a schema option get the format spelled out in the prompt.
JSON_INSTRUCTIONS = """
Reply with ONLY a JSON object, no code fences and no other text, in exactly this shape:
{"text": "<full corrected or new text>",
 "changes": [{"original": "<exact original snippet>", "fixed": "<replacement>", "reason": "<short reason>"}],
 "notes": "<optional note, or empty string>"}
Escape quotes and line breaks inside strings as JSON requires.
""".strip()

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
NEW_CONSOLE = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)


# --------------------------------------------------------------------------- #
# Settings, version, updates
# --------------------------------------------------------------------------- #
def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def load_settings():
    """Shipped settings.json with the user's user_settings.json on top."""
    base = load_json(SETTINGS_FILE, {})
    user = load_json(USER_SETTINGS_FILE, {})
    merged = {**base, **{k: v for k, v in user.items() if k != "providers"}}
    providers = {name: dict(p) for name, p in (base.get("providers") or DEFAULT_PROVIDERS).items()}
    for name, overrides in (user.get("providers") or {}).items():
        providers.setdefault(name, {}).update(overrides)
    merged["providers"] = providers
    return merged


def load_system_prompt(profile):
    text = PROMPT_FILE.read_text(encoding="utf-8")
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S).strip()
    return text.replace("{{profile}}", profile.strip() or "Not given.")


def read_release():
    """(version, repo) from release.json."""
    data = load_json(RELEASE_FILE, {})
    return data.get("version", "v00.00.00"), data.get("repo", "")


def version_tuple(version):
    return tuple(int(n) for n in re.findall(r"\d+", version)[:3])


def latest_release(repo):
    """Tag of the repo's latest GitHub release."""
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/releases/latest",
        headers={"Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.load(response).get("tag_name")


def find_cli(kind, configured=""):
    """Path to the provider's CLI, or None if it isn't installed."""
    if configured and Path(configured).exists():
        return configured
    local = Path(os.environ.get("LOCALAPPDATA", ""))
    if kind == "claude":
        candidates = [shutil.which("claude"), Path.home() / ".local" / "bin" / "claude.exe"]
    else:
        # The winget/MSI install comes first: VS Code's `copilot` launcher on
        # PATH only works when the real CLI is installed anyway.
        candidates = [local / "GitHubCopilotCLI" / "copilot.exe", shutil.which("copilot")]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return str(candidate)
    return None


def pythonw_exe():
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    return str(pythonw if pythonw.exists() else sys.executable)


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
                subprocess.Popen([pythonw_exe(), str(LISTENER_SCRIPT)], cwd=APP_DIR)
            time.sleep(1.5)
    return False, "the hotkey listener isn't running"


# --------------------------------------------------------------------------- #
# Task + provider calls
# --------------------------------------------------------------------------- #
def detect_task(prompt, draft):
    """'review' when there's a draft, 'create' when there's only a prompt, else None."""
    if draft.strip():
        return "review"
    if prompt.strip():
        return "create"
    return None


def build_user_message(task, prompt, draft, mode, tone):
    parts = [f"<task>{task}</task>"]
    if prompt.strip():
        parts.append(f"<prompt>\n{prompt.strip()}\n</prompt>")
    if task == "review":
        parts.append(f"<mode>{mode}</mode>")
    parts.append(f"<tone>{tone}</tone>")
    if task == "review":
        parts.append(f"<draft>\n{draft}\n</draft>")
    return "\n".join(parts)


def run_cli(cmd, stdin_text, timeout):
    proc = subprocess.run(
        cmd, input=stdin_text, capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=timeout, cwd=APP_DIR, creationflags=NO_WINDOW,
    )
    return proc.returncode, proc.stdout, proc.stderr


def run_claude(cli, provider, model, message, system_prompt, timeout):
    cmd = [
        cli, "-p",
        "--safe-mode",                 # no CLAUDE.md, plugins, MCP, hooks: fast and clean
        "--no-session-persistence",
        "--model", model,
        "--disallowed-tools", CLAUDE_DENIED_TOOLS,
        "--permission-prompts", "none",
        "--system-prompt", system_prompt,
        "--output-format", "json",
        # Don't add `--tools ""`: structured output needs its internal tool and hangs without it.
        "--json-schema", json.dumps(OUTPUT_SCHEMA),
    ]
    if provider.get("effort"):
        cmd += ["--effort", provider["effort"]]
    code, out, err = run_cli(cmd, message, timeout)
    try:
        payload = json.loads(out)
    except ValueError:
        detail = (err or out or "no output").strip()
        if "login" in detail.lower() or "auth" in detail.lower():
            detail += "\n\nSign in by running `claude auth login` in a terminal."
        raise RuntimeError(f"Claude failed (exit {code}):\n{detail[:1500]}")
    if payload.get("is_error"):
        raise RuntimeError(str(payload.get("result") or payload)[:1500])
    result = payload.get("structured_output")
    return result if isinstance(result, dict) else parse_json_reply(payload.get("result") or "")


def run_copilot(cli, provider, model, message, system_prompt, timeout):
    # No system-prompt or schema flags: instructions and format go in the prompt,
    # which is sent on stdin (no command-line length limit).
    prompt = f"{system_prompt}\n\n{JSON_INSTRUCTIONS}\n\n{message}"
    cmd = [
        cli, "-s",
        "--model", model,
        "--available-tools=",          # no tools at all
        "--no-custom-instructions",    # ignore AGENTS.md and similar
        "--disable-builtin-mcps",
        "--no-ask-user",
        "--no-color",
    ]
    if provider.get("effort"):
        cmd += ["--reasoning-effort", provider["effort"]]
    code, out, err = run_cli(cmd, prompt, timeout)
    if code != 0 or not out.strip():
        raise RuntimeError(f"Copilot failed (exit {code}):\n{(err or out or 'no output').strip()[:1500]}")
    return parse_json_reply(out)


RUNNERS = {"claude": run_claude, "copilot": run_copilot}


def parse_json_reply(text):
    """Reads the JSON object out of a reply, tolerating code fences or stray text."""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise RuntimeError(f"The reply wasn't the expected JSON:\n{text[:800]}")
    try:
        return json.loads(text[start:end + 1])
    except ValueError as exc:
        raise RuntimeError(f"Couldn't read the reply as JSON ({exc}):\n{text[:800]}")


def run_task(provider_name, provider, model, message, system_prompt, timeout):
    """Runs one request and returns a normalized result dict."""
    kind = provider.get("type", "claude")
    cli = find_cli(kind, provider.get("path", ""))
    if not cli:
        raise RuntimeError(f"{provider_name} isn't installed. Run the Write Assist installer again.")
    result = RUNNERS[kind](cli, provider, model, message, system_prompt, timeout)
    if not isinstance(result.get("text"), str):
        raise RuntimeError("The reply had no text.")
    changes = [c for c in (result.get("changes") or [])
               if isinstance(c, dict) and c.get("original") != c.get("fixed")]  # drop no-op entries
    # Models occasionally over-escape quotes inside explanations.
    for item in changes:
        item["reason"] = str(item.get("reason") or "").replace('\\"', '"')
    result["changes"] = changes
    result["notes"] = str(result.get("notes") or "").replace('\\"', '"')
    return result


# --------------------------------------------------------------------------- #
# Word-level diff, used to highlight edits in the reviewed text
# --------------------------------------------------------------------------- #
TOKEN_RE = re.compile(r"\s+|\w+|[^\w\s]", re.UNICODE)


def changed_spans(original, corrected):
    """Character spans in `corrected` that differ from `original`."""
    a = TOKEN_RE.findall(original)
    b = TOKEN_RE.findall(corrected)
    offsets, pos = [], 0
    for tok in b:
        offsets.append(pos)
        pos += len(tok)
    offsets.append(pos)

    spans = []
    matcher = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    for op, _a1, _a2, b1, b2 in matcher.get_opcodes():
        if op in ("replace", "insert") and b2 > b1:
            start, end = offsets[b1], offsets[b2]
            if corrected[start:end].strip():
                spans.append((start, end))
    return spans


# --------------------------------------------------------------------------- #
# Settings window
# --------------------------------------------------------------------------- #
class SettingsDialog:
    def __init__(self, app, first_run=False):
        self.app = app
        self.win = win = tk.Toplevel(app.root)
        win.title(f"Welcome to {APP_NAME}" if first_run else f"{APP_NAME} settings")
        win.transient(app.root)
        win.resizable(False, False)
        frame = ttk.Frame(win, padding=16)
        frame.pack(fill="both", expand=True)
        user = load_json(USER_SETTINGS_FILE, {})

        if first_run:
            ttk.Label(frame, text="Tell Write Assist a little about you, so it corrects and writes like you.\n"
                                  "You can change this any time in Settings.",
                      justify="left").pack(anchor="w", pady=(0, 10))
        ttk.Label(frame, text="About you", font=app.bold_font).pack(anchor="w")
        ttk.Label(frame, text="Your first language, the languages you write in, what you usually write, your name.",
                  foreground="#666666").pack(anchor="w")
        self.profile = tk.Text(frame, width=64, height=5, wrap="word", font=app.text_font,
                               padx=6, pady=4, relief="solid", borderwidth=1)
        self.profile.pack(fill="x", pady=(4, 2))
        self.profile.insert("1.0", user.get("profile", ""))
        ttk.Label(frame, text=PROFILE_EXAMPLE, foreground="#888888", wraplength=560,
                  justify="left").pack(anchor="w", pady=(0, 12))

        ttk.Label(frame, text="Global hotkey", font=app.bold_font).pack(anchor="w")
        row = ttk.Frame(frame)
        row.pack(fill="x", pady=(4, 2))
        self.hotkey = ttk.Entry(row, width=24)
        self.hotkey.insert(0, app.settings.get("hotkey", ""))
        self.hotkey.pack(side="left")
        ttk.Label(row, text="Opens Write Assist from any app. e.g. Win+Ctrl+W, Ctrl+Alt+F9",
                  foreground="#666666").pack(side="left", padx=8)

        version = f"Version {app.version}" + ("  (development copy, no automatic updates)" if IS_DEV else "")
        ttk.Label(frame, text=version, foreground="#888888").pack(anchor="w", pady=(16, 0))

        buttons = ttk.Frame(frame)
        buttons.pack(fill="x", pady=(12, 0))
        ttk.Button(buttons, text="Save", command=self.save).pack(side="right")
        ttk.Button(buttons, text="Skip" if first_run else "Cancel", command=self.cancel).pack(side="right", padx=6)

        win.protocol("WM_DELETE_WINDOW", self.cancel)
        win.update_idletasks()
        x = app.root.winfo_rootx() + (app.root.winfo_width() - win.winfo_width()) // 2
        y = app.root.winfo_rooty() + 60
        win.geometry(f"+{max(x, 0)}+{max(y, 0)}")
        win.grab_set()
        self.profile.focus_set()

    def cancel(self):
        user = load_json(USER_SETTINGS_FILE, {})
        user.setdefault("profile", "")   # don't ask again on next launch
        save_json(USER_SETTINGS_FILE, user)
        self.win.destroy()

    def save(self):
        user = load_json(USER_SETTINGS_FILE, {})
        user["profile"] = self.profile.get("1.0", "end-1c").strip()
        new_hotkey = self.hotkey.get().strip()
        hotkey_changed = bool(new_hotkey) and new_hotkey != self.app.settings.get("hotkey")
        if hotkey_changed:
            user["hotkey"] = new_hotkey
        save_json(USER_SETTINGS_FILE, user)
        self.app.reload_settings()
        self.win.destroy()
        if hotkey_changed:
            self.app.apply_hotkey()
        else:
            self.app.set_status("Settings saved.")


# --------------------------------------------------------------------------- #
# Main window
# --------------------------------------------------------------------------- #
class App:
    def __init__(self, root):
        self.root = root
        self.settings = load_settings()
        self.providers = self.settings["providers"]
        self.state = load_json(STATE_FILE, {})
        self.models_used = dict(self.state.get("models", {}))  # last model per provider
        self.version, self.repo = read_release()
        self.results = queue.Queue()
        self.busy = False
        self.started = 0.0
        self.task = None
        self.update_tag = None

        root.title(APP_NAME)
        root.geometry(self.state.get("geometry", "1150x760"))
        root.minsize(760, 520)

        family = self.settings.get("font_family", "Segoe UI")
        size = self.settings.get("font_size", 11)
        self.text_font = tkfont.Font(family=family, size=size)
        self.small_font = tkfont.Font(family=family, size=max(size - 1, 8))
        self.bold_font = tkfont.Font(family=family, size=size - 1, weight="bold")
        self.strike_font = tkfont.Font(family=family, size=size, overstrike=1)

        self._build()
        self._bind_keys()
        root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.on_provider_change()
        self.update_task()
        self.draft.focus_set()

        if "profile" not in load_json(USER_SETTINGS_FILE, {}):
            root.after(400, lambda: SettingsDialog(self, first_run=True))
        if not IS_DEV and self.repo:
            root.after(3000, self.check_for_update)

    # ---- layout ----------------------------------------------------------- #
    def available_providers(self):
        """Providers whose CLI is installed (all of them if none is, to show the error)."""
        names = [n for n, p in self.providers.items()
                 if find_cli(p.get("type", "claude"), p.get("path", ""))]
        return names or list(self.providers)

    def _build(self):
        top = ttk.Frame(self.root)
        top.pack(fill="x", padx=8, pady=(8, 2))
        self.mode = self._combo(top, "Mode", MODES, self.state.get("mode", "fix"), 7, first=True)
        self.tone = self._combo(top, "Tone", TONES, self.state.get("tone", "keep"), 12)
        names = self.available_providers()
        provider = self.state.get("provider", self.settings.get("default_provider", names[0]))
        self.provider = self._combo(top, "AI", names, provider, 14)
        self.provider.bind("<<ComboboxSelected>>", lambda e: self.on_provider_change())
        # Editable, so any model name the provider accepts can be typed in.
        ttk.Label(top, text="Model").pack(side="left", padx=(12, 4))
        self.model = ttk.Combobox(top, width=16)
        self.model.pack(side="left")
        ttk.Button(top, text="Settings", command=lambda: SettingsDialog(self)).pack(side="right")

        panes = ttk.PanedWindow(self.root, orient="vertical")
        panes.pack(fill="both", expand=True, padx=8, pady=4)

        texts = ttk.PanedWindow(panes, orient="horizontal")
        panes.add(texts, weight=4)

        # Left: prompt (small) above draft (large).
        left = ttk.PanedWindow(texts, orient="vertical")
        texts.add(left, weight=1)

        prompt_box = ttk.Frame(left)
        head = ttk.Frame(prompt_box)
        head.pack(fill="x")
        ttk.Label(head, text="Prompt").pack(side="left", pady=2)
        ttk.Label(head, text="context or instructions, optional for review",
                  foreground="#777777").pack(side="left", padx=6)
        presets = self.settings.get("prompt_presets", [])
        if presets:
            self.preset = ttk.Combobox(head, values=presets, state="readonly", width=24)
            self.preset.set("Insert preset...")
            self.preset.bind("<<ComboboxSelected>>", lambda e: self.insert_preset())
            self.preset.pack(side="right")
        self.prompt = self._text(prompt_box, height=4)
        left.add(prompt_box, weight=1)

        draft_box = ttk.Frame(left)
        head = ttk.Frame(draft_box)
        head.pack(fill="x")
        ttk.Label(head, text="Draft").pack(side="left", pady=2)
        ttk.Label(head, text="text to review, leave empty to create",
                  foreground="#777777").pack(side="left", padx=6)
        ttk.Button(head, text="Clear", command=self.clear).pack(side="right")
        ttk.Button(head, text="Paste & review", command=self.paste_and_review).pack(side="right", padx=4)
        self.draft = self._text(draft_box)
        left.add(draft_box, weight=3)

        # Right: result.
        right = ttk.Frame(texts)
        head = ttk.Frame(right)
        head.pack(fill="x")
        self.output_label = ttk.Label(head, text="Result")
        self.output_label.pack(side="left", pady=2)
        ttk.Button(head, text="Copy", command=self.copy_result).pack(side="right")
        ttk.Button(head, text="Use as draft", command=self.use_as_draft).pack(side="right", padx=4)
        self.output = self._text(right)
        self.output.tag_configure("edit", background="#fff1a8", foreground="#000000")
        texts.add(right, weight=1)

        bottom = ttk.Frame(panes)
        ttk.Label(bottom, text="Changes and notes").pack(anchor="w", pady=2)
        self.changes = self._text(bottom, height=7, font=self.small_font)
        self.changes.tag_configure("old", font=self.strike_font, foreground="#b3261e")
        self.changes.tag_configure("new", foreground="#1e7b34")
        self.changes.tag_configure("why", foreground="#666666")
        self.changes.tag_configure("note", foreground="#8a5a00")
        self.changes.configure(state="disabled")
        panes.add(bottom, weight=1)

        bar = ttk.Frame(self.root)
        bar.pack(fill="x", padx=8, pady=(2, 8))
        self.run_btn = ttk.Button(bar, text="Review  (Ctrl+Enter)", width=20, command=self.run)
        self.run_btn.pack(side="left")
        self.auto_copy = tk.BooleanVar(value=self.state.get("auto_copy", self.settings.get("auto_copy", False)))
        ttk.Checkbutton(bar, text="Copy result automatically", variable=self.auto_copy).pack(side="left", padx=12)
        self.update_btn = ttk.Button(bar, text="", command=self.start_update)  # shown when an update exists
        self.status = ttk.Label(bar, text="", anchor="e")
        self.status.pack(side="right", fill="x", expand=True)

        for widget in (self.prompt, self.draft):
            widget.bind("<<Modified>>", self._on_modified)

    def _combo(self, parent, label, values, current, width, first=False):
        ttk.Label(parent, text=label).pack(side="left", padx=(6 if first else 12, 4))
        combo = ttk.Combobox(parent, values=values, width=width, state="readonly")
        combo.set(current if current in values else values[0])
        combo.pack(side="left")
        return combo

    def _text(self, parent, height=10, font=None):
        frame = ttk.Frame(parent)
        frame.pack(fill="both", expand=True)
        widget = tk.Text(frame, wrap="word", undo=True, height=height, font=font or self.text_font,
                         padx=8, pady=6, relief="solid", borderwidth=1)
        scroll = ttk.Scrollbar(frame, command=widget.yview)
        widget.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        widget.pack(side="left", fill="both", expand=True)
        return widget

    def _bind_keys(self):
        self.root.bind("<Control-Return>", lambda e: (self.run(), "break")[1])
        self.root.bind("<Control-Shift-V>", lambda e: (self.paste_and_review(), "break")[1])
        self.root.bind("<Control-Shift-C>", lambda e: (self.copy_result(), "break")[1])

    # ---- settings / hotkey / updates -------------------------------------- #
    def reload_settings(self):
        self.settings = load_settings()

    def apply_hotkey(self):
        self.set_status(f"Setting hotkey {self.settings.get('hotkey', '')}...")

        def work():
            ok, message = reload_hotkey_listener()
            self.root.after(0, lambda: self._hotkey_applied(ok, message))
        threading.Thread(target=work, daemon=True).start()

    def _hotkey_applied(self, ok, message):
        if ok:
            self.set_status(f"Hotkey set: {message}")
        else:
            self.set_status(f"Hotkey not set: {message}", error=True)
            messagebox.showwarning(APP_NAME, f"Couldn't set the hotkey: {message}.\n\n"
                                             "Pick another one in Settings.", parent=self.root)

    def check_for_update(self):
        def work():
            try:
                tag = latest_release(self.repo)
            except Exception:
                tag = None  # offline or rate-limited: try again later
            if tag and version_tuple(tag) > version_tuple(self.version):
                self.root.after(0, lambda: self._show_update(tag))
        threading.Thread(target=work, daemon=True).start()
        self.root.after(6 * 3600 * 1000, self.check_for_update)

    def _show_update(self, tag):
        self.update_tag = tag
        self.update_btn.configure(text=f"Update to {tag}")
        self.update_btn.pack(side="left", padx=4)

    def start_update(self):
        if not messagebox.askyesno(
                APP_NAME, f"Update Write Assist from {self.version} to {self.update_tag}?\n\n"
                          "The app closes, a window shows the update, and the app opens again.",
                parent=self.root):
            return
        installer = f"https://raw.githubusercontent.com/{self.repo}/main/install.ps1"
        subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                          "-Command", f"irm {installer} | iex"], creationflags=NEW_CONSOLE)
        self.on_close()

    # ---- task / provider -------------------------------------------------- #
    def _on_modified(self, event):
        event.widget.edit_modified(False)
        self.update_task()

    def update_task(self):
        """Switches the button and Mode between Review and Create as fields fill."""
        task = detect_task(self.prompt.get("1.0", "end-1c"), self.draft.get("1.0", "end-1c"))
        if task == self.task:
            return
        self.task = task
        label = "Create" if task == "create" else "Review"
        self.run_btn.configure(text=f"{label}  (Ctrl+Enter)")
        self.mode.configure(state="disabled" if task == "create" else "readonly")

    def current_provider(self):
        name = self.provider.get()
        return name, self.providers[name]

    def on_provider_change(self):
        if getattr(self, "_shown_provider", None):
            self.models_used[self._shown_provider] = self.model.get().strip()
        name, provider = self.current_provider()
        self._shown_provider = name
        models = provider.get("models") or []
        self.model.configure(values=models)
        self.model.set(self.models_used.get(name) or provider.get("default_model") or (models[0] if models else ""))
        if find_cli(provider.get("type", "claude"), provider.get("path", "")):
            self.set_status("Paste a draft to review, or write a prompt to create.")
        else:
            self.set_status(f"{name} isn't installed. Run the Write Assist installer again.", error=True)

    def insert_preset(self):
        text = self.preset.get()
        self.preset.set("Insert preset...")
        current = self.prompt.get("1.0", "end-1c").rstrip()
        self.prompt.delete("1.0", "end")
        self.prompt.insert("1.0", f"{current}\n{text}".strip())
        self.prompt.focus_set()

    # ---- actions ---------------------------------------------------------- #
    def run(self):
        if self.busy:
            return
        prompt = self.prompt.get("1.0", "end-1c")
        draft = self.draft.get("1.0", "end-1c")
        task = detect_task(prompt, draft)
        if not task:
            self.set_status("Paste a draft to review, or write a prompt to create.")
            return
        name, provider = self.current_provider()
        model = self.model.get().strip() or provider.get("default_model", "")
        message = build_user_message(task, prompt, draft, self.mode.get(), self.tone.get())
        system_prompt = load_system_prompt(load_json(USER_SETTINGS_FILE, {}).get("profile", ""))
        self.busy = True
        self.started = time.time()
        self.run_btn.configure(state="disabled")
        self.set_status(f"{task.capitalize()} with {name}...")
        args = (task, draft, name, provider, model, message, system_prompt)
        threading.Thread(target=self._worker, args=args, daemon=True).start()
        self.root.after(100, self._poll)

    def _worker(self, task, draft, name, provider, model, message, system_prompt):
        timeout = self.settings.get("timeout_seconds", 120)
        try:
            result = run_task(name, provider, model, message, system_prompt, timeout)
            self.results.put(("ok", task, draft, name, result))
        except subprocess.TimeoutExpired:
            self.results.put(("error", task, draft, name, f"Timed out waiting for {name}."))
        except Exception as exc:  # shown in the status bar
            self.results.put(("error", task, draft, name, str(exc)))

    def _poll(self):
        try:
            kind, task, draft, name, payload = self.results.get_nowait()
        except queue.Empty:
            elapsed = time.time() - self.started
            self.set_status(f"Working with {self.provider.get()}... {elapsed:.0f}s")
            self.root.after(200, self._poll)
            return
        self.busy = False
        self.run_btn.configure(state="normal")
        if kind == "error":
            self.set_status(payload, error=True)
            return
        self.show_result(task, draft, name, payload)

    def show_result(self, task, draft, name, result):
        text = result.get("text", "")
        title = "Corrected" if task == "review" else "Written"
        self.output_label.configure(text=f"{title}  ({name})")
        self.output.delete("1.0", "end")
        self.output.insert("1.0", text)
        if task == "review":
            for start, end in changed_spans(draft, text):
                self.output.tag_add("edit", f"1.0+{start}c", f"1.0+{end}c")

        self.changes.configure(state="normal")
        self.changes.delete("1.0", "end")
        changes = result.get("changes") or []
        if task == "review" and not changes:
            self.changes.insert("end", "No changes needed. Looks good.\n", "new")
        if task == "review":
            for item in changes:
                self.changes.insert("end", str(item.get("original", "")), "old")
                self.changes.insert("end", "  ->  ")
                self.changes.insert("end", str(item.get("fixed", "")), "new")
                self.changes.insert("end", f"   {item.get('reason', '')}\n", "why")
        notes = (result.get("notes") or "").strip()
        if notes:
            self.changes.insert("end", f"{chr(10) if task == 'review' else ''}Note: {notes}\n", "note")
        self.changes.configure(state="disabled")

        elapsed = time.time() - self.started
        if task == "review":
            count = len(changes)
            msg = f"Reviewed with {name} · {count} change{'s' if count != 1 else ''} · {elapsed:.1f}s"
        else:
            msg = f"Written with {name} · {elapsed:.1f}s"
        if self.auto_copy.get():
            self.copy_result(quiet=True)
            msg += " · copied"
        self.set_status(msg)

    def paste_and_review(self):
        try:
            clip = self.root.clipboard_get()
        except tk.TclError:
            self.set_status("Clipboard is empty.")
            return
        self.draft.delete("1.0", "end")
        self.draft.insert("1.0", clip)
        self.update_task()
        self.run()

    def copy_result(self, quiet=False):
        text = self.output.get("1.0", "end-1c")
        if not text:
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        if not quiet:
            self.set_status("Result copied.")

    def use_as_draft(self):
        """Moves the result into Draft, e.g. to review a created text or iterate."""
        text = self.output.get("1.0", "end-1c")
        if text:
            self.draft.delete("1.0", "end")
            self.draft.insert("1.0", text)
            self.update_task()

    def clear(self):
        for widget in (self.prompt, self.draft, self.output):
            widget.delete("1.0", "end")
        self.changes.configure(state="normal")
        self.changes.delete("1.0", "end")
        self.changes.configure(state="disabled")
        self.output_label.configure(text="Result")
        self.set_status("")
        self.update_task()
        self.draft.focus_set()

    def bring_to_front(self):
        """Restores, raises and focuses the window (used by the global hotkey)."""
        self.root.deiconify()
        self.root.lift()
        self.root.attributes("-topmost", True)
        self.root.after(200, lambda: self.root.attributes("-topmost", False))
        self.root.focus_force()
        self.draft.focus_set()

    def set_status(self, text, error=False):
        self.status.configure(text=text, foreground="#b3261e" if error else "")

    def on_close(self):
        self.models_used[self.provider.get()] = self.model.get().strip()
        state = {
            "geometry": self.root.geometry(),
            "mode": self.mode.get(),
            "tone": self.tone.get(),
            "provider": self.provider.get(),
            "models": self.models_used,
            "auto_copy": self.auto_copy.get(),
        }
        try:
            save_json(STATE_FILE, state)
        except OSError:
            pass
        self.root.destroy()


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
    if os.name == "nt":
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


def listen_for_wakeups(server, root, app):
    def serve():
        while True:
            try:
                conn, _ = server.accept()
            except OSError:
                return
            with conn:
                if conn.recv(16).startswith(b"show"):
                    root.after(0, app.bring_to_front)
    threading.Thread(target=serve, daemon=True).start()


def main():
    server = claim_instance()
    if server is None and wake_existing_instance():
        return
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)  # crisp text on high-DPI screens
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
        except Exception:
            pass
    root = tk.Tk()
    if ICON_FILE.exists():
        root.iconbitmap(default=str(ICON_FILE))
    app = App(root)
    if server is not None:
        listen_for_wakeups(server, root, app)
    root.mainloop()


if __name__ == "__main__":
    main()
