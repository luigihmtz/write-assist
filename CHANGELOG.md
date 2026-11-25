# Changelog

## v02.04.00 - 2026-11-24

- Settings > Microphone for dictation: choose which microphone Dictate uses,
  or keep *Same as Windows*. If the chosen one is unplugged, Dictate uses the
  Windows default and says so.

## v02.03.01 - 2026-11-24

- The Model box is now a regular dropdown that always lists every model
  (before, it only suggested the one already typed). *Other...* lets you
  enter any other model name.

## v02.03.00 - 2026-11-24

- Translate: select text anywhere and click *Translate* (Ctrl+Shift+T). Pick
  the language, or leave *English ⇄ Spanish*; then replace the selection,
  use it as the draft, or copy it. Single words also get other options.
- Language: choose the text's language and variant (e.g. English US or UK,
  Spanish Mexico or Spain) for Review and Create, or leave it on *Auto*.
- The interface is now in English or Spanish (Settings > Interface
  language; by default the same as Windows).
- One *Thesaurus* button, in the top bar, instead of one per field. Click a
  synonym or antonym to replace your word with it or to look it up in turn,
  go back with ←, or type any word in the panel's search box.
- Claude's default model is now haiku (then sonnet, then opus): fast and
  light on your plan's limits. Everyone starts on haiku once after updating.
- Clearer Mode options: *fix errors only* and *fix and polish wording*.

## v02.01.00 - 2026-11-24

- Automatic fallback: if Claude (or Copilot) hits its usage limit, the request
  goes to the other AI, and the status bar says which one answered and why.
- Claude requests are about 8 times smaller (~3k input tokens instead of
  ~23k), so Write Assist uses much less of your Claude plan's limits.

## v02.00.00 - 2026-11-24

- New window built on WebView2 (the engine inside Microsoft Edge): color
  emojis, light and dark theme following Windows, editable result.
- Thesaurus: select a word (or put the cursor on it) and click *Thesaurus* or
  press Ctrl+T for its meaning, synonyms and antonyms that fit your sentence.
  Click one to swap it in. It only asks the AI when you click.
- Dictation: *Dictate* buttons on Prompt and Draft. Speech is transcribed on
  your computer (faster-whisper): free, offline and private. The speech
  engine downloads the first time you use it.
- Settings: speech model and language.
- The installer now adds the pywebview package and checks for WebView2.

## v01.05.01 - 2026-11-24

- The *Update* button now downloads the installer and runs it as a file,
  which is more reliable than piping it into PowerShell.

## v01.05.00 - 2026-11-24

First shared release.

- One-line installer (`install.ps1`): installs Python and Claude Code if
  needed, sets up the Start Menu shortcut and global hotkey, lists the app in
  Settings > Apps, and helps sign in to Claude.
- Automatic update check: an *Update* button appears when a new release is out.
- Settings window: *About you* (asked on first launch) and the global hotkey.
  Per-user settings live in `%APPDATA%\WriteAssist` and survive updates.
- Default hotkey is now Win+Ctrl+W.
- Only installed AIs appear in the AI dropdown.
- Renamed from Grammar Check to Write Assist.

## v01.04.00 and earlier

Personal versions before sharing: Review and Create tasks, Claude and GitHub
Copilot support, highlighted edits, single window, Win-key hotkey.
