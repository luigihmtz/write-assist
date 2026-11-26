# Changelog

## v02.16.00 - 2026-11-26

- Error messages are now in the interface language too (English, Spanish or
  French): failed AI requests, downloads, the grammar checker, exports,
  sessions and the global hotkey. Technical details, such as what an AI's own
  tool printed, are shown as they are.

## v02.15.00 - 2026-11-26

- A **Review / Refine** switch in the Prompt's header says what the prompt is
  for: the Draft (Review, or Create when the Draft is empty) or the result
  (Refine). One button (Ctrl+Enter) does what the switch shows and says so:
  *Review*, *Create* or *Refine*, in that color. Ctrl+Shift+Enter, or the hint
  next to it, flips the switch. With an empty Prompt the switch is greyed and
  the button reviews the Draft alone. The separate
  Refine button is gone.
- Colors tell them apart: blue for Review/Create from a prompt, violet for
  Refine, slate for the Draft. The result's header takes the color of where it
  came from (slate when it came from the Draft alone), and so do the History
  badges.
- The Draft is now rich text, with the same formatting bar as the result:
  bold, italic, underline, strikethrough, lists and links (Ctrl+K).
- Formatting survives everything: Review, Refine, *Use as draft*, History,
  sessions and exports. Review sends the AI plain text (fewer tokens, nothing
  for it to break) and Write Assist puts your formatting back on the
  corrected words; a word that replaced a bold one stays bold.
- Pasting into the Draft or the result keeps bold, italics, underline,
  strikethrough, links and lists from Word, Outlook, Teams or web pages, and
  drops everything else. Emojis copied from Teams or Outlook (which copy them
  as little pictures) arrive as emojis.
- Spelling and grammar underlines, Thesaurus, Translate and dictation work in
  the rich Draft as before.

## v02.14.00 - 2026-11-26

- **Refine** (Ctrl+Shift+Enter), next to Review/Create once there's a result:
  write what to change in the Prompt ("shorter and friendlier", "add that lunch
  is included") and the result is revised in place, keeping everything else.
  It works after Create and after Review, includes any edits you made to the
  result by hand, and leaves the Draft as it is. Changes and notes show what
  changed; each step is saved in History, so you can go back.
- Cheap by design: only the current result and the new instruction are sent
  (plus the first prompt, as background), not the whole conversation, so it
  costs about the same as a Review and works with the free local AI too.

## v02.13.00 - 2026-11-26

- Your work is kept when you close Write Assist, like in VS Code: prompt,
  draft, result, changes and notes are all back the next time you open it,
  without a "save changes?" question. *Settings > When closing Write Assist*
  can instead ask to save a session file, or start empty.
- Opening a session no longer asks either: what you had goes to History first.
- Everything the AI explains follows the interface language (English, Spanish
  or French), whatever the language of the text: the reasons for each change
  and the notes in a review, the Thesaurus definitions, and Translate's notes
  and language names. The text itself, synonyms and translations keep their
  own language. With the free local AI, the Thesaurus stays in the word's
  language (the small model would otherwise translate the synonyms too).

## v02.12.00 - 2026-11-26

- History now lives inside the result panel: the **History** button opens a
  column with the versions, and clicking one shows it in the result, with its
  changes and notes (or what changed from the version before). The result you
  had is saved first. Turning History off keeps the version shown. The
  column has its own **Clear** button.
- Sessions: **Save session** (Ctrl+Shift+S) saves the prompt, draft, result
  (with formatting, changes and notes), options and versions in a
  `.wasession` file; **Open session** (Ctrl+O) or a double-click on the file
  brings it back.
- Closing with unsaved changes asks whether to save the session (it can be
  turned off in Settings). Opening another session or updating asks too.
- The panels can be resized by dragging the dividers between them
  (double-click resets); the sizes are remembered.
- **About** (next to Settings): version, license, project page, credits, and
  a check for updates.
- **Copy diagnostics** (in About): a report of the setup (version, settings,
  installed AIs and models, recent errors) to paste when asking for help.
  Your *About you* text is left out. Also runs on its own:
  `python "%LOCALAPPDATA%\WriteAssist\waDiagnostics.py"`.
- Fixed "Couldn't read the reply as JSON (Invalid control character)" on
  texts with several paragraphs, when the AI put real line breaks in its reply.

## v02.11.00 - 2026-11-25

- Formatting bar on the result, like Teams' compose box: bold, italic,
  underline, strikethrough, bulleted and numbered lists, links (Ctrl+K) and
  clear formatting.
- Copy keeps the formatting for Teams, Outlook, Word and Gmail, and plain-text
  apps still get clean text. Word, PDF and Markdown exports keep it too, with
  clickable links.

## v02.10.00 - 2026-11-25

- Version history: every Review or Create saves the text and the result, and
  Ctrl+S (or *Save current draft*) saves the Draft by hand, with a label. The
  History panel restores, compares, copies, exports or deletes any version.
  The last 200 are kept, on this computer only (Settings turns it off or
  clears it).
- Export to Word, PDF, text or Markdown, from the result or any version, with
  an optional details block at the end (author, date, task, prompt, language,
  AI, "Made with Write Assist"). Save anywhere, or straight to OneDrive,
  Google Drive or Dropbox when they're installed.
- Settings: your name for exports, and the version history switch.

## v02.09.00 - 2026-11-25

- macOS, first pass (not yet tested on a Mac): `install.sh` installs Write
  Assist for the current user, with its own Python environment, the AI you
  choose, and Write Assist.app in ~/Applications. Shortcuts use ⌘. No global
  hotkey on Mac yet.
- Windows: no change in behavior; the code that differs between systems now
  lives in waPlatform.py.

## v02.08.03 - 2026-11-25

- The interface is now also in French (Settings > Interface language; by
  default the same as Windows), and dictation can be set to French.
- *Underline: spelling* also checks French when Windows has its French
  dictionary (French Windows, or French added in Windows' language settings).
- French texts are recognized as French (they were sometimes taken for
  Spanish), so reviews keep them in French and *English ⇄ Spanish*
  translates them into English.
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
