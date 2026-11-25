# Write Assist

**[Instrucciones en español](#en-español)**

A small Windows app that reviews and writes text with AI: messages, emails,
posts, docs. Paste what you wrote and get it proofread, or describe what you
need and get it written. It also has a context-aware thesaurus and offline
dictation, a translator, and an English or Spanish interface. It uses your existing Claude subscription through Claude Code, so
there are no API keys and nothing extra to pay.

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

The installer sets up Python (with the small pywebview package), the WebView2
runtime and Claude Code if they're missing, then opens Write Assist. No admin rights needed. On first launch it asks a little about
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
| **Mode** | Review only (grayed out when creating). *fix errors only*: spelling, typos, grammar, punctuation, with minimal edits. *fix and polish wording*: also smooths awkward or unclear phrasing. Anything the prompt asks for overrides it. |
| **Language** | The text's language and regional variant (English US/UK, Spanish Mexico/Spain, French, Portuguese, German, Italian). Review corrects for it (e.g. US vs UK spelling); Create writes in it. *Auto* lets the AI decide from the text and your *About you*. |
| **Tone** | `keep` (default), or lean it: more formal, more casual, friendlier, more concise. |
| **AI** | The AIs installed on this PC: Claude, and GitHub Copilot if its CLI is installed. If the chosen AI hits its usage limit, the request goes to the other one automatically and the status bar says so (turn off with `"auto_fallback": false` in `user_settings.json`). |
| **Model** | Claude: `haiku` (default, fastest and lightest on your plan's limits), `sonnet`, `opus` (strongest). Copilot: `auto`. *Other...* lets you enter any other model name the AI accepts. |
| **Thesaurus** | Select a word (or put the cursor on it) in Prompt, Draft or the result, then click *Thesaurus* at the top or press **Ctrl+T**: meaning, synonyms and antonyms that fit your sentence. Click a synonym or antonym to **Replace** your word with it or **Search** it in turn (← goes back). You can also type any word in the panel's search box. It asks the AI only when you look something up. |
| **Translate** | Select text (a word, a sentence, a paragraph) in Prompt, Draft or the result, then click *Translate* at the top or press **Ctrl+Shift+T**. Pick the target language; *English ⇄ Spanish* translates English into Spanish and anything else into English. Then **Replace selection**, **Use as draft** or **Copy**. For a single word it also offers other options; click one to swap it in. You can also type or paste text straight into the panel. It asks the AI only when you translate. |
| **Dictate** | Speak into Prompt or Draft; click again to stop (Esc cancels). Transcribed on your computer with faster-whisper: free, offline, private. The first time, it offers a one-time download (speech engine about 250 MB, plus the model: 465 MB for *small*). |
| **Settings** | *About you*, the global hotkey, the speech model and language, and the interface language (English or Spanish; by default the same as Windows). |

**Review** shows the corrected text with the edits highlighted, and below it
each change (old → new) with a short reason, plus an optional note (e.g. "this
may sound blunt for a client email"). **Create** shows the new text; anything
essential missing from the prompt is left as a placeholder like `[date]`.

Shortcuts: **Ctrl+Enter** run · **Ctrl+T** thesaurus · **Ctrl+Shift+T** translate · **Ctrl+Shift+V** paste the clipboard as the
draft and review · **Ctrl+Shift+C** copy the result. *Use as draft* moves the
result into Draft, to refine it with a new prompt. The result is editable, and
emojis are kept as they are.

The Draft is only ever treated as text to correct, never as instructions:
a pasted email saying "reply ASAP with the numbers" gets proofread, not
answered.

## En español

Write Assist es una pequeña app para Windows que revisa y escribe tus textos
con Claude: mensajes, correos, publicaciones. También tiene sinónimos,
traductor y dictado por voz.

**Qué necesitas**

- Una computadora con Windows 10 u 11.
- Un plan de pago de Claude (Pro o Max). El plan gratuito no funciona.

### Instalar (unos 5 minutos, solo una vez)

1. Haz clic en el botón de **Inicio**, escribe **PowerShell** y presiona
   **Enter**. Se abre una ventana con fondo oscuro.
2. Copia esta línea completa, pégala en esa ventana (con clic derecho se
   pega) y presiona **Enter**:

   ```powershell
   irm https://raw.githubusercontent.com/luigihmtz/write-assist/main/install.ps1 | iex
   ```

3. Espera mientras se instala. Verás texto en inglés pasando por la
   pantalla; es normal, y la primera vez puede tardar unos minutos. Si
   Windows te pide permiso para instalar algo, haz clic en **Sí**.
4. Tu navegador se abrirá y te pedirá iniciar sesión en Claude. Entra con tu
   cuenta de Claude de siempre y luego regresa a la ventana de PowerShell.
5. Cuando diga que terminó, presiona **Enter** para cerrarla. Write Assist
   se abre solo.
6. La primera vez te pregunta un poco sobre ti, como los idiomas en que
   escribes. Llénalo y haz clic en **Guardar**. Así escribe más como tú.

### Actualizar

1. Si Write Assist está abierto, ciérralo con la **X** de la esquina
   superior derecha.
2. Vuelve a abrirlo desde el menú Inicio, o con **tecla Windows + Ctrl + W**.
3. Si hay una versión nueva, en unos segundos aparece abajo un botón
   **Actualizar a v...** (o **Update to v...** si tu versión actual está en
   inglés).
4. Haz clic en él y luego en **Actualizar** (**Update**) para confirmar.
5. Se abre una ventana oscura que muestra el avance; no tienes que hacer
   nada ahí. Write Assist se cierra y se vuelve a abrir solo, ya
   actualizado.
6. Si esa ventana se queda abierta al final y te pide presionar Enter,
   presiona **Enter**.

### Cómo se usa

- Ábrelo desde el menú Inicio (**Write Assist**) o con **tecla Windows +
  Ctrl + W** desde cualquier lugar.
- **Para corregir un texto:** pégalo en **Borrador** y haz clic en
  **Revisar**. Luego haz clic en **Copiar** y pega el texto corregido donde
  lo necesites.
- **Para escribir algo nuevo:** deja el Borrador vacío, describe lo que
  necesitas en **Instrucciones** (por ejemplo "correo a mi casero pidiéndole
  que arregle el calentador") y haz clic en **Crear**.
- **Sinónimos** y **Traducir**, arriba a la derecha, funcionan con la
  palabra o el texto que selecciones primero.
- **Dictar** te deja hablar en lugar de escribir. La primera vez ofrece
  descargar el reconocimiento de voz (unos 700 MB, solo una vez); funciona
  sin internet y es privado.
- **Para tenerlo en la barra de tareas:** abre Inicio, haz clic derecho en
  **Write Assist** y elige **Anclar a la barra de tareas**.
- **El idioma de la app** sigue al de Windows. Puedes cambiarlo en
  **Ajustes > Idioma de la interfaz**.

### Desinstalar

Ve a **Configuración de Windows > Aplicaciones**, busca **Write Assist** y
haz clic en **Desinstalar**.

## Files

| File | Purpose |
|---|---|
| `writeAssist.pyw` | The app: the window (pywebview on WebView2) and the bridge the page calls. |
| `waCore.py` | Settings, Review/Create and Thesaurus requests to the AI CLIs, edit highlighting, update check. |
| `waSpeech.py` | Offline dictation with faster-whisper, installed on first use. |
| `ui/` | The window's page: `index.html`, `style.css`, `app.js`, and `i18n.js` with the English and Spanish interface text. |
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

The window is a local web page shown by pywebview in Microsoft's WebView2
(built into Windows 10/11); the page calls Python through
`window.pywebview.api`. Python grants the page microphone and clipboard
access without prompts.

Each run builds one request from the Prompt, Draft, Mode and Tone, adds
`system_prompt.md`, and sends it to the chosen AI's command-line tool in the
background. The AI gets no tools: it can't read files, run commands or browse.
The thesaurus and the translator are separate, small requests, sent only
when you use them, and cached for the session.

**Dictation** records in the page (MediaRecorder, webm/opus) and hands the
audio to faster-whisper on the CPU (int8). The model stays loaded while you
use it and is released after 10 idle minutes. Segments Whisper marks as
probably not speech are dropped, as are its typical phantom phrases on
near-silence ("Thank you.", "Gracias.").

**Claude:**

```
claude -p --safe-mode --no-session-persistence --model opus --effort low
       --system-prompt <system_prompt.md> --output-format json --json-schema <schema>
```

- `--safe-mode` skips CLAUDE.md, plugins, MCP servers and hooks, so the call
  is fast (~3–6 s) and nothing from other projects leaks into it.
- `--json-schema` makes Claude return `{text, changes[], notes}`.
- Don't pass `--tools ""` together with `--json-schema`: structured output
  needs its internal tool, and the call has hung. All of Claude Code's own
  tools are denied with `--disallowed-tools` instead. This also keeps requests
  small: every loaded tool's description is sent with each request, ~22k
  tokens in total, so a review would cost ~23k input tokens instead of ~3k.

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
