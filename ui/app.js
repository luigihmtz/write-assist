// app.js
// Behavior of the Write Assist window: picks Review or Create from the
// filled fields, runs it through Python (window.pywebview.api), shows the
// result with highlighted edits, the on-demand thesaurus and translator,
// speech-to-text recording, settings, interface language, and updates.
//
// Author:  Luis Martinez
// Email:   16788942+luigihmtz@users.noreply.github.com
// Version: v01.05.02
// Date:    2026-11-24
//
// Usage: loaded by ui/index.html after i18n.js (t(), applyLanguage()). Every
//        api.* call returns a Promise of {ok: true, ...} or {ok: false, error}.

const $ = (id) => document.getElementById(id);
const api = () => window.pywebview.api;

const els = {
  mode: $("mode"), tone: $("tone"), textLanguage: $("textLanguage"),
  provider: $("provider"), model: $("model"),
  prompt: $("prompt"), draft: $("draft"), preset: $("preset"),
  result: $("result"), resultTitle: $("resultTitle"), changes: $("changes"),
  runBtn: $("runBtn"), autoCopy: $("autoCopy"), updateBtn: $("updateBtn"), status: $("status"),
  thesaurus: $("thesaurus"), thSearch: $("thSearch"), thBack: $("thBack"), thBody: $("thBody"), thMenu: $("thMenu"),
  translate: $("translatePanel"), trTarget: $("trTarget"), trSource: $("trSource"), trOut: $("trOut"),
  trMeta: $("trMeta"), trText: $("trText"), trAltBlock: $("trAltBlock"), trAlts: $("trAlts"), trNote: $("trNote"),
};

