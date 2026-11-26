# Changelog

## v02.08.03 - 2026-11-25

- The interface is now also in French (Settings > Interface language; by
  default the same as Windows), and dictation can be set to French.
- *Underline: spelling* also checks French when Windows has its French
  dictionary (French Windows, or French added in Windows' language settings).
- Reviews no longer list the same fix twice (once on its own and once inside
  a longer snippet).

## v02.08.02 - 2026-11-25

- *Spelling only* now checks Spanish (Mexico) as well as English, so correct
  Spanish words are no longer underlined as mistakes. It uses the Spanish
  dictionary that comes with Windows; nothing to download.
- The underline choice moved from Settings to the top bar (*Underline*:
  off, spelling, spelling + grammar).

## v02.08.01 - 2026-11-25

- *Underline mistakes as I type* (Settings) replaces the live grammar switch,
  with three choices: *Off*; *Spelling only*, the spellchecker built into
  Windows (the default: free, nothing to download); and *Spelling and
  grammar*, with LanguageTool. If live grammar was on, it stays on.
- With *Off*, Prompt and Draft show no wavy lines at all (before, the
  built-in spellchecker kept drawing them).

## v02.08.00 - 2026-11-25

- Live grammar check (Settings): mistakes in Prompt and Draft are underlined
  as you type, and a click shows suggestions. It uses LanguageTool, a free,
  open-source checker that runs on your computer: no account, nothing sent
  anywhere. The first time, Write Assist asks before a one-time download of
  about 300 MB. With Language on Auto, each paragraph is checked in its own
  language, so mixed English and Spanish messages work.
- Uninstalling also removes the grammar checker.

## v02.07.00 - 2026-11-25

- Thesaurus and Translate panels open next to the text they work on, and that
  text stays highlighted in yellow while the panel is open.
- Translate shows only the translation when you've selected text (the box to
  type text in appears only when nothing is selected).
- Detach (⧉): a panel can float anywhere in the window, stays open while you
  keep working, and can be resized from its corner.
- Fixed the free local AI failing on some texts with "Couldn't read the reply
  as JSON": the model sometimes got stuck repeating itself until its reply was
  cut off. Write Assist now gives it more room, stops a runaway reply early and
  retries once, and otherwise explains what happened.

## v02.06.00 - 2026-11-24

- ChatGPT: if OpenAI's Codex CLI is installed and signed in with your ChatGPT
  account, *ChatGPT* appears in the AI list (default model gpt-6-luna, the
  fast and affordable one). See *Optional AIs* in the README.
- Review explanations are always in the language of the text, even when your
  first language is a different one.

## v02.05.00 - 2026-11-24

- Free local AI: *Local (free)* in the AI list runs Google's Gemma model on
  your own computer through the free Ollama app. No account or subscription,
  works offline, and your text never leaves your PC. The first time you pick
  it, Write Assist tells you the download size (about 5.3 GB) and asks before
  downloading anything.
- The installer asks which AI to use when neither is set up: Claude (paid
  plan) or the free local AI. Write Assist no longer requires a Claude plan.
- The default AI is the cheapest one that's set up, and the automatic
  fallback also tries the cheapest one first.
- More reliable translations and reviews: Write Assist detects whether a text
  is English or Spanish and tells the AI.

## v02.04.02 - 2026-11-24

- *fix and polish wording* is now the default Mode (everyone switches to it
  once after updating; your choice is remembered after that).

## v02.04.01 - 2026-11-24

- Fixed updates failing with "Cannot remove the item ... because it is in
  use": the installer now leaves the app folder before replacing it, and
  waits a few seconds if the app is still closing.
- The status bar says "4 changes" or "1 change" instead of "change(s)".

## v02.04.00 - 2026-11-24

- Settings > Microphone for dictation: choose which microphone Dictate uses,
  or keep *Same as Windows*. If the chosen one is unplugged, Dictate uses the
  Windows default and says so.
- Write Assist is now open source under the MIT License. The README adds
  privacy details, third-party credits, and a note that the project isn't
  affiliated with Anthropic, GitHub or Microsoft.

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
