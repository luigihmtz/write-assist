// app.js
// Behavior of the Write Assist window: picks Review or Create from the
// filled fields, runs it through Python (window.pywebview.api), shows the
// result with highlighted edits, the on-demand thesaurus, speech-to-text
// recording, settings, and the update button.
//
// Author:  Luis Martinez
// Email:   luis@luigi.mx
// Version: v01.00.00
// Date:    2026-11-24
//
// Usage: loaded by ui/index.html. Every api.* call returns a Promise of
//        {ok: true, ...} or {ok: false, error}.

const $ = (id) => document.getElementById(id);
const api = () => window.pywebview.api;

const els = {
  mode: $("mode"), tone: $("tone"), provider: $("provider"), model: $("model"), modelList: $("modelList"),
  prompt: $("prompt"), draft: $("draft"), preset: $("preset"),
  result: $("result"), resultTitle: $("resultTitle"), changes: $("changes"),
  runBtn: $("runBtn"), autoCopy: $("autoCopy"), updateBtn: $("updateBtn"), status: $("status"),
  thesaurus: $("thesaurus"), thWord: $("thWord"), thBody: $("thBody"),
};

const app = {
  info: null,
  providers: {},
  models: {},           // last model per provider
  busy: false,
  task: null,
  lastField: "draft",   // last focused field, for Ctrl+T
  updateTag: null,
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.title = text;
  els.status.classList.toggle("error", isError);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function init() {
  const info = await api().init();
  if (!info.ok) { setStatus(info.error, true); return; }
  app.info = info;
  document.documentElement.style.setProperty("--fs", `${Math.round(info.font_size * 1.33)}px`);

  const state = info.state || {};
  app.models = state.models || {};
  for (const p of info.providers) app.providers[p.name] = p;
  const usable = info.providers.filter((p) => p.installed);
  for (const p of (usable.length ? usable : info.providers)) els.provider.add(new Option(p.name, p.name));
  const wanted = state.provider || info.default_provider;
  if ([...els.provider.options].some((o) => o.value === wanted)) els.provider.value = wanted;

  els.mode.value = state.mode || "fix";
  els.tone.value = state.tone || "keep";
  els.autoCopy.checked = state.auto_copy ?? info.auto_copy_default;
  for (const preset of info.presets) els.preset.add(new Option(preset, preset));

  showProviderModels();
  updateTask();
  els.draft.focus();

  if (info.needs_profile) openSettings(true);
  if (!info.is_dev) {
    setTimeout(checkForUpdate, 3000);
    setInterval(checkForUpdate, 6 * 3600 * 1000);
  }
}

function showProviderModels() {
  const p = app.providers[els.provider.value];
  if (!p) return;
  els.modelList.innerHTML = "";
  for (const m of p.models) els.modelList.append(new Option(m, m));
  els.model.value = app.models[p.name] || p.default_model || p.models[0] || "";
  if (p.installed) setStatus("Paste a draft to review, or write a prompt to create.");
  else setStatus(`${p.name} isn't installed. Run the Write Assist installer again.`, true);
}

function saveState() {
  app.models[els.provider.value] = els.model.value.trim();
  api().save_state({
    mode: els.mode.value, tone: els.tone.value, provider: els.provider.value,
    models: app.models, auto_copy: els.autoCopy.checked,
  });
}

// ---------------------------------------------------------------------------
// Review / Create
// ---------------------------------------------------------------------------
function detectTask() {
  if (els.draft.value.trim()) return "review";
  if (els.prompt.value.trim()) return "create";
  return null;
}

function updateTask() {
  const task = detectTask();
  if (task === app.task) return;
  app.task = task;
  const label = task === "create" ? "Create" : "Review";
  els.runBtn.innerHTML = `${label} <kbd>Ctrl+Enter</kbd>`;
  els.mode.disabled = task === "create";
}

async function run() {
  if (app.busy) return;
  const task = detectTask();
  if (!task) { setStatus("Paste a draft to review, or write a prompt to create."); return; }
  const provider = els.provider.value;
  const draft = els.draft.value;
  app.busy = true;
  els.runBtn.disabled = true;
  const started = Date.now();
  const verb = task === "review" ? "Reviewing" : "Writing";
  const timer = setInterval(() => setStatus(`${verb} with ${provider}... ${Math.round((Date.now() - started) / 1000)}s`), 250);
  try {
    const res = await api().run({
      provider, model: els.model.value, prompt: els.prompt.value, draft,
      mode: els.mode.value, tone: els.tone.value,
    });
    clearInterval(timer);
    if (!res.ok) { setStatus(res.error, true); return; }
    showResult(res);
  } finally {
    clearInterval(timer);
    app.busy = false;
    els.runBtn.disabled = false;
  }
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Python gives spans as code-point offsets; JS strings index UTF-16 units.
function spansToHtml(text, spans) {
  const points = Array.from(text);
  let html = "";
  let pos = 0;
  for (const [start, end] of spans) {
    html += escapeHtml(points.slice(pos, start).join(""));
    html += `<mark>${escapeHtml(points.slice(start, end).join(""))}</mark>`;
    pos = end;
  }
  return html + escapeHtml(points.slice(pos).join(""));
}

function showResult(res) {
  const title = res.task === "review" ? "Corrected" : "Written";
  els.resultTitle.textContent = `${title} (${res.provider})`;
  els.result.innerHTML = res.task === "review" ? spansToHtml(res.text, res.spans || []) : escapeHtml(res.text);

  els.changes.innerHTML = "";
  if (res.task === "review") {
    if (!res.changes.length) {
      els.changes.innerHTML = `<p class="ok">No changes needed. Looks good.</p>`;
    }
    for (const c of res.changes) {
      const p = document.createElement("p");
      p.innerHTML = `<span class="old">${escapeHtml(c.original)}</span> → ` +
        `<span class="new">${escapeHtml(c.fixed)}</span> <span class="why">${escapeHtml(c.reason || "")}</span>`;
      els.changes.append(p);
    }
  }
  if (res.notes) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = `Note: ${res.notes}`;
    els.changes.append(p);
  }

  let message = res.task === "review"
    ? `Reviewed with ${res.provider} · ${res.changes.length} change${res.changes.length === 1 ? "" : "s"}`
    : `Written with ${res.provider}`;
  message += ` · ${res.elapsed.toFixed(1)}s`;
  if (els.autoCopy.checked) { copyResult(true); message += " · copied"; }
  setStatus(message);
}

function resultText() {
  return els.result.innerText.replace(/\n$/, "");
}

async function copyResult(quiet = false) {
  const text = resultText();
  if (!text) return;
  const res = await api().clipboard_set(text);
  if (!quiet) setStatus(res.ok ? "Result copied." : res.error, !res.ok);
}

async function pasteAndReview() {
  const res = await api().clipboard_get();
  if (!res.ok) { setStatus(res.error, true); return; }
  if (!res.text) { setStatus("The clipboard has no text."); return; }
  els.draft.value = res.text;
  updateTask();
  run();
}

function useAsDraft() {
  const text = resultText();
  if (!text) return;
  els.draft.value = text;
  updateTask();
  els.draft.focus();
}

function clearAll() {
  els.prompt.value = "";
  els.draft.value = "";
  els.result.innerHTML = "";
  els.changes.innerHTML = "";
  els.resultTitle.textContent = "Result";
  setStatus("");
  updateTask();
  els.draft.focus();
}

// ---------------------------------------------------------------------------
// Thesaurus: only calls the AI when the user asks for it
// ---------------------------------------------------------------------------
const WORD_CHAR = /[\p{L}\p{N}'’-]/u;

function textareaSelection(area) {
  let start = area.selectionStart;
  let end = area.selectionEnd;
  const value = area.value;
  if (start === end) {  // no selection: take the word at the cursor
    while (start > 0 && WORD_CHAR.test(value[start - 1])) start--;
    while (end < value.length && WORD_CHAR.test(value[end])) end++;
  }
  const word = value.slice(start, end).trim();
  if (!word) return null;
  return {
    word, context: value.slice(Math.max(0, start - 160), Math.min(value.length, end + 160)),
    replace: (text) => {
      area.focus();
      area.setSelectionRange(start, end);
      area.setRangeText(text, start, end, "end");
      area.dispatchEvent(new Event("input"));
    },
  };
}

function resultSelection() {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed || !els.result.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0).cloneRange();
  const word = range.toString().trim();
  if (!word) return null;
  const all = resultText();
  const at = all.indexOf(word);
  const context = at >= 0 ? all.slice(Math.max(0, at - 160), at + word.length + 160) : all.slice(0, 320);
  return {
    word, context,
    replace: (text) => {
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      els.result.normalize();
    },
  };
}

function matchCase(original, replacement) {
  if (original && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function placePopover(field) {
  const card = (field === "result" ? els.result : els[field]).closest(".card").getBoundingClientRect();
  const width = 360;
  const left = Math.min(Math.max(8, card.right - width - 8), window.innerWidth - width - 8);
  els.thesaurus.style.left = `${left}px`;
  els.thesaurus.style.top = `${Math.max(8, card.top + 40)}px`;
}

function closeThesaurus() { els.thesaurus.hidden = true; }

async function openThesaurus(field) {
  const target = field === "result" ? resultSelection() : textareaSelection(els[field]);
  if (!target) { setStatus("Select a word (or put the cursor on it), then click Thesaurus."); return; }
  if (target.word.split(/\s+/).length > 4) { setStatus("Select a single word or a short phrase for the thesaurus."); return; }

  placePopover(field);
  els.thWord.textContent = target.word;
  els.thBody.innerHTML = `<p class="muted">Looking it up with ${escapeHtml(els.provider.value)}...</p>`;
  els.thesaurus.hidden = false;

  const res = await api().thesaurus({
    word: target.word, context: target.context, provider: els.provider.value, model: els.model.value,
  });
  if (els.thesaurus.hidden || els.thWord.textContent !== target.word) return;  // closed or replaced meanwhile
  if (!res.ok) { els.thBody.innerHTML = `<p class="error">${escapeHtml(res.error)}</p>`; return; }

  els.thBody.innerHTML = "";
  if (res.meanings.length) {
    els.thBody.insertAdjacentHTML("beforeend", "<h3>Meaning</h3>");
    for (const m of res.meanings) {
      els.thBody.insertAdjacentHTML("beforeend",
        `<p class="meaning"><span class="pos">${escapeHtml(m.part_of_speech || "")}</span>${escapeHtml(m.definition || "")}</p>`);
    }
  }
  for (const [title, words] of [["Synonyms", res.synonyms], ["Antonyms", res.antonyms]]) {
    els.thBody.insertAdjacentHTML("beforeend", `<h3>${title}</h3>`);
    if (!words.length) { els.thBody.insertAdjacentHTML("beforeend", `<p class="muted">None</p>`); continue; }
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const w of words) {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = w;
      chip.title = `Replace "${target.word}" with "${w}"`;
      chip.addEventListener("click", () => {
        target.replace(matchCase(target.word, w));
        closeThesaurus();
        setStatus(`Replaced "${target.word}" with "${w}".`);
      });
      chips.append(chip);
    }
    els.thBody.append(chips);
  }
}

// ---------------------------------------------------------------------------
// Speech-to-text (offline, faster-whisper in Python)
// ---------------------------------------------------------------------------
const MIC_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg>';
const MIC_LABEL = `${MIC_ICON}<span>Dictate</span>`;

const rec = { recorder: null, stream: null, chunks: [], button: null, target: null, caret: 0, timer: null, cancelled: false };

function confirmBox(title, text, yesLabel = "OK") {
  return new Promise((resolve) => {
    const dialog = $("confirmDialog");
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("confirmYes").textContent = yesLabel;
    const done = (answer) => { dialog.close(); resolve(answer); };
    $("confirmYes").onclick = () => done(true);
    $("confirmNo").onclick = () => done(false);
    dialog.oncancel = () => resolve(false);
    dialog.showModal();
  });
}

async function ensureSpeech(button) {
  const info = await api().speech_info();
  if (!info.ok) { setStatus(info.error, true); return false; }
  if (info.installed && info.model_cached) return true;
  const ok = await confirmBox(
    "Set up speech-to-text?",
    `Dictation runs on this computer: free, offline and private. It needs a one-time download of about ` +
    `${info.download_mb} MB (speech engine and the "${info.model}" model). You can pick a lighter model in Settings.`,
    "Download");
  if (!ok) return false;
  if (!info.installed) {
    button.classList.add("busy");
    setStatus("Installing the speech engine (one time, a few minutes)...");
    const res = await api().install_speech();
    button.classList.remove("busy");
    if (!res.ok) { setStatus(res.error, true); return false; }
  }
  app.speechNeedsModel = !info.model_cached;
  setStatus("Speech engine ready. Recording...");
  return true;
}

async function toggleRecording(button) {
  if (rec.recorder) { stopRecording(); return; }
  if (button.classList.contains("busy")) return;
  if (!(await ensureSpeech(button))) return;

  const target = els[button.dataset.target];
  try {
    rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    setStatus(`Can't use the microphone (${err.name}). Check Windows Settings > Privacy > Microphone.`, true);
    return;
  }
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
  rec.recorder = new MediaRecorder(rec.stream, mime ? { mimeType: mime } : undefined);
  rec.chunks = [];
  rec.button = button;
  rec.target = target;
  rec.caret = target.selectionStart ?? target.value.length;
  rec.cancelled = false;
  rec.recorder.ondataavailable = (e) => { if (e.data.size) rec.chunks.push(e.data); };
  rec.recorder.onstop = () => finishRecording(rec.recorder.mimeType);
  rec.recorder.start();

  const started = Date.now();
  button.classList.add("recording");
  const tick = () => {
    const s = Math.round((Date.now() - started) / 1000);
    button.innerHTML = `${MIC_ICON}<span>Stop ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}</span>`;
    setStatus("Recording... click the button again to stop (Esc cancels).");
    if (s >= 300) stopRecording();  // 5 minutes max
  };
  tick();
  rec.timer = setInterval(tick, 500);
}

function stopRecording(cancel = false) {
  if (!rec.recorder) return;
  rec.cancelled = cancel;
  clearInterval(rec.timer);
  rec.recorder.stop();
  rec.stream.getTracks().forEach((t) => t.stop());
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function insertAtCaret(area, caret, text) {
  const before = area.value.slice(0, caret);
  const after = area.value.slice(caret);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  area.value = before + lead + text + trail + after;
  const pos = (before + lead + text).length;
  area.focus();
  area.setSelectionRange(pos, pos);
  area.dispatchEvent(new Event("input"));
}

async function finishRecording(mime) {
  const { button, target, caret, chunks, cancelled } = rec;
  rec.recorder = null;
  button.classList.remove("recording");
  button.innerHTML = MIC_LABEL;
  if (cancelled) { setStatus("Recording cancelled."); return; }
  if (!chunks.length) { setStatus("Nothing was recorded."); return; }

  button.classList.add("busy");
  setStatus(app.speechNeedsModel
    ? "Downloading the speech model (one time), then transcribing..."
    : "Transcribing...");
  const audio = await blobToBase64(new Blob(chunks, { type: mime }));
  const res = await api().transcribe(audio, mime);
  button.classList.remove("busy");
  app.speechNeedsModel = false;
  if (!res.ok) { setStatus(res.error, true); return; }
  if (!res.text) { setStatus("No speech was recognized. Try again, a little closer to the microphone."); return; }
  insertAtCaret(target, caret, res.text);
  setStatus("Dictation added.");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function openSettings(firstRun = false) {
  const res = await api().get_settings();
  if (!res.ok) { setStatus(res.error, true); return; }
  $("settingsTitle").textContent = firstRun ? "Welcome to Write Assist" : "Settings";
  $("welcomeText").hidden = !firstRun;
  $("settingsCancel").textContent = firstRun ? "Skip" : "Cancel";
  $("profile").value = res.profile;
  $("hotkey").value = res.hotkey;
  $("speechModel").value = res.speech_model;
  $("speechLanguage").value = res.speech_language;
  $("versionText").textContent = `Version ${res.version}` + (res.is_dev ? " (development copy, no automatic updates)" : "");
  $("settingsError").hidden = true;
  const dialog = $("settingsDialog");
  dialog.dataset.firstRun = firstRun ? "1" : "";
  dialog.showModal();
  $("profile").focus();
}

async function closeSettings(save) {
  const dialog = $("settingsDialog");
  if (!save) {
    if (dialog.dataset.firstRun) await api().skip_profile();
    dialog.close();
    return;
  }
  const res = await api().save_settings({
    profile: $("profile").value, hotkey: $("hotkey").value,
    speech_model: $("speechModel").value, speech_language: $("speechLanguage").value,
  });
  if (!res.ok) { $("settingsError").textContent = res.error; $("settingsError").hidden = false; return; }
  if (res.hotkey_changed && !res.hotkey_ok) {
    $("settingsError").textContent = `Saved, but the hotkey couldn't be set: ${res.hotkey_message}. Try another one.`;
    $("settingsError").hidden = false;
    return;
  }
  dialog.close();
  setStatus(res.hotkey_changed ? `Settings saved. Hotkey: ${res.hotkey_message}` : "Settings saved.");
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------
async function checkForUpdate() {
  const res = await api().check_update();
  if (!res.ok || !res.tag) return;
  app.updateTag = res.tag;
  els.updateBtn.textContent = `Update to ${res.tag}`;
  els.updateBtn.hidden = false;
}

async function startUpdate() {
  const ok = await confirmBox(
    "Update Write Assist?",
    `Update from ${app.info.version} to ${app.updateTag}? The app closes, a window shows the update, and the app opens again.`,
    "Update");
  if (!ok) return;
  const res = await api().start_update();
  if (!res.ok) setStatus(`Couldn't start the update: ${res.error}`, true);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function wire() {
  els.runBtn.addEventListener("click", run);
  $("pasteBtn").addEventListener("click", pasteAndReview);
  $("clearBtn").addEventListener("click", clearAll);
  $("copyBtn").addEventListener("click", () => copyResult());
  $("useDraftBtn").addEventListener("click", useAsDraft);
  $("settingsBtn").addEventListener("click", () => openSettings(false));
  $("settingsSave").addEventListener("click", () => closeSettings(true));
  $("settingsCancel").addEventListener("click", () => closeSettings(false));
  $("settingsDialog").addEventListener("cancel", (e) => { e.preventDefault(); closeSettings(false); });
  $("thClose").addEventListener("click", closeThesaurus);
  els.updateBtn.addEventListener("click", startUpdate);

  for (const el of [els.prompt, els.draft]) el.addEventListener("input", updateTask);
  for (const field of ["prompt", "draft"]) els[field].addEventListener("focus", () => { app.lastField = field; });
  els.result.addEventListener("focus", () => { app.lastField = "result"; });
  els.result.addEventListener("mouseup", () => { app.lastField = "result"; });

  els.provider.addEventListener("change", () => { showProviderModels(); saveState(); });
  for (const el of [els.mode, els.tone, els.model, els.autoCopy]) el.addEventListener("change", saveState);

  els.preset.addEventListener("change", () => {
    const text = els.preset.value;
    els.preset.value = "";
    if (!text) return;
    els.prompt.value = `${els.prompt.value.trimEnd()}\n${text}`.trim();
    updateTask();
    els.prompt.focus();
  });

  document.querySelectorAll("[data-thesaurus]").forEach((b) =>
    b.addEventListener("mousedown", (e) => e.preventDefault()));  // keep the selection
  document.querySelectorAll("[data-thesaurus]").forEach((b) =>
    b.addEventListener("click", () => openThesaurus(b.dataset.thesaurus)));
  document.querySelectorAll(".mic").forEach((b) => {
    b.innerHTML = MIC_LABEL;
    b.addEventListener("click", () => toggleRecording(b));
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); run(); }
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "v") { e.preventDefault(); pasteAndReview(); }
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") { e.preventDefault(); copyResult(); }
    else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "t") { e.preventDefault(); openThesaurus(app.lastField); }
    else if (e.key === "Escape") {
      if (rec.recorder) stopRecording(true);
      else if (!els.thesaurus.hidden) closeThesaurus();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (!els.thesaurus.hidden && !els.thesaurus.contains(e.target) && !e.target.closest("[data-thesaurus]")) closeThesaurus();
  });
}

window.WA = { focusDraft: () => els.draft.focus() };
wire();
window.addEventListener("pywebviewready", init);