const app = {
  info: null,
  providers: {},
  models: {},           // last model per provider
  busy: false,
  task: undefined,
  lastField: "draft",   // last focused field, for the thesaurus and translator
  updateTag: null,
  uiLanguage: "",       // "" follows Windows
  microphone: "",       // name of the dictation microphone; "" is the Windows default
  resultTitle: null,    // {key, provider} of the shown result
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
// Startup and interface language
// ---------------------------------------------------------------------------
async function init() {
  const info = await api().init();
  if (!info.ok) { setStatus(info.error, true); return; }
  app.info = info;
  document.documentElement.style.setProperty("--fs", `${Math.round(info.font_size * 1.33)}px`);
  setUiLanguage(info.ui_language || "");
  app.microphone = info.microphone || "";

  const state = info.state || {};
  // models_rev 2: Claude's default became haiku; forget models saved before that.
  app.models = state.models_rev === 2 ? (state.models || {}) : {};
  for (const p of info.providers) app.providers[p.name] = p;
  const usable = info.providers.filter((p) => p.installed);
  for (const p of (usable.length ? usable : info.providers)) els.provider.add(new Option(p.name, p.name));
  const wanted = state.provider || info.default_provider;
  if ([...els.provider.options].some((o) => o.value === wanted)) els.provider.value = wanted;

  els.mode.value = state.mode || "fix";
  els.tone.value = state.tone || "keep";
  els.textLanguage.value = state.text_language || "auto";
  els.trTarget.value = state.translate_target || "auto";
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

// Applies the interface language and redraws the text that app.js builds.
function setUiLanguage(setting) {
  app.uiLanguage = setting;
  applyLanguage(setting);
  document.querySelectorAll(".mic").forEach((b) => { if (!b.classList.contains("recording")) b.innerHTML = micLabel(); });
  app.task = undefined;
  updateTask();
  renderResultTitle();
  const other = els.model.querySelector(`option[value="${OTHER_MODEL}"]`);
  if (other) other.textContent = t("model.other");
  if (app.updateTag) els.updateBtn.textContent = t("update.button", { tag: app.updateTag });
}

function showProviderModels() {
  const p = app.providers[els.provider.value];
  if (!p) return;
  fillModels(p, app.models[p.name] || p.default_model || p.models[0] || "");
  if (p.installed) setStatus(t("status.empty"));
  else setStatus(t("status.notInstalled", { provider: p.name }), true);
}

// The provider's models, plus a model typed earlier with "Other...", plus "Other...".
const OTHER_MODEL = "__other__";

function fillModels(p, selected) {
  els.model.innerHTML = "";
  const names = [...p.models];
  if (selected && !names.includes(selected)) names.push(selected);
  for (const m of names) els.model.add(new Option(m, m));
  els.model.add(new Option(t("model.other"), OTHER_MODEL));
  els.model.value = selected || names[0] || "";
  els.model.dataset.previous = els.model.value;
}

function onModelChange() {
  if (els.model.value === OTHER_MODEL) {
    const name = (window.prompt(t("model.otherPrompt")) || "").trim();
    if (!name) { els.model.value = els.model.dataset.previous || ""; return; }
    fillModels(app.providers[els.provider.value], name);
  }
  els.model.dataset.previous = els.model.value;
  saveState();
}

function saveState() {
  app.models[els.provider.value] = els.model.value.trim();
  api().save_state({
    mode: els.mode.value, tone: els.tone.value, provider: els.provider.value,
    text_language: els.textLanguage.value, translate_target: els.trTarget.value,
    models: app.models, models_rev: 2, auto_copy: els.autoCopy.checked,
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
  const label = task === "create" ? t("run.create") : t("run.review");
  els.runBtn.innerHTML = `${escapeHtml(label)} <kbd>Ctrl+Enter</kbd>`;
  els.mode.disabled = task === "create";
}

async function run() {
  if (app.busy) return;
  const task = detectTask();
  if (!task) { setStatus(t("status.empty")); return; }
  const provider = els.provider.value;
  const draft = els.draft.value;
  app.busy = true;
  els.runBtn.disabled = true;
  const started = Date.now();
  const key = task === "review" ? "status.reviewing" : "status.writing";
  const timer = setInterval(() => setStatus(t(key, { provider, seconds: Math.round((Date.now() - started) / 1000) })), 250);
  try {
    const res = await api().run({
      provider, model: els.model.value, prompt: els.prompt.value, draft,
      mode: els.mode.value, tone: els.tone.value, language: els.textLanguage.value,
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
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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

function renderResultTitle() {
  const r = app.resultTitle;
  els.resultTitle.textContent = r ? t(r.key, { provider: r.provider }) : t("result");
}

function showResult(res) {
  app.resultTitle = { key: res.task === "review" ? "result.corrected" : "result.written", provider: res.provider };
  renderResultTitle();
  els.result.innerHTML = res.task === "review" ? spansToHtml(res.text, res.spans || []) : escapeHtml(res.text);

  els.changes.innerHTML = "";
  if (res.task === "review") {
    if (!res.changes.length) {
      els.changes.innerHTML = `<p class="ok">${escapeHtml(t("changes.none"))}</p>`;
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
    p.textContent = t("changes.note", { text: res.notes });
    els.changes.append(p);
  }

  const parts = [];
  if (res.fallback_from) parts.push(fallbackNote(res));
  parts.push(res.task === "review"
    ? t(res.changes.length === 1 ? "status.reviewedOne" : "status.reviewed", { provider: res.provider, count: res.changes.length })
    : t("status.written", { provider: res.provider }));
  parts.push(`${res.elapsed.toFixed(1)}s`);
  if (els.autoCopy.checked) { copyResult(true); parts.push(t("status.copiedSuffix")); }
  setStatus(parts.join(" · "));
}

// "Claude hit a usage limit (...), used GitHub Copilot" when the backup AI answered.
function fallbackNote(res) {
  if (!res.fallback_from) return "";
  const why = res.limit_note ? ` (${res.limit_note})` : "";
  return t("status.fallback", { from: res.fallback_from, why, provider: res.provider });
}

function resultText() {
  return els.result.innerText.replace(/\n$/, "");
}

async function copyText(text, quiet = false) {
  if (!text) return;
  const res = await api().clipboard_set(text);
  if (!quiet) setStatus(res.ok ? t("status.copied") : res.error, !res.ok);
}

function copyResult(quiet = false) { return copyText(resultText(), quiet); }

async function pasteAndReview() {
  const res = await api().clipboard_get();
  if (!res.ok) { setStatus(res.error, true); return; }
  if (!res.text) { setStatus(t("status.clipboardEmpty")); return; }
  els.draft.value = res.text;
  updateTask();
  run();
}

function setDraft(text) {
  if (!text) return;
  els.draft.value = text;
  updateTask();
  els.draft.focus();
}

function useAsDraft() { setDraft(resultText()); }

function clearAll() {
  els.prompt.value = "";
  els.draft.value = "";
  els.result.innerHTML = "";
  els.changes.innerHTML = "";
  app.resultTitle = null;
  renderResultTitle();
  setStatus("");
  updateTask();
  els.draft.focus();
}

// ---------------------------------------------------------------------------
// Selection in Prompt, Draft or the result (thesaurus and translator)
// ---------------------------------------------------------------------------
const WORD_CHAR = /[\p{L}\p{N}'’-]/u;

// {word, context, replace(text)} for the selection, or the word at the cursor.
function textareaSelection(area) {
  let start = area.selectionStart;
  let end = area.selectionEnd;
  const value = area.value;
  if (start === end) {  // no selection: take the word at the cursor
    while (start > 0 && WORD_CHAR.test(value[start - 1])) start--;
    while (end < value.length && WORD_CHAR.test(value[end])) end++;
  }
  while (start < end && /\s/.test(value[start])) start++;   // leave surrounding spaces alone
  while (end > start && /\s/.test(value[end - 1])) end--;
  const word = value.slice(start, end);
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

function selectedTarget() {
  const field = app.lastField;
  return field === "result" ? resultSelection() : textareaSelection(els[field]);
}

function matchCase(original, replacement) {
  if (original && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// Both panels open under the toolbar, on the right; only one at a time.
function placePanel(panel) {
  const bar = document.querySelector(".toolbar").getBoundingClientRect();
  const width = Math.min(400, window.innerWidth - 16);
  panel.style.width = `${width}px`;
  panel.style.left = `${Math.max(8, window.innerWidth - width - 14)}px`;
  panel.style.top = `${bar.bottom + 4}px`;
}

function closePanels() {
  closeThesaurus();
  closeTranslate();
}

// ---------------------------------------------------------------------------
// Thesaurus: only calls the AI when the user asks for it
// ---------------------------------------------------------------------------
// Panel state: the word in the text that Replace swaps (null when the user
// only typed a word), the words looked up before (for Back), the current one.
const th = { target: null, history: [], current: "", seq: 0, chipWord: "" };

function closeThesaurus() {
  hideChipMenu();
  els.thesaurus.hidden = true;
  th.seq++;  // ignore answers still on their way
}

function openThesaurus() {
  const target = selectedTarget();
  if (target && target.word.split(/\s+/).length > 4) {
    setStatus(t("th.tooLong"));
    return;
  }
  closeTranslate();
  th.target = target;
  th.history = [];
  th.current = "";
  placePanel(els.thesaurus);
  els.thesaurus.hidden = false;
  if (target) { lookup(target.word); return; }
  els.thSearch.value = "";
  els.thBack.hidden = true;
  hideChipMenu();
  els.thBody.innerHTML = `<p class="muted">${escapeHtml(t("th.empty"))}</p>`;
  els.thSearch.focus();
}

async function lookup(word, fromBack = false) {
  word = word.trim();
  if (!word) return;
  if (!fromBack && th.current && th.current.toLowerCase() !== word.toLowerCase()) th.history.push(th.current);
  th.current = word;
  els.thSearch.value = word;
  els.thBack.hidden = !th.history.length;
  hideChipMenu();
  const seq = ++th.seq;
  els.thBody.innerHTML = `<p class="muted">${escapeHtml(t("th.looking", { word, provider: els.provider.value }))}</p>`;

  const res = await api().thesaurus({
    word, context: th.target ? th.target.context : "", provider: els.provider.value, model: els.model.value,
  });
  if (seq !== th.seq) return;  // closed or another word looked up meanwhile
  if (!res.ok) { els.thBody.innerHTML = `<p class="error">${escapeHtml(res.error)}</p>`; return; }
  if (res.fallback_from) setStatus(fallbackNote(res));

  els.thBody.innerHTML = "";
  if (th.target) {
    els.thBody.insertAdjacentHTML("beforeend",
      `<p class="th-target muted">${escapeHtml(t("th.target", { word: th.target.word }))}</p>`);
  }
  if (res.meanings.length) {
    els.thBody.insertAdjacentHTML("beforeend", `<h3>${escapeHtml(t("th.meaning"))}</h3>`);
    for (const m of res.meanings) {
      els.thBody.insertAdjacentHTML("beforeend",
        `<p class="meaning"><span class="pos">${escapeHtml(m.part_of_speech || "")}</span>${escapeHtml(m.definition || "")}</p>`);
    }
  }
  for (const [title, words] of [[t("th.synonyms"), res.synonyms], [t("th.antonyms"), res.antonyms]]) {
    els.thBody.insertAdjacentHTML("beforeend", `<h3>${escapeHtml(title)}</h3>`);
    if (!words.length) { els.thBody.insertAdjacentHTML("beforeend", `<p class="muted">${escapeHtml(t("th.none"))}</p>`); continue; }
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const w of words) {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = w;
      chip.addEventListener("click", () => showChipMenu(chip, w));
      chips.append(chip);
    }
    els.thBody.append(chips);
  }
}

// Replace / Search choice under a clicked synonym or antonym.
function showChipMenu(chip, word) {
  th.chipWord = word;
  els.thBody.querySelectorAll(".chip.active").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  $("thReplace").hidden = !th.target;
  if (th.target) $("thReplace").title = t("th.replace.title", { old: th.target.word, new: word });
  $("thLookup").title = t("th.lookup.title", { word });
  els.thMenu.hidden = false;
  const r = chip.getBoundingClientRect();
  els.thMenu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - els.thMenu.offsetWidth - 8))}px`;
  els.thMenu.style.top = `${r.bottom + 4}px`;
}

function hideChipMenu() {
  els.thMenu.hidden = true;
  els.thBody.querySelectorAll(".chip.active").forEach((c) => c.classList.remove("active"));
}

function replaceWithChip() {
  const { target } = th;
  if (!target) return;
  const word = matchCase(target.word, th.chipWord);
  target.replace(word);
  closeThesaurus();
  setStatus(t("th.replaced", { old: target.word, new: word }));
}

// ---------------------------------------------------------------------------
// Translate: only calls the AI when the user asks for it
// ---------------------------------------------------------------------------
// target: the selection Replace swaps (null when the text was typed); source:
// the text that target holds, so Replace is only offered while it's unchanged.
const tr = { target: null, source: "", seq: 0 };

function closeTranslate() {
  els.translate.hidden = true;
  tr.seq++;
}

function openTranslate() {
  const target = selectedTarget();
  closeThesaurus();
  tr.target = target;
  tr.source = target ? target.word : "";
  els.trSource.value = tr.source;
  els.trOut.hidden = true;
  placePanel(els.translate);
  els.translate.hidden = false;
  if (target) translateNow();
  else els.trSource.focus();
}

async function translateNow() {
  const text = els.trSource.value.trim();
  if (!text) { els.trSource.focus(); return; }
  const seq = ++tr.seq;
  els.trOut.hidden = false;
  els.trMeta.textContent = t("tr.working", { provider: els.provider.value });
  els.trText.textContent = "";
  els.trAltBlock.hidden = true;
  els.trNote.hidden = true;
  $("trReplace").hidden = true;

  const fromSelection = tr.target && text === tr.source.trim();
  const res = await api().translate({
    text, target: els.trTarget.value, context: fromSelection ? tr.target.context : "",
    provider: els.provider.value, model: els.model.value,
  });
  if (seq !== tr.seq) return;
  if (!res.ok) { els.trMeta.textContent = ""; els.trText.innerHTML = `<span class="error">${escapeHtml(res.error)}</span>`; return; }
  if (res.fallback_from) setStatus(fallbackNote(res));

  els.trMeta.textContent = res.source_language && res.target_language
    ? t("tr.meta", { from: res.source_language, to: res.target_language }) : "";
  els.trText.textContent = res.translation;
  els.trAlts.innerHTML = "";
  for (const alt of res.alternatives) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = alt;
    chip.addEventListener("click", () => {  // swap: the alternative becomes the translation
      chip.textContent = els.trText.textContent;
      els.trText.textContent = alt;
    });
    els.trAlts.append(chip);
  }
  els.trAltBlock.hidden = !res.alternatives.length;
  els.trNote.textContent = res.notes;
  els.trNote.hidden = !res.notes;
  $("trReplace").hidden = !fromSelection;
}

function replaceWithTranslation() {
  const text = els.trText.textContent;
  if (!tr.target || !text) return;
  tr.target.replace(text);
  closeTranslate();
  setStatus(t("tr.replaced"));
}

// ---------------------------------------------------------------------------
// Speech-to-text (offline, faster-whisper in Python)
// ---------------------------------------------------------------------------
const MIC_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg>';
const micLabel = () => `${MIC_ICON}<span>${escapeHtml(t("dictate"))}</span>`;

const rec = { recorder: null, stream: null, chunks: [], button: null, target: null, caret: 0, timer: null, cancelled: false, note: "" };

function confirmBox(title, text, yesLabel = t("ok")) {
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
  const ok = await confirmBox(t("speech.setupTitle"),
    t("speech.setupText", { mb: info.download_mb, model: info.model }), t("speech.download"));
  if (!ok) return false;
  if (!info.installed) {
    button.classList.add("busy");
    setStatus(t("speech.installing"));
    const res = await api().install_speech();
    button.classList.remove("busy");
    if (!res.ok) { setStatus(res.error, true); return false; }
  }
  app.speechNeedsModel = !info.model_cached;
  setStatus(t("speech.ready"));
  return true;
}

// Input devices with their names. Names stay hidden until the page has used
// the microphone once, so if they're missing the mic is opened for a moment.
async function listMicrophones() {
  const inputs = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  let devices = await inputs();
  if (devices.length && !devices.some((d) => d.label)) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch { /* no permission or no microphone: names stay hidden */ }
    devices = await inputs();
  }
  // "default" and "communications" are aliases of real devices, listed again by name.
  return devices.filter((d) => d.label && d.deviceId !== "default" && d.deviceId !== "communications");
}

// The microphone chosen in Settings, found by name (device ids change between
// sessions), or the Windows default. Sets rec.note when the chosen one is missing.
async function openMicrophone() {
  rec.note = "";
  if (app.microphone) {
    const mic = (await listMicrophones()).find((d) => d.label === app.microphone);
    if (mic) return navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: mic.deviceId } } });
    rec.note = t("speech.micMissing", { name: app.microphone });
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

async function toggleRecording(button) {
  if (rec.recorder) { stopRecording(); return; }
  if (button.classList.contains("busy")) return;
  if (!(await ensureSpeech(button))) return;

  const target = els[button.dataset.target];
  try {
    rec.stream = await openMicrophone();
  } catch (err) {
    setStatus(t("speech.noMic", { error: err.name }), true);
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
    const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    button.innerHTML = `${MIC_ICON}<span>${escapeHtml(t("dictate.stop", { time }))}</span>`;
    setStatus(rec.note ? `${t("speech.recording")} ${rec.note}` : t("speech.recording"));
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
  rec.stream.getTracks().forEach((track) => track.stop());
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
  button.innerHTML = micLabel();
  if (cancelled) { setStatus(t("speech.cancelled")); return; }
  if (!chunks.length) { setStatus(t("speech.nothing")); return; }

  button.classList.add("busy");
  setStatus(app.speechNeedsModel ? t("speech.downloadingModel") : t("speech.transcribing"));
  const audio = await blobToBase64(new Blob(chunks, { type: mime }));
  const res = await api().transcribe(audio, mime);
  button.classList.remove("busy");
  app.speechNeedsModel = false;
  if (!res.ok) { setStatus(res.error, true); return; }
  if (!res.text) { setStatus(t("speech.noSpeech")); return; }
  insertAtCaret(target, caret, res.text);
  setStatus(t("speech.added"));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function openSettings(firstRun = false) {
  const res = await api().get_settings();
  if (!res.ok) { setStatus(res.error, true); return; }
  $("settingsTitle").textContent = firstRun ? t("settings.welcome") : t("settings");
  $("welcomeText").hidden = !firstRun;
  $("settingsCancel").textContent = firstRun ? t("skip") : t("cancel");
  $("profile").value = res.profile;
  $("hotkey").value = res.hotkey;
  $("speechModel").value = res.speech_model;
  $("speechLanguage").value = res.speech_language;
  $("uiLanguage").value = res.ui_language || "";
  fillMicrophones(res.microphone || "");
  $("versionText").textContent = t("settings.version", { version: res.version }) + (res.is_dev ? t("settings.devCopy") : "");
  $("settingsError").hidden = true;
  const dialog = $("settingsDialog");
  dialog.dataset.firstRun = firstRun ? "1" : "";
  dialog.showModal();
  $("profile").focus();
}

// Fills the Settings microphone list; a saved microphone that isn't plugged in stays listed.
async function fillMicrophones(selected) {
  const select = $("microphone");
  while (select.options.length > 1) select.remove(1);
  const names = (await listMicrophones()).map((d) => d.label);
  if (selected && !names.includes(selected)) names.push(selected);
  // Shown without the USB id Chromium appends, e.g. "(0951:16a4)"; saved with it.
  for (const name of names) select.add(new Option(name.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, ""), name));
  select.value = selected;
}

async function closeSettings(save) {
  const dialog = $("settingsDialog");
  if (!save) {
    if (dialog.dataset.firstRun) await api().skip_profile();
    dialog.close();
    return;
  }
  const uiLanguage = $("uiLanguage").value;
  const res = await api().save_settings({
    profile: $("profile").value, hotkey: $("hotkey").value,
    speech_model: $("speechModel").value, speech_language: $("speechLanguage").value,
    ui_language: uiLanguage, microphone: $("microphone").value,
  });
  if (!res.ok) { $("settingsError").textContent = res.error; $("settingsError").hidden = false; return; }
  app.microphone = $("microphone").value;
  if (uiLanguage !== app.uiLanguage) setUiLanguage(uiLanguage);
  if (res.hotkey_changed && !res.hotkey_ok) {
    $("settingsError").textContent = t("settings.hotkeyFailed", { message: res.hotkey_message });
    $("settingsError").hidden = false;
    return;
  }
  dialog.close();
  setStatus(res.hotkey_changed ? t("status.settingsSavedHotkey", { message: res.hotkey_message }) : t("status.settingsSaved"));
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------
async function checkForUpdate() {
  const res = await api().check_update();
  if (!res.ok || !res.tag) return;
  app.updateTag = res.tag;
  els.updateBtn.textContent = t("update.button", { tag: res.tag });
  els.updateBtn.hidden = false;
}

async function startUpdate() {
  const ok = await confirmBox(t("update.title"),
    t("update.text", { from: app.info.version, to: app.updateTag }), t("update.yes"));
  if (!ok) return;
  const res = await api().start_update();
  if (!res.ok) setStatus(t("status.updateFailed", { error: res.error }), true);
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
  els.updateBtn.addEventListener("click", startUpdate);

  // Thesaurus and Translate buttons keep the selection in the text (no focus change).
  for (const id of ["thesaurusBtn", "translateBtn"]) $(id).addEventListener("mousedown", (e) => e.preventDefault());
  $("thesaurusBtn").addEventListener("click", openThesaurus);
  $("translateBtn").addEventListener("click", openTranslate);

  $("thClose").addEventListener("click", closeThesaurus);
  els.thBack.addEventListener("click", () => { if (th.history.length) lookup(th.history.pop(), true); });
  els.thSearch.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); lookup(els.thSearch.value); } });
  $("thReplace").addEventListener("click", replaceWithChip);
  $("thLookup").addEventListener("click", () => lookup(th.chipWord));
  els.thBody.addEventListener("scroll", hideChipMenu);

  $("trClose").addEventListener("click", closeTranslate);
  $("trGo").addEventListener("click", translateNow);
  $("trReplace").addEventListener("click", replaceWithTranslation);
  $("trCopy").addEventListener("click", () => copyText(els.trText.textContent));
  $("trUseDraft").addEventListener("click", () => { setDraft(els.trText.textContent); closeTranslate(); });
  els.trTarget.addEventListener("change", () => { saveState(); if (!els.trOut.hidden) translateNow(); });

  for (const el of [els.prompt, els.draft]) el.addEventListener("input", updateTask);
  for (const field of ["prompt", "draft"]) els[field].addEventListener("focus", () => { app.lastField = field; });
  els.result.addEventListener("focus", () => { app.lastField = "result"; });
  els.result.addEventListener("mouseup", () => { app.lastField = "result"; });

  els.provider.addEventListener("change", () => { showProviderModels(); saveState(); });
  for (const el of [els.mode, els.tone, els.textLanguage, els.autoCopy]) el.addEventListener("change", saveState);
  els.model.addEventListener("change", onModelChange);

  els.preset.addEventListener("change", () => {
    const text = els.preset.value;
    els.preset.value = "";
    if (!text) return;
    els.prompt.value = `${els.prompt.value.trimEnd()}\n${text}`.trim();
    updateTask();
    els.prompt.focus();
  });

  document.querySelectorAll(".mic").forEach((b) => {
    b.innerHTML = micLabel();
    b.addEventListener("click", () => toggleRecording(b));
  });

  document.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      if (els.translate.contains(document.activeElement)) translateNow();
      else run();
    }
    else if (e.ctrlKey && e.shiftKey && key === "v") { e.preventDefault(); pasteAndReview(); }
    else if (e.ctrlKey && e.shiftKey && key === "c") { e.preventDefault(); copyResult(); }
    else if (e.ctrlKey && e.shiftKey && key === "t") { e.preventDefault(); openTranslate(); }
    else if (e.ctrlKey && !e.shiftKey && key === "t") {
      e.preventDefault();
      if (document.activeElement === els.thSearch) lookup(els.thSearch.value);
      else openThesaurus();
    }
    else if (e.key === "Escape") {
      if (rec.recorder) stopRecording(true);
      else if (!els.thMenu.hidden) hideChipMenu();
      else if (!els.thesaurus.hidden || !els.translate.hidden) closePanels();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (e.target.closest("#thesaurusBtn, #translateBtn")) return;
    if (!els.translate.hidden && !els.translate.contains(e.target)) closeTranslate();
    if (els.thesaurus.hidden) return;
    if (!els.thesaurus.contains(e.target)) closeThesaurus();
    else if (!e.target.closest(".chip, #thMenu")) hideChipMenu();
  });
}

window.WA = { focusDraft: () => els.draft.focus() };
applyLanguage("");   // static text in the Windows language until settings load
wire();
window.addEventListener("pywebviewready", init);
