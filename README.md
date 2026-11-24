# Write Assist

A small Windows app that reviews and writes text with AI: messages, emails,
posts, docs. Paste what you wrote and get it proofread, or describe what you
need and get it written. It uses your existing Claude subscription through
Claude Code, so there are no API keys and nothing extra to pay.

![Write Assist icon](assets/writeAssist.ico)

## Install

You need **Windows 10 or 11** and a **Claude Pro or Max** plan (or a Team or
Enterprise seat; the free plan doesn't include Claude Code).

1. Open **PowerShell** (Start, type *PowerShell*, Enter).
2. Paste this line and press Enter:

   ```powershell
   irm https://raw.githubusercontent.com/luigihmtz/write-assist/main/install.ps1 | iex
   ```

3. When your browser opens, sign in to Claude.

The installer sets up Python and Claude Code if they're missing, then opens
Write Assist. No admin rights needed. On first launch it asks a little about
you (your languages, what you write) so it corrects and writes like you.

**Open it** from the Start Menu or with **Win+Ctrl+W** from any app. To pin it
to the taskbar: Start, right-click *Write Assist*, *Pin to taskbar*.

**Updates:** when a new version is out, an *Update to vX* button appears at
the bottom of the window. One click and it updates itself.

**Uninstall:** Settings > Apps > Write Assist > Uninstall.

## How to use it

Fill in one or both fields. The button shows which task you'll get:

| Prompt | Draft | Task |
|---|---|---|
| – | ✓ | **Review**: proofreads the draft (grammar, typos, punctuation) |
| ✓ | ✓ | **Review**: the prompt adds context or instructions ("email to a client", "make it shorter") |
| ✓ | – | **Create**: writes the text the prompt describes |

Press **Ctrl+Enter**, then **Copy** the result.

| Control | What it does |
|---|---|
| **Prompt** | Review: optional context or instructions, e.g. "Email to a client", "Reply to my boss, make it shorter". Create: describe what to write, e.g. "Email to Sarah: the storyboard is two days late, we need the brand guidelines". *Insert preset...* adds a common one. |
| **Draft** | The text to review. Leave empty to create. |
| **Mode** | Review only. `fix`: spelling, typos, grammar, punctuation (minimal edits). `polish`: also smooths awkward or unclear phrasing. Anything the prompt asks for overrides it. |
| **Tone** | `keep` (default), or lean it: more formal, more casual, friendlier, more concise. |
| **AI** | The AIs installed on this PC: Claude, and GitHub Copilot if its CLI is installed. |
| **Model** | Claude: `opus` (default), `sonnet`, `haiku`. Copilot: `auto`. You can type any other model name the AI accepts. |
| **Settings** | *About you* and the global hotkey. |

**Review** shows the corrected text with the edits highlighted, and below it
each change (old → new) with a short reason, plus an optional note (e.g. "this
may sound blunt for a client email"). **Create** shows the new text; anything
essential missing from the prompt is left as a placeholder like `[date]`.

Shortcuts: **Ctrl+Enter** run · **Ctrl+Shift+V** paste the clipboard as the
draft and review · **Ctrl+Shift+C** copy the result. *Use as draft* moves the
result into Draft, to refine it with a new prompt. Emojis are kept as they
are (the window shows them in black and white).

The Draft is only ever treated as text to correct, never as instructions:
a pasted email saying "reply ASAP with the numbers" gets proofread, not
answered.

## Files

| File | Purpose |
|---|---|
| `writeAssist.pyw` | The app. |
| `hotkeyListener.pyw` | Background listener for the global hotkey; opens or wakes the app. |
| `system_prompt.md` | Instructions for both tasks, shared by all AIs. `{{profile}}` becomes the user's *About you*. |
| `settings.json` | Shipped defaults: hotkey, AIs and models, timeout, font, prompt presets. |
| `release.json` | Product version and GitHub repo, used for updates and releases. |
| `install.ps1` | Installer and updater (see above). |
| `uninstall.ps1` | Removes the app, shortcuts and settings. |
| `release.ps1` | Publishes a new version (maintainer only). |
| `assets/writeAssist.ico` | Icon. |

Per-user files, kept across updates, in `%APPDATA%\WriteAssist\`:
`user_settings.json` (*About you*, hotkey, and any `settings.json` key to
override) and `state.json` (last-used options, window size). Installed copies
live in `%LOCALAPPDATA%\WriteAssist\`.

## How it works

Each run builds one request from the Prompt, Draft, Mode and Tone, adds
`system_prompt.md`, and sends it to the chosen AI's command-line tool in the
background. The AI gets no tools: it can't read files, run commands or browse.

**Claude:**

```
claude -p --safe-mode --no-session-persistence --model opus --effort low
       --system-prompt <system_prompt.md> --output-format json --json-schema <schema>
```

- `--safe-mode` skips CLAUDE.md, plugins, MCP servers and hooks, so the call
  is fast (~3–6 s) and nothing from other projects leaks into it.
- `--json-schema` makes Claude return `{text, changes[], notes}`.
- Don't pass `--tools ""` together with `--json-schema`: structured output
  needs its internal tool, and the call hangs. File, shell and web tools are
  denied with `--disallowed-tools` instead.

**GitHub Copilot** (optional, needs `winget install GitHub.Copilot` and a
Copilot plan):

```
copilot -s --model auto --available-tools= --no-custom-instructions
        --disable-builtin-mcps --no-ask-user      (prompt sent on stdin)
```

Copilot CLI has no system-prompt or schema option, so the instructions and
JSON format go in the prompt and the reply is parsed. It has no command that
lists models: run `copilot`, type `/model`, and type a name into the Model
box. Leave its `effort` empty; `auto` rejects `--reasoning-effort`.

**Hotkey:** shortcut (.lnk) hotkeys can't use the Win key, so
`hotkeyListener.pyw` registers it with Windows and starts at login. The app
talks to it on local port 47614 to change the hotkey; the app itself listens
on 47613 so a second launch brings the open window forward.

**Updates:** the app checks the repo's latest GitHub release against
`release.json` every 6 hours. *Update* re-runs `install.ps1`, which replaces
`%LOCALAPPDATA%\WriteAssist` with the new release and restarts everything.

## Development

Clone the repo and run `.\install.ps1` from it. In a clone (a folder with
`.git`), the installer sets up shortcuts and the hotkey for that folder in
place, and the app never self-updates.

To publish a version:

1. Bump `version` and `date` in `release.json`, and add a `CHANGELOG.md` entry.
2. Commit and push to `main`.
3. Run `.\release.ps1`. It tags the commit and creates the GitHub release;
   installed copies offer the update the next time they open.
