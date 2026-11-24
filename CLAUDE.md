# Write Assist: notes for Claude

Windows desktop app (Python/tkinter) that reviews or writes text through AI
CLIs run headless: Claude Code (`claude -p`) and, optionally, GitHub Copilot
CLI (`copilot -s`). Shared publicly through GitHub releases with a one-line
installer. README.md covers usage and architecture; read it first.

## Layout and data

- Repo files are the shipped app. `install.ps1` copies a release to
  `%LOCALAPPDATA%\WriteAssist`; a clone with `.git` is a development copy that
  runs in place and never self-updates (`IS_DEV` in writeAssist.pyw).
- Per-user data is in `%APPDATA%\WriteAssist\` (`user_settings.json`,
  `state.json`), never in the app folder, so updates can replace the folder.
- `release.json` holds the product version (`vXX.XX.XX`) and the repo; the
  app compares it with the latest GitHub release.

## Conventions

- Every code file starts with the author header (Author / Email / Version /
  Date / Usage); bump the file's version and date on every change. JSON files
  carry author/version/date fields instead.
- install.ps1 runs via `irm | iex`: no `param()` block, never `exit` (it would
  close the user's window); everything is inside a function and errors are
  thrown and caught at the end. Keep it PowerShell 5.1 compatible.
- Ports: 47613 = app single-instance, 47614 = hotkey listener control.
  APP_ID `LuisMartinez.WriteAssist` must match in writeAssist.pyw and install.ps1.

## Gotchas found while building it

- `claude -p --json-schema` hangs if you also pass `--tools ""`.
- Copilot CLI: only `--model auto` works on the maintainer's plan, and `auto`
  rejects `--reasoning-effort`. Prefer
  `%LOCALAPPDATA%\GitHubCopilotCLI\copilot.exe` over the VS Code `copilot`
  launcher on PATH.
- Tk shows emojis in black and white but keeps them intact; highlight
  offsets (`1.0+Nc`) line up with Python string offsets.
- Taken Win-key hotkeys on the maintainer's PC: Win+Shift+W, Win+Alt+W,
  Win+Alt+G, Win+Shift+A.

## Releasing

Bump release.json and CHANGELOG.md, commit and push `main`, run
`.\release.ps1` (needs git and gh).
