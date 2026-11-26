// app.js
// Behavior of the Write Assist window (the Draft and the result are rich
// text, sent to the AI as plain text or a small Markdown): picks Review or Create from the
// filled fields, runs it through Python (window.pywebview.api), shows the
// result with highlighted edits, the on-demand thesaurus and translator, the
// free local AI's first-use download, live grammar underlines (LanguageTool),
// version history (a column inside the Result panel), sessions (.wasession
// files), exports (Word, PDF, text, Markdown), the Result's formatting bar
// (bold, italic, underline, strikethrough, lists, links), resizable panels,
// speech-to-text recording, settings, About, interface language, and updates.
//
// Author:  Luis Martinez
// Email:   16788942+luigihmtz@users.noreply.github.com
// Version: v01.17.01
// Date:    2026-11-26
//
// Usage: loaded by ui/index.html after i18n.js (t(), applyLanguage()). Every
//        api.* call returns a Promise of {ok: true, ...} or {ok: false, error}.

const $ = (id) => document.getElementById(id);
const api = () => window.pywebview.api;

const els = {
  histColumn: $("histColumn"), histList: $("histList"), histLabel: $("histLabel"),
  mode: $("mode"), tone: $("tone"), textLanguage: $("textLanguage"),
  provider: $("provider"), model: $("model"),
  prompt: $("prompt"), draftEl: $("draft"), preset: $("preset"),   // els.draft: the RichBox below
  result: $("result"), resultTitle: $("resultTitle"), changes: $("changes"),
  runBtn: $("runBtn"), refineBtn: $("refineBtn"), autoCopy: $("autoCopy"), updateBtn: $("updateBtn"), status: $("status"),
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
  resultTitle: null,    // {key, provider} or {key, date, src} of the shown result
  lastChanges: null,    // {task, changes, notes} shown under the result
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function setStatus(text, isError = false, onClick = null) {
  els.status.textContent = text;
  els.status.title = text;
  els.status.classList.toggle("error", isError);
  els.status.classList.toggle("link", Boolean(onClick));
  els.status.onclick = onClick;
}

// ---------------------------------------------------------------------------
// Startup and interface language
// ---------------------------------------------------------------------------
async function init() {
  const info = await api().init();
  if (!info.ok) { setStatus(info.error, true); return; }
  app.info = info;
  document.documentElement.style.setProperty("--fs", `${Math.round(info.font_size * 1.33)}px`);
  setPlatform(info.platform);
  $("hotkeyBlock").hidden = info.platform !== "windows";   // the global hotkey is Windows-only for now
  setUiLanguage(info.ui_language || "");
  app.microphone = info.microphone || "";
  applyCheckMode(info.check_mode || "spelling");

  const state = info.state || {};
  // models_rev 2: Claude's default became haiku; forget models saved before that.
  app.models = state.models_rev === 2 ? (state.models || {}) : {};
  for (const p of info.providers) app.providers[p.name] = p;
  const usable = info.providers.filter((p) => p.installed || p.type === "ollama");
  for (const p of (usable.length ? usable : info.providers)) els.provider.add(new Option(providerLabel(p.name), p.name));
  // provider_rev 2: the default became the cheapest AI that's set up; forget the AI saved before that.
  const wanted = (state.provider_rev === 2 && state.provider) || info.default_provider;
  if ([...els.provider.options].some((o) => o.value === wanted)) els.provider.value = wanted;
  app.lastProvider = els.provider.value;

  // mode_rev 2: the default became "polish"; forget the mode saved before that.
  els.mode.value = state.mode_rev === 2 ? (state.mode || "polish") : "polish";
  els.tone.value = state.tone || "keep";
  els.textLanguage.value = state.text_language || "auto";
  els.trTarget.value = state.translate_target || "auto";
  els.autoCopy.checked = state.auto_copy ?? info.auto_copy_default;
  Object.assign(layout, state.layout || {});
  applyLayout();
  for (const preset of info.presets) els.preset.add(new Option(preset, preset));

  showProviderModels();
  updateTask();
  els.draft.focus();

  if (info.needs_profile) openSettings(true);
  app.onClose = info.on_close || "keep";
  const start = await api().startup_session();   // Write Assist opened with a .wasession file
  if (!start.ok) setStatus(start.error, true);
  else if (start.session) applySession(start);
  else await restoreAutosave();
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
  for (const option of els.provider.options) option.textContent = providerLabel(option.value);
  document.querySelectorAll(".kbd-run").forEach((k) => { k.textContent = RUN_KEYS(); });
}

// Shown name of an AI: the local one is labeled "Local (free)" / "Local (gratis)".
function providerLabel(name) {
  return app.providers[name]?.type === "ollama" ? t("ai.local") : name;
}

function showProviderModels() {
  const p = app.providers[els.provider.value];
  if (!p) return;
  fillModels(p, app.models[p.name] || p.default_model || p.models[0] || "");
  if (p.installed) setStatus(t("status.empty"));
  else if (p.type === "ollama") setStatus(t("local.notSetUp"));
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

// ---------------------------------------------------------------------------
// Free local AI: downloaded on first use, after a warning with its size
// ---------------------------------------------------------------------------
const gb = (mb) => (mb / 1000).toFixed(1);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// True when the chosen AI can answer; for the local AI, offers the download first.
async function ensureProviderReady() {
  const p = app.providers[els.provider.value];
  if (!p || p.type !== "ollama") return true;
  const model = els.model.value === OTHER_MODEL ? "" : els.model.value;
  const info = await api().local_info(model);
  if (!info.ok) { setStatus(info.error, true); return false; }
  if (info.ready) return true;
  const vars = { download: gb(info.download_mb), disk: gb(info.disk_mb), model: info.model };
  const ok = await confirmBox(t("local.setupTitle"),
    t(info.ollama_installed ? "local.modelText" : "local.setupText", vars), t("local.download"));
  if (!ok) { setStatus(t("local.notSetUp")); return false; }
  return runLocalSetup(info.model);
}

async function runLocalSetup(model) {
  const start = await api().start_local_setup(model);
  if (!start.ok) { setStatus(start.error, true); return false; }
  app.busy = true;
  els.runBtn.disabled = true;
  try {
    for (;;) {
      await sleep(700);
      const s = await api().local_progress();
      if (!s.ok) { setStatus(s.error, true); return false; }
      if (s.stage === "installing") setStatus(t("local.installing"));
      else if (s.total_mb) {
        setStatus(t("local.downloading", { percent: Math.floor((100 * s.done_mb) / s.total_mb), done: gb(s.done_mb), total: gb(s.total_mb) }));
      }
      if (s.running) continue;
      if (s.error) { setStatus(s.error, true); return false; }
      const p = app.providers[els.provider.value];
      if (p && model === p.default_model) p.installed = true;
      setStatus(t("local.ready"));
      return true;
    }
  } finally {
    app.busy = false;
    els.runBtn.disabled = false;
  }
}

async function onProviderChange() {
  showProviderModels();
  const p = app.providers[els.provider.value];
  if (p && p.type === "ollama" && !p.installed && !(await ensureProviderReady())) {
    els.provider.value = app.lastProvider;   // declined or failed: back to the previous AI
    showProviderModels();
    return;
  }
  app.lastProvider = els.provider.value;
  saveState();
}

function saveState() {
  app.models[els.provider.value] = els.model.value.trim();
  api().save_state({
    mode: els.mode.value, tone: els.tone.value, provider: els.provider.value,
    text_language: els.textLanguage.value, translate_target: els.trTarget.value,
    mode_rev: 2, provider_rev: 2, models: app.models, models_rev: 2, auto_copy: els.autoCopy.checked,
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
  els.runBtn.innerHTML = `${escapeHtml(label)} <kbd class="kbd-run">${RUN_KEYS()}</kbd>`;
  els.refineBtn.innerHTML = `${escapeHtml(t("run.refine"))} <kbd class="kbd-run">${onMac ? "⇧⌘↩" : "Ctrl+Shift+Enter"}</kbd>`;
  els.mode.disabled = task === "create";
}

// Refine: the Prompt's changes applied to the current result (Draft untouched).
const canRefine = () => Boolean(els.result.textContent.trim());

function updateRefine() {
  els.refineBtn.hidden = !canRefine();
}

async function run(refine = false) {
  if (app.busy) return;
  const task = refine ? "refine" : detectTask();
  if (!task) { setStatus(t("status.empty")); return; }
  if (refine && !canRefine()) return;
  if (refine && !els.prompt.value.trim()) { setStatus(t("status.refineNeedsPrompt")); els.prompt.focus(); return; }
  if (!(await ensureProviderReady())) return;
  const provider = els.provider.value;
  const draftLines = task === "review" ? richModel(els.draftEl) : null;
  const beforeLines = refine ? resultRich() : null;
  const draft = draftLines ? listText(draftLines) : "";   // plain: the formatting is put back here, after
  const before = beforeLines ? richToMd(beforeLines) : "";
  app.busy = true;
  els.runBtn.disabled = els.refineBtn.disabled = true;
  const started = Date.now();
  const key = { review: "status.reviewing", create: "status.writing", refine: "status.refining" }[task];
  // The instruction that started this text: background for Refine.
  const previousPrompt = app.lastRun ? (app.lastRun.basePrompt ?? app.lastRun.prompt ?? "") : "";
  const timer = setInterval(() => setStatus(t(key, { provider: providerLabel(provider), seconds: Math.round((Date.now() - started) / 1000) })), 250);
  try {
    const res = await api().run({
      provider, model: els.model.value, prompt: els.prompt.value, draft, draft_md: draftLines ? richToMd(draftLines) : "",
      mode: els.mode.value, tone: els.tone.value, language: els.textLanguage.value,
      ui_language: uiLang,   // changes and notes are explained in the interface language
      ...(refine ? { refine: true, result: before, previous_prompt: previousPrompt } : {}),
    });
    clearInterval(timer);
    if (!res.ok) { setStatus(res.error, true); return; }
    app.lastRun = { task, provider: res.provider, model: els.model.value, prompt: els.prompt.value.trim(),
      language: els.textLanguage.value === "auto" ? "" : els.textLanguage.value, when: new Date().toISOString(),
      ...(refine ? { basePrompt: previousPrompt } : {}) };
    // What changed, worked out here (cheaper than asking the AI): it marks the
    // edits, carries the writer's formatting over, and is Refine's change list.
    res.lines = mdToRich(res.text);
    const source = draftLines || beforeLines;
    if (source) {
      const diff = await api().history_compare(linesText(source), linesText(res.lines));
      if (diff.ok) {
        if (task === "review" || (hasInline(source) && !hasInline(res.lines))) res.lines = carryFormatting(source, res.lines, diff.parts);
        res.marks = marksFrom(diff.parts);
        if (refine) res.diff = diff.parts;
      }
      const final = richToMd(res.lines);
      if (res.version_id && final !== normMd(res.text)) api().history_update(res.version_id, final);
    }
    showResult(res);
    hist.selectedId = null;
    if (hist.on) refreshHistory();
  } finally {
    clearInterval(timer);
    app.busy = false;
    els.runBtn.disabled = els.refineBtn.disabled = false;
  }
}

const RUN_KEYS = () => (onMac ? "⌘↩" : "Ctrl+Enter");

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Plain text as editor lines: each line its own block (<div>), which is what
// the editing commands (lists, Enter) treat as a paragraph.
function linesHtml(text) {
  return text.split("\n").map((line) => `<div>${escapeHtml(line) || "<br>"}</div>`).join("");
}

function renderResultTitle() {
  const r = app.resultTitle;
  els.resultTitle.textContent = r ? t(r.key, r) + (r.src ? ` · ${t(`history.src.${r.src}`)}` : "") : t("result");
  els.resultTitle.title = els.resultTitle.textContent;   // the full title when it is cut short
}

// The Changes panel: a review's fixes and the AI's notes.
// Word differences (from history_compare or a Refine) as green insertions and red deletions.
function diffHtml(parts, legendKey) {
  if (!parts.some((part) => part.type !== "equal")) return `<p class="muted">${escapeHtml(t("history.samePrev"))}</p>`;
  return `<p class="muted">${escapeHtml(t(legendKey))}</p><div class="hist-diff-text">` + parts.map((part) =>
    part.type === "insert" ? `<ins>${escapeHtml(part.text)}</ins>`
      : part.type === "delete" ? `<del>${escapeHtml(part.text)}</del>` : escapeHtml(part.text)).join("") + "</div>";
}

function renderChanges(info) {
  app.lastChanges = info;
  els.changes.innerHTML = "";
  if (!info) return;
  if (info.task === "refine" && info.diff) els.changes.innerHTML = diffHtml(info.diff, "changes.refined");
  const changes = info.changes || [];
  if (info.task === "review") {
    if (!changes.length) {
      els.changes.innerHTML = `<p class="ok">${escapeHtml(t("changes.none"))}</p>`;
    }
    for (const c of changes) {
      const p = document.createElement("p");
      p.innerHTML = `<span class="old">${escapeHtml(mdToPlain(c.original))}</span> → ` +
        `<span class="new">${escapeHtml(mdToPlain(c.fixed))}</span> <span class="why">${escapeHtml(c.reason || "")}</span>`;
      els.changes.append(p);
    }
  }
  if (info.notes) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = t("changes.note", { text: info.notes });
    els.changes.append(p);
  }
}

function showResult(res) {
  const titles = { review: "result.corrected", create: "result.written", refine: "result.refined" };
  app.resultTitle = { key: titles[res.task], provider: providerLabel(res.provider) };
  renderResultTitle();
  els.result.innerHTML = richToEditorHtml(res.lines || mdToRich(res.text), res.marks);
  renderChanges({ task: res.task, changes: res.changes || [], notes: res.notes || "", ...(res.diff ? { diff: res.diff } : {}) });
  updateRefine();

  const parts = [];
  if (res.fallback_from) parts.push(fallbackNote(res));
  parts.push(res.task === "review"
    ? t(res.changes.length === 1 ? "status.reviewedOne" : "status.reviewed", { provider: providerLabel(res.provider), count: res.changes.length })
    : t(res.task === "refine" ? "status.refined" : "status.written", { provider: providerLabel(res.provider) }));
  parts.push(`${res.elapsed.toFixed(1)}s`);
  if (els.autoCopy.checked) { copyResult(true); parts.push(t("status.copiedSuffix")); }
  setStatus(parts.join(" · "));
  checkUnsaved();
}

// "Claude hit a usage limit (...), used GitHub Copilot" when the backup AI answered.
function fallbackNote(res) {
  if (!res.fallback_from) return "";
  const why = res.limit_note ? ` (${res.limit_note})` : "";
  return t("status.fallback", { from: providerLabel(res.fallback_from), why, provider: providerLabel(res.provider) });
}

// ---------------------------------------------------------------------------
// Rich Result: formatting read as lines of styled runs, the one model behind
// the plain-text copy, the HTML copy (Teams, Outlook, Word) and the exports.
//   line: {kind: "p" | "ul" | "ol", n: item number, runs: [{text, b, i, u, s, href}]}
// ---------------------------------------------------------------------------
const BLOCK_TAGS = new Set(["DIV", "P", "LI", "UL", "OL", "H1", "H2", "H3", "BLOCKQUOTE"]);
const SKIP_TAGS = new Set(["STYLE", "SCRIPT", "TEMPLATE", "HEAD", "TITLE", "META", "LINK"]);

function richModel(root) {
  const lines = [];
  let line = null;
  let pending = false;   // a block ended: the next content starts a new line
  const start = (kind = "p", n = 0) => { line = { kind, n, runs: [], touched: false }; lines.push(line); };
  const ensure = () => { if (pending) { if (line.touched) start(); pending = false; } };
  start();

  function styleOf(el, style) {
    const s = { ...style };
    const tag = el.tagName;
    const css = el.style || {};
    const weight = css.fontWeight;
    if (weight === "normal" || (Number(weight) && Number(weight) < 600)) delete s.b;   // e.g. Google Docs' <b style="font-weight:normal">
    else if (tag === "B" || tag === "STRONG" || weight === "bold" || Number(weight) >= 600) s.b = true;
    if (tag === "I" || tag === "EM" || css.fontStyle === "italic") s.i = true;
    if (tag === "U" || (css.textDecoration || "").includes("underline")) s.u = true;
    if (tag === "S" || tag === "STRIKE" || tag === "DEL" || (css.textDecoration || "").includes("line-through")) s.s = true;
    if (tag === "A" && el.getAttribute("href")) s.href = el.getAttribute("href");
    return s;
  }

  function walk(node, style) {
    if (node.nodeType === Node.TEXT_NODE) {
      node.textContent.split("\n").forEach((part, index) => {
        ensure();
        if (index > 0) { start(); }
        if (part) { line.runs.push({ text: part, ...style }); }
        line.touched = true;
      });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (SKIP_TAGS.has(tag)) return;
    if (tag === "IMG") {   // Teams and Outlook copy emojis as images with the emoji as alt text
      const alt = node.getAttribute("alt") || "";
      const emoji = /\p{Extended_Pictographic}/u.test(alt) || /emoji/i.test(`${node.getAttribute("itemtype")} ${node.className}`);
      if (alt && emoji) walk(document.createTextNode(alt), style);
      return;   // other pictures aren't kept
    }
    if (tag === "BR") {
      ensure();
      // A <br> that is the last thing in its block only keeps an empty line open.
      const lastInBlock = !node.nextSibling && node.parentNode !== root && BLOCK_TAGS.has(node.parentNode.tagName);
      line.touched = true;
      if (!lastInBlock) start();
      return;
    }
    if (tag === "UL" || tag === "OL") {
      let n = 0;
      for (const item of node.children) {
        if (item.tagName !== "LI") continue;
        n += 1;
        if (line.touched || line.runs.length) start(tag.toLowerCase(), n);
        else { line.kind = tag.toLowerCase(); line.n = n; }
        pending = false;
        for (const child of item.childNodes) walk(child, style);
        line.touched = true;
        pending = true;
      }
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) { ensure(); if (line.touched) start(); }
    const s = styleOf(node, style);
    for (const child of node.childNodes) walk(child, s);
    if (block) { line.touched = true; pending = true; }
  }

  for (const child of root.childNodes) walk(child, {});
  while (lines.length > 1 && !lines[lines.length - 1].runs.length && lines[lines.length - 1].kind === "p") lines.pop();
  return lines.map(({ kind, n, runs }) => ({ kind, n, runs }));
}

function richToPlain(lines) {
  return lines.map((l) => (l.kind === "ul" ? "• " : l.kind === "ol" ? `${l.n}. ` : "") + l.runs.map((r) => r.text).join("")).join("\n");
}

function safeHref(href) {
  return /^(https?:|mailto:|tel:)/i.test(href || "") ? href : "";
}

function runToHtml(run, inner = escapeHtml(run.text)) {
  let html = inner;
  if (run.b) html = `<b>${html}</b>`;
  if (run.i) html = `<i>${html}</i>`;
  if (run.u) html = `<u>${html}</u>`;
  if (run.s) html = `<s>${html}</s>`;
  if (safeHref(run.href)) html = `<a href="${escapeHtml(run.href)}">${html}</a>`;
  return html;
}

// HTML for the clipboard and the PDF: lists as real lists, other lines with <br>.
function richToHtml(lines) {
  let html = "";
  let list = null;
  lines.forEach((l, index) => {
    const content = l.runs.map(runToHtml).join("");
    if (l.kind === "ul" || l.kind === "ol") {
      if (list !== l.kind) { if (list) html += `</${list}>`; html += `<${l.kind}>`; list = l.kind; }
      html += `<li>${content || "<br>"}</li>`;
      return;
    }
    if (list) { html += `</${list}>`; list = null; }
    // A line break before the next plain line; an empty line keeps its own (a blank line before a list).
    const next = lines[index + 1];
    html += content + (next && (next.kind === "p" || !content) ? "<br>" : "");
  });
  if (list) html += `</${list}>`;
  return html;
}

// Editor HTML (Result, Draft) from the rich model: one <div> per line, lists
// as lists. marks: positions in linesText(lines) to mark as edited.
function richToEditorHtml(lines, marks = null) {
  let pos = 0;   // position in linesText(lines)
  const runHtml = (r) => {
    const from = pos;
    pos += r.text.length;
    if (!marks?.size) return runToHtml(r);
    let inner = "";
    let open = false;
    for (let k = 0; k < r.text.length; k++) {
      const on = marks.has(from + k);
      if (on !== open) { inner += on ? "<mark>" : "</mark>"; open = on; }
      inner += escapeHtml(r.text[k]);
    }
    return runToHtml(r, inner + (open ? "</mark>" : ""));
  };
  let html = "";
  let list = null;
  for (const [index, l] of (lines || []).entries()) {
    if (index) pos += 1;   // the line break
    const content = (l.runs || []).map(runHtml).join("") || "<br>";
    if (l.kind === "ul" || l.kind === "ol") {
      if (list !== l.kind) { if (list) html += `</${list}>`; html += `<${l.kind}>`; list = l.kind; }
      html += `<li>${content}</li>`;
      continue;
    }
    if (list) { html += `</${list}>`; list = null; }
    html += `<div>${content}</div>`;
  }
  if (list) html += `</${list}>`;
  return html;
}

// ---------------------------------------------------------------------------
// Markdown: how formatted text travels to the AI and back, and how the Draft
// and results are kept in History and sessions. A small subset: **bold**,
// *italic*, <u>underline</u>, ~~strike~~, [text](url), "- " and "1. " lists,
// "\" before a character that would read as formatting; every line break is
// a line. The AI may also answer with _italic_, __bold__, "* " lists or "#"
// headings (shown bold); those are read too. Review sends plain text instead,
// and carryFormatting() puts the writer's formatting back on the answer.
// ---------------------------------------------------------------------------
const MD_ESCAPABLE = "\\*_~<[]()`#-+.!>";

function mdEscape(text) {
  return text.replace(/\\(?=[\\*_~<[\]])/g, "\\\\").replace(/\*/g, "\\*").replace(/~~/g, "\\~\\~")
    .replace(/<(\/?u>)/gi, "\\<$1").replace(/\[(?=[^\]\n]*\]\()/g, "\\[");
}

function runsToMd(runs) {
  const ORDER = ["href", "b", "i", "s", "u"];
  const OPEN = { b: "**", i: "*", s: "~~", u: "<u>" };
  const CLOSE = { b: "**", i: "*", s: "~~", u: "</u>" };
  const keysOf = (r) => ORDER.filter((k) => r[k]).map((k) => (k === "href" ? `href ${r.href.replace(/[()\s]/g, encodeURIComponent)}` : k));
  const stack = [];
  let out = "";
  let trail = "";
  const closeTo = (n) => {
    while (stack.length > n) { const k = stack.pop(); out += k.startsWith("href ") ? `](${k.slice(5)})` : CLOSE[k]; }
  };
  for (const r of runs) {
    const [, lead, core, end] = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text);
    if (!core) { trail += r.text; continue; }
    const want = keysOf(r);
    let n = 0;
    while (n < stack.length && n < want.length && stack[n] === want[n]) n++;
    closeTo(n);
    out += mdEscape(trail + lead);
    for (const k of want.slice(n)) { stack.push(k); out += k.startsWith("href ") ? "[" : OPEN[k]; }
    out += mdEscape(core);
    trail = end;
  }
  closeTo(0);
  return out + mdEscape(trail);
}

function richToMd(lines) {
  return lines.map((l) => {
    let body = runsToMd(l.runs || []);
    if (l.kind === "p" && /^\s*([-*+]\s|\d{1,3}[.)]\s|#{1,6}\s|>)/.test(body)) body = body.replace(/^(\s*)/, "$1\\");
    return (l.kind === "ul" ? "- " : l.kind === "ol" ? `${l.n || 1}. ` : "") + body;
  }).join("\n");
}

// Inline Markdown of cps[s..e) (code points) into runs with source offsets.
function mdInline(cps, s, e, base) {
  const isWs = (c) => c === undefined || /\s/u.test(c);
  const isPunct = (c) => c !== undefined && /[\p{P}\p{S}]/u.test(c);
  const toks = [];
  const text = (ch, at) => {
    const last = toks[toks.length - 1];
    if (last && last.t === "text" && last.src + last.n === at) { last.text += ch; last.n += 1; }
    else toks.push({ t: "text", text: ch, src: at, n: 1 });
  };
  let link = null;   // {closeAt, endAt} of the link being read
  let k = s;
  while (k < e) {
    if (link && k === link.closeAt) { toks.push({ t: "linkClose" }); k = link.endAt; link = null; continue; }
    const c = cps[k];
    if (c === "\\" && k + 1 < e && MD_ESCAPABLE.includes(cps[k + 1])) { text(cps[k + 1], k + 1); k += 2; continue; }
    if (c === "*" || c === "_" || c === "~") {
      let r = k;
      while (r < e && cps[r] === c) r++;
      const len = r - k;
      const prev = k > s ? cps[k - 1] : undefined;
      const next = r < e ? cps[r] : undefined;
      const left = !isWs(next) && (!isPunct(next) || isWs(prev) || isPunct(prev));
      const right = !isWs(prev) && (!isPunct(prev) || isWs(next) || isPunct(next));
      let canOpen = left;
      let canClose = right;
      if (c === "_") { canOpen = left && (!right || isPunct(prev)); canClose = right && (!left || isPunct(next)); }
      if ((c === "~" && len !== 2) || (!canOpen && !canClose)) { for (let q = k; q < r; q++) text(c, q); k = r; continue; }
      toks.push({ t: "delim", ch: c, len, left: len, src: k, canOpen, canClose, opens: [], closes: [] });
      k = r;
      continue;
    }
    if (c === "<") {
      const ahead = cps.slice(k, k + 4).join("").toLowerCase();
      if (ahead.startsWith("<u>")) { toks.push({ t: "delim", ch: "u", len: 1, left: 1, src: k, canOpen: true, canClose: false, opens: [], closes: [] }); k += 3; continue; }
      if (ahead === "</u>") { toks.push({ t: "delim", ch: "u", len: 1, left: 1, src: k, canOpen: false, canClose: true, opens: [], closes: [] }); k += 4; continue; }
    }
    if (c === "[" && !link) {
      const m = /^\[((?:[^\]\\\n]|\\.)*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/u.exec(cps.slice(k, e).join(""));
      if (m) {
        toks.push({ t: "linkOpen", href: m[2] });
        link = { closeAt: k + 1 + Array.from(m[1]).length, endAt: k + Array.from(m[0]).length };
        k += 1;
        continue;
      }
    }
    text(c, k);
    k += 1;
  }
  // Pair the delimiters (a simplified CommonMark): ** bold, * italic, ~~ strike, <u></u>.
  const stack = [];
  toks.forEach((tk, index) => {
    if (tk.t !== "delim") return;
    if (tk.canClose) {
      let si = stack.length - 1;
      while (tk.left > 0 && si >= 0) {
        const op = toks[stack[si]];
        if (op.ch !== tk.ch || op.left === 0) { si -= 1; continue; }
        const star = tk.ch === "*" || tk.ch === "_";
        const use = star ? (tk.left >= 2 && op.left >= 2 ? 2 : 1) : tk.ch === "~" ? 2 : 1;
        const style = star ? (use === 2 ? "b" : "i") : tk.ch === "~" ? "s" : "u";
        op.left -= use;
        tk.left -= use;
        op.opens.push(style);
        tk.closes.push(style);
        stack.splice(si + 1);
        if (op.left === 0) stack.splice(si, 1);
        si = stack.length - 1;
      }
    }
    if (tk.left > 0 && tk.canOpen) stack.push(index);
  });
  const on = { b: 0, i: 0, u: 0, s: 0 };
  let href = null;
  const runs = [];
  const add = (str, src) => {
    const style = {};
    for (const key of ["b", "i", "u", "s"]) if (base[key] || on[key] > 0) style[key] = true;
    if (href) style.href = href;
    const last = runs[runs.length - 1];
    const same = last && ["b", "i", "u", "s", "href"].every((key) => last[key] === style[key]);
    if (same && last.src + Array.from(last.text).length === src) last.text += str;
    else runs.push({ text: str, ...style, src });
  };
  for (const tk of toks) {
    if (tk.t === "text") add(tk.text, tk.src);
    else if (tk.t === "linkOpen") href = tk.href;
    else if (tk.t === "linkClose") href = null;
    else {
      for (const style of tk.closes) on[style] -= 1;
      for (let q = 0; q < tk.left; q++) add(tk.ch === "u" ? "" : tk.ch, tk.src + q);   // unpaired: plain characters
      for (const style of tk.opens) on[style] += 1;
    }
  }
  return runs.filter((r) => r.text);
}

function mdToRich(md) {
  const cps = Array.from(md || "");
  const lines = [];
  let s = 0;
  for (;;) {
    let e = s;
    while (e < cps.length && cps[e] !== "\n") e++;
    const raw = cps.slice(s, e).join("");
    let kind = "p";
    let n = 0;
    let skip = 0;
    const base = {};
    let m;
    if ((m = /^\s*([-*+])\s+/u.exec(raw))) { kind = "ul"; skip = Array.from(m[0]).length; }
    else if ((m = /^\s*(\d{1,3})[.)]\s+/u.exec(raw))) { kind = "ol"; n = Number(m[1]); skip = Array.from(m[0]).length; }
    else if ((m = /^#{1,6}\s+/u.exec(raw))) { base.b = true; skip = Array.from(m[0]).length; }
    else if ((m = /^>\s?/u.exec(raw))) { skip = Array.from(m[0]).length; }
    lines.push({ kind, n, runs: mdInline(cps, s + skip, e, base) });
    if (e >= cps.length) break;
    s = e + 1;
  }
  while (lines.length > 1 && !lines[lines.length - 1].runs.length && lines[lines.length - 1].kind === "p") lines.pop();
  return lines;
}

const mdToPlain = (md) => richToPlain(mdToRich(md));

// The words of the lines, one "\n" between lines (no list markers): what gets compared.
const linesText = (lines) => lines.map((l) => l.runs.map((r) => r.text).join("")).join("\n");
// What Review sends: plain text, lists as "- " / "1. " lines.
const listText = (lines) => lines.map((l) => (l.kind === "ul" ? "- " : l.kind === "ol" ? `${l.n || 1}. ` : "")
  + l.runs.map((r) => r.text).join("")).join("\n");
const STYLE_KEYS = ["b", "i", "u", "s", "href"];
const runStyle = (r) => (STYLE_KEYS.some((k) => r[k]) ? Object.fromEntries(STYLE_KEYS.filter((k) => r[k]).map((k) => [k, r[k]])) : null);
const hasInline = (lines) => lines.some((l) => l.runs.some(runStyle));

// Positions in the new text that a word diff (source -> result) shows as new.
function marksFrom(parts) {
  const marks = new Set();
  let pos = 0;
  for (const part of parts) {
    if (part.type === "delete") continue;
    if (part.type === "insert") for (let k = 0; k < part.text.length; k++) if (!/\s/.test(part.text[k])) marks.add(pos + k);
    pos += part.text.length;
  }
  return marks;
}

// The writer's formatting carried over to the AI's text: words that stayed
// keep theirs, a word that replaced formatted words takes their formatting,
// and words added inside a formatted phrase take the phrase's. parts: the word
// diff from linesText(source) to linesText(result).
function carryFormatting(source, result, parts) {
  const styles = (lines) => {
    const out = [];
    lines.forEach((l, index) => {
      if (index) out.push(null);
      for (const r of l.runs) { const style = runStyle(r); for (let k = 0; k < r.text.length; k++) out.push(style); }
    });
    return out;
  };
  const merge = (mine, theirs) => (theirs ? { ...theirs, ...(mine || {}) } : mine);
  const key = (style) => JSON.stringify(style || {});
  const src = styles(source);
  const res = styles(result);
  const out = res.slice();
  let si = 0;
  let ri = 0;
  let carry = null;
  for (const part of parts) {
    const n = part.text.length;
    if (part.type === "equal") {
      for (let k = 0; k < n; k++) out[ri + k] = merge(res[ri + k], src[si + k]);
      si += n;
      ri += n;
      carry = null;
    } else if (part.type === "delete") {
      const first = [...part.text].findIndex((ch) => !/\s/.test(ch));
      carry = first >= 0 ? src[si + first] : null;
      si += n;
    } else {
      const inside = !carry && ri > 0 && out[ri - 1] && key(out[ri - 1]) === key(src[si]) ? out[ri - 1] : null;
      for (let k = 0; k < n; k++) if (!/\s/.test(part.text[k]) || inside) out[ri + k] = merge(res[ri + k], carry || inside);
      ri += n;
      carry = null;
    }
  }
  let pos = 0;
  return result.map((l, index) => {
    if (index) pos += 1;
    const text = l.runs.map((r) => r.text).join("");
    const runs = [];
    for (let k = 0; k < text.length; k++) {
      const style = out[pos + k];
      const last = runs[runs.length - 1];
      if (last && key(runStyle(last)) === key(style)) last.text += text[k];
      else runs.push({ text: text[k], ...(style || {}) });
    }
    pos += text.length;
    return { kind: l.kind, n: l.n, runs };
  });
}
const normMd = (md) => richToMd(mdToRich(md));   // the same text as this page would write it

function resultRich() { return richModel(els.result); }
function resultMd() { return richToMd(resultRich()); }
function draftMd() { return richToMd(richModel(els.draftEl)); }
function setDraftMd(md) { els.draftEl.innerHTML = md ? richToEditorHtml(mdToRich(md)) : ""; }

// ---------------------------------------------------------------------------
// Plain-text positions in a rich editor: its text with one "\n" between
// lines (like a text box), and DOM ranges for any part of it.
// ---------------------------------------------------------------------------
function domText(root) {
  let text = "";
  const points = [];   // text nodes {node, at, len} and line-break spots {node, offset, at}
  let dirty = false;   // the current line has something
  let ended = false;   // a block just ended: what follows starts a new line
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (ended) { text += "\n"; ended = false; }
      points.push({ node, at: text.length, len: node.data.length });
      text += node.data;
      if (node.data) dirty = true;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || SKIP_TAGS.has(node.tagName)) return;
    if (node.tagName === "BR") {
      if (ended) { text += "\n"; ended = false; }
      points.push({ node: node.parentNode, offset: [...node.parentNode.childNodes].indexOf(node), at: text.length });
      const last = !node.nextSibling && node.parentNode !== root && BLOCK_TAGS.has(node.parentNode.tagName);
      if (last) dirty = true;
      else { text += "\n"; dirty = false; }
      return;
    }
    const block = BLOCK_TAGS.has(node.tagName) && node.tagName !== "UL" && node.tagName !== "OL";
    if (block) {
      if (dirty || ended) text += "\n";
      dirty = false;
      ended = false;
      points.push({ node, offset: 0, at: text.length });
    }
    for (const child of node.childNodes) walk(child);
    if (block) { ended = true; dirty = false; }
  };
  for (const child of root.childNodes) walk(child);
  return { text, points };
}

function rangeAt(root, start, end, dt = domText(root)) {
  const spot = (p) => {
    p = Math.max(0, Math.min(p, dt.text.length));
    let best = null;
    for (const pt of dt.points) {
      if (pt.at > p) break;
      if (pt.len !== undefined) { if (p <= pt.at + pt.len) best = { node: pt.node, offset: p - pt.at }; }
      else if (pt.at === p) best = { node: pt.node, offset: pt.offset };
    }
    return best || { node: root, offset: root.childNodes.length };
  };
  const a = spot(start);
  const b = spot(end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

function offsetIn(root, node, offset) {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  const box = document.createElement("div");
  box.append(range.cloneContents());
  return domText(box).text.length;
}

// The rich Draft with the interface of a text box (value, selectionStart/End,
// setSelectionRange, setRangeText...), so what Prompt and Draft share
// (Thesaurus, Translate, dictation, live grammar) works on both. Positions
// count its plain text; value = that text (setting it writes plain lines).
class RichBox {
  constructor(el) {
    this.el = el;
    this.sel = null;   // the last selection inside it, kept while the focus is elsewhere
    document.addEventListener("selectionchange", () => { const s = this.liveSelection(); if (s) this.sel = s; });
  }

  liveSelection() {
    const s = window.getSelection();
    if (!s.rangeCount || !this.el.contains(s.anchorNode)) return null;
    const r = s.getRangeAt(0);
    return [offsetIn(this.el, r.startContainer, r.startOffset), offsetIn(this.el, r.endContainer, r.endOffset)];
  }

  get value() { return domText(this.el).text; }
  set value(text) { this.el.innerHTML = text ? linesHtml(text) : ""; this.sel = null; }
  get selectionStart() { return (this.liveSelection() || this.sel || [this.value.length])[0]; }
  get selectionEnd() { const s = this.liveSelection() || this.sel; return s ? s[1] : this.value.length; }
  rangeAt(start, end, dt) { return rangeAt(this.el, start, end, dt); }
  setSelectionRange(start, end) {
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(this.rangeAt(start, end));
    this.sel = [start, end];
  }
  setRangeText(text, start, end) {
    const range = this.rangeAt(start, end);
    range.deleteContents();
    if (text) range.insertNode(document.createTextNode(text));
    this.el.normalize();
    this.setSelectionRange(start + text.length, start + text.length);
  }
  focus() { this.el.focus(); }
  addEventListener(...args) { this.el.addEventListener(...args); }
  dispatchEvent(event) { return this.el.dispatchEvent(event); }
  closest(selector) { return this.el.closest(selector); }
  contains(node) { return this.el.contains(node); }
  before(node) { this.el.before(node); }
  get id() { return this.el.id; }
  get classList() { return this.el.classList; }
  get scrollTop() { return this.el.scrollTop; }
  set spellcheck(on) { this.el.spellcheck = on; }
}

els.draft = new RichBox(els.draftEl);

// Pasting into the Draft or the result keeps bold, italic, underline,
// strikethrough, links and lists (from Word, Outlook, Teams, web pages), and
// drops everything else.
function pasteRich(e) {
  e.preventDefault();
  const html = e.clipboardData.getData("text/html");
  if (!html) { document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); return; }
  const doc = new DOMParser().parseFromString(html, "text/html");   // inert: nothing in it runs
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const spaces = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) spaces.push(node);
  for (const node of spaces) {   // source line breaks and indentation are not text
    if (node.parentElement?.closest("pre")) continue;
    node.data = node.data.replace(/[\t\n\r ]+/g, " ");
    if (!node.data.trim() && [node.previousSibling, node.nextSibling].some((x) => !x || (x.nodeType === 1 && BLOCK_TAGS.has(x.tagName)))) node.remove();
  }
  const lines = richModel(doc.body);
  for (const l of lines) {   // no stray spaces at the ends of lines
    if (l.runs.length) { l.runs[0].text = l.runs[0].text.trimStart(); l.runs[l.runs.length - 1].text = l.runs[l.runs.length - 1].text.trimEnd(); }
    l.runs = l.runs.filter((r) => r.text);
  }
  if (lines.length === 1 && lines[0].kind === "p") document.execCommand("insertHTML", false, lines[0].runs.map((r) => runToHtml(r)).join(""));
  else document.execCommand("insertHTML", false, richToEditorHtml(lines));
}

function resultText() { return richToPlain(resultRich()); }

async function copyText(text, quiet = false, html = "") {
  if (!text) return;
  const res = await api().clipboard_set(text, html || null);
  if (!quiet) setStatus(res.ok ? t(html ? "fmt.copied" : "status.copied") : res.error, !res.ok);
}

function copyResult(quiet = false) {
  const lines = resultRich();
  const formatted = lines.some((l) => l.kind !== "p" || l.runs.some((r) => r.b || r.i || r.u || r.s || r.href));
  return copyText(richToPlain(lines), quiet, formatted ? richToHtml(lines) : "");
}

// ---------------------------------------------------------------------------
// Formatting bar
// ---------------------------------------------------------------------------
function selectionIn(el) {
  const sel = window.getSelection();
  return sel.rangeCount > 0 && el.contains(sel.anchorNode);
}

function formatCommand(cmd, el = els.result) {
  if (!selectionIn(el)) {   // put the caret at the end of the text first
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  if (cmd === "link") { editLink(); return; }
  if (cmd === "clear") {
    document.execCommand("removeFormat");
    document.execCommand("unlink");
  } else {
    document.execCommand(cmd);
  }
  updateFormatState();
}

function editLink() {
  const sel = window.getSelection();
  const anchor = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).closest("a");
  const saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const answer = window.prompt(t("fmt.linkPrompt"), anchor ? anchor.getAttribute("href") : "https://");
  if (answer === null) return;
  sel.removeAllRanges();
  if (saved) sel.addRange(saved);
  let url = answer.trim();
  if (!url || url === "https://") {
    if (anchor) { const r = document.createRange(); r.selectNodeContents(anchor); sel.removeAllRanges(); sel.addRange(r); }
    document.execCommand("unlink");
    return;
  }
  if (!/^[a-z][\w+.-]*:/i.test(url)) url = (url.includes("@") && !url.includes("/") ? "mailto:" : "https://") + url;
  if (anchor) { anchor.setAttribute("href", url); return; }
  if (sel.isCollapsed) document.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
  else document.execCommand("createLink", false, url);
  updateFormatState();
}

function updateFormatState() {
  document.querySelectorAll(".format-bar .fmt").forEach((button) => {
    const inside = selectionIn(formatTarget(button));
    const cmd = button.dataset.cmd;
    let active = false;
    if (inside && ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"].includes(cmd)) {
      try { active = document.queryCommandState(cmd); } catch { active = false; }
    }
    button.classList.toggle("active", active);
  });
}

// The editor a formatting bar works on (data-target on the bar).
const formatTarget = (button) => (button.closest(".format-bar").dataset.target === "draft" ? els.draftEl : els.result);

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

function useAsDraft() {
  if (!resultText().trim()) return;
  els.draftEl.innerHTML = richToEditorHtml(resultRich());
  els.draft.dispatchEvent(new Event("input"));
  updateTask();
  els.draft.focus();
}

function clearAll() {
  els.prompt.value = "";
  els.draft.value = "";
  els.result.innerHTML = "";
  renderChanges(null);
  app.resultTitle = null;
  app.lastRun = null;
  renderResultTitle();
  setStatus("");
  updateTask();
  els.draft.focus();
  hist.selectedId = null;
  session.name = "";
  updateRefine();
  checkUnsaved();
  api().history_new_group().then(() => { if (hist.on) refreshHistory(); });
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
    field: area.id, area, start, end,
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
    word, context, field: "result", range,
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

// A panel opens over the column opposite its source, at the source's height,
// so the original and the panel sit side by side. A floating panel stays where
// the user dragged it. Call after the panel is shown (it needs its height).
function placePanel(panel, field) {
  if (panel.classList.contains("floating")) { keepOnScreen(panel); return; }
  const columns = document.querySelectorAll(".grid > .column");
  const fromResult = field === "result";
  const other = columns[fromResult ? 0 : 1].getBoundingClientRect();
  const source = (fromResult ? els.result : (els[field] || els.draft)).closest(".card").getBoundingClientRect();
  const width = Math.min(Math.max(other.width, 300), 480, window.innerWidth - 16);
  panel.style.width = `${width}px`;
  panel.style.height = "";
  panel.style.left = `${fromResult ? other.right - width : other.left}px`;
  panel.style.top = `${source.top}px`;
  keepOnScreen(panel);
}

function keepOnScreen(panel) {
  const r = panel.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - r.height - 8))}px`;
}

function toggleFloating(panel) {
  const floating = panel.classList.toggle("floating");
  const button = panel.querySelector(".detach");
  button.title = t(floating ? "panel.dock" : "panel.detach");
  if (!floating) placePanel(panel, panel === els.translate ? tr.target?.field : th.target?.field);
}

// Drag a floating panel by its title bar.
function startDrag(panel, e) {
  if (!panel.classList.contains("floating") || e.button !== 0) return;
  if (e.target.closest("button, input, select, textarea")) return;
  e.preventDefault();
  const r = panel.getBoundingClientRect();
  const dx = e.clientX - r.left;
  const dy = e.clientY - r.top;
  document.body.classList.add("dragging");
  const move = (ev) => {
    panel.style.left = `${Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - 60))}px`;
    panel.style.top = `${Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - 40))}px`;
  };
  const up = () => {
    document.body.classList.remove("dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function closePanels() {
  closeThesaurus();
  closeTranslate();
}

// ---------------------------------------------------------------------------
// Source highlight: the text a panel is working on stays marked in yellow
// ---------------------------------------------------------------------------
const hl = { area: null, mirror: null, target: null };
const MIRROR_STYLES = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "wordSpacing",
  "tabSize", "textIndent", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing"];

function showSourceHighlight(target) {
  clearSourceHighlight();
  if (!target) return;
  // The blue selection would cover the yellow, so it's cleared; the yellow now
  // marks the text (and the caret stays where the selection ended).
  if (target.range) {   // the result: highlight the DOM range itself
    if (window.Highlight && CSS.highlights) {
      CSS.highlights.set("wa-source", new Highlight(target.range));
      window.getSelection().removeAllRanges();
    }
    return;
  }
  if (target.area.rangeAt) {   // the rich Draft: a highlight over its own text
    if (window.Highlight && CSS.highlights) CSS.highlights.set("wa-source", new Highlight(target.area.rangeAt(target.start, target.end)));
    target.area.setSelectionRange(target.end, target.end);
    Object.assign(hl, { area: target.area, mirror: null, target });
    return;
  }
  target.area.setSelectionRange(target.end, target.end);
  // Prompt: a text box can't color part of its text, so a layer with
  // the same text, font and wrapping sits behind it with the words marked.
  const mirror = document.createElement("div");
  mirror.className = "hl-mirror";
  target.area.before(mirror);
  target.area.classList.add("hl-on");
  Object.assign(hl, { area: target.area, mirror, target });
  syncSourceHighlight();
}

// A layer behind a text box with the same text, font, size and wrapping, so
// parts of the text can be marked (highlight, grammar underlines).
function fitMirror(area, mirror) {
  const style = getComputedStyle(area);
  for (const name of MIRROR_STYLES) mirror.style[name] = style[name];
  // Same text width as the box: its client width leaves out its scrollbar.
  const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  mirror.style.left = `${area.offsetLeft}px`;
  mirror.style.top = `${area.offsetTop}px`;
  mirror.style.width = `${area.clientWidth + borders}px`;
  mirror.style.height = `${area.offsetHeight}px`;
}

function syncSourceHighlight() {
  const { area, mirror, target } = hl;
  if (!area || !mirror) return;
  fitMirror(area, mirror);
  const v = area.value;
  mirror.innerHTML = `${escapeHtml(v.slice(0, target.start))}<mark>${escapeHtml(v.slice(target.start, target.end))}</mark>${escapeHtml(v.slice(target.end))}\n`;
  mirror.scrollTop = area.scrollTop;
}

function clearSourceHighlight() {
  if (hl.mirror) hl.mirror.remove();
  if (hl.area) hl.area.classList.remove("hl-on");
  Object.assign(hl, { area: null, mirror: null, target: null });
  if (window.CSS && CSS.highlights) CSS.highlights.delete("wa-source");
}

// The highlight of whichever panel is still open (the other may have just closed).
function refreshSourceHighlight() {
  if (!els.translate.hidden && tr.target) showSourceHighlight(tr.target);
  else if (!els.thesaurus.hidden && th.target) showSourceHighlight(th.target);
  else clearSourceHighlight();
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
  refreshSourceHighlight();
}

function openThesaurus() {
  const target = selectedTarget();
  if (target && target.word.split(/\s+/).length > 4) {
    setStatus(t("th.tooLong"));
    return;
  }
  if (!els.translate.classList.contains("floating")) closeTranslate();
  th.target = target;
  th.history = [];
  th.current = "";
  els.thesaurus.hidden = false;
  placePanel(els.thesaurus, target ? target.field : app.lastField);
  showSourceHighlight(target);
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
  if (!(await ensureProviderReady())) { closeThesaurus(); return; }
  els.thBody.innerHTML = `<p class="muted">${escapeHtml(t("th.looking", { word, provider: providerLabel(els.provider.value) }))}</p>`;

  const res = await api().thesaurus({
    word, context: th.target ? th.target.context : "", provider: els.provider.value, model: els.model.value,
    ui_language: uiLang,   // definitions in the interface language
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
  clearSourceHighlight();
  target.replace(word);
  th.target = null;
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
  refreshSourceHighlight();
}

// With selected text, the panel shows only the translation (the source stays
// highlighted in place); with nothing selected, a box to type the text in.
function openTranslate() {
  const target = selectedTarget();
  if (!els.thesaurus.classList.contains("floating")) closeThesaurus();
  tr.target = target;
  tr.source = target ? target.word : "";
  els.trSource.value = tr.source;
  $("trInput").hidden = Boolean(target);
  els.trOut.hidden = true;
  els.translate.hidden = false;
  placePanel(els.translate, target ? target.field : app.lastField);
  showSourceHighlight(target);
  if (target) translateNow();
  else els.trSource.focus();
}

async function translateNow() {
  const text = els.trSource.value.trim();
  if (!text) { els.trSource.focus(); return; }
  if (!(await ensureProviderReady())) { closeTranslate(); return; }
  const seq = ++tr.seq;
  els.trOut.hidden = false;
  els.trMeta.textContent = t("tr.working", { provider: providerLabel(els.provider.value) });
  els.trText.textContent = "";
  els.trAltBlock.hidden = true;
  els.trNote.hidden = true;
  $("trReplace").hidden = true;

  const fromSelection = tr.target && text === tr.source.trim();
  const res = await api().translate({
    text, target: els.trTarget.value, context: fromSelection ? tr.target.context : "",
    provider: els.provider.value, model: els.model.value,
    ui_language: uiLang,   // notes and language names in the interface language
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
  clearSourceHighlight();
  tr.target.replace(text);
  tr.target = null;
  closeTranslate();
  setStatus(t("tr.replaced"));
}

// ---------------------------------------------------------------------------
// Live grammar: LanguageTool on this computer underlines mistakes as you type
// ---------------------------------------------------------------------------
const LT_FIELDS = ["prompt", "draft"];
const lt = { on: false, started: false, timers: {}, seq: {}, matches: { prompt: [], draft: [] },
  mirrors: {}, ranges: {}, ignored: new Set(), open: null };
const LT_HIGHLIGHTS = ["lt-spell", "lt-grammar", "lt-style"];

const ltKey = (text, m) => `${m.rule}|${text.slice(m.offset, m.offset + m.length)}`;
const ltClass = (type) => (type === "misspelling" ? "lt-spell" : ["style", "typographical", "locale-violation"].includes(type) ? "lt-style" : "lt-grammar");

function setLiveGrammar(on) {
  lt.on = on;
  hideLtPop();
  for (const field of LT_FIELDS) {
    const area = els[field];
    // Prompt and Draft never use the browser's own spellcheck (spellcheck="false"
    // in index.html): the Live grammar setting alone decides whether lines show.
    if (on) {
      if (!lt.mirrors[field] && !area.rangeAt) {
        const mirror = document.createElement("div");
        mirror.className = "lt-mirror";
        area.before(mirror);
        area.classList.add("lt-on");
        lt.mirrors[field] = mirror;
      }
      scheduleGrammarCheck(field, 0);
    } else {
      clearTimeout(lt.timers[field]);
      lt.mirrors[field]?.remove();
      delete lt.mirrors[field];
      lt.matches[field] = [];
      area.classList.remove("lt-on");
      if (area.rangeAt) renderGrammar(field);
    }
  }
}

function scheduleGrammarCheck(field, delay = 700) {
  if (!lt.on) return;
  clearTimeout(lt.timers[field]);
  lt.timers[field] = setTimeout(() => runGrammarCheck(field), delay);
}

async function runGrammarCheck(field) {
  const area = els[field];
  const text = area.value;
  if (!lt.on) return;
  if (!text.trim()) { lt.matches[field] = []; renderGrammar(field); return; }
  const seq = (lt.seq[field] = (lt.seq[field] || 0) + 1);
  if (!lt.started) setStatus(t("lt.starting"));   // the first check also starts the checker
  const res = await api().grammar_check(text, els.textLanguage.value);
  if (!lt.started && els.status.textContent === t("lt.starting")) setStatus("");
  if (!res.ok) { setStatus(res.error, true); return; }
  lt.started = true;
  if (seq !== lt.seq[field] || area.value !== text) return;   // typed meanwhile: a newer check follows
  lt.matches[field] = res.matches.filter((m) => !lt.ignored.has(ltKey(text, m))).sort((a, b) => a.offset - b.offset);
  renderGrammar(field);
}

function renderGrammar(field) {
  const area = els[field];
  if (area.rangeAt) {   // the rich Draft: underlines drawn as highlights over its text
    if (!window.Highlight || !CSS.highlights) return;
    const groups = Object.fromEntries(LT_HIGHLIGHTS.map((name) => [name, []]));
    const dt = domText(area.el);
    lt.ranges[field] = [];
    let pos = 0;
    lt.matches[field].forEach((m, i) => {
      if (m.offset < pos) return;
      const range = area.rangeAt(m.offset, m.offset + m.length, dt);
      lt.ranges[field][i] = range;
      groups[ltClass(m.type)].push(range);
      pos = m.offset + m.length;
    });
    for (const [name, ranges] of Object.entries(groups)) {
      if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
      else CSS.highlights.delete(name);
    }
    return;
  }
  const mirror = lt.mirrors[field];
  if (!mirror) return;
  fitMirror(area, mirror);
  const v = area.value;
  let html = "";
  let pos = 0;
  lt.matches[field].forEach((m, i) => {
    if (m.offset < pos) return;   // overlapping match: skip
    html += `${escapeHtml(v.slice(pos, m.offset))}<span class="lt-err ${ltClass(m.type)}" data-i="${i}">${escapeHtml(v.slice(m.offset, m.offset + m.length))}</span>`;
    pos = m.offset + m.length;
  });
  mirror.innerHTML = `${html}${escapeHtml(v.slice(pos))}\n`;
  mirror.scrollTop = area.scrollTop;
}

// Typing shifts the text under the underlines: hide them until the next check.
function onGrammarInput(field) {
  if (!lt.on) return;
  hideLtPop();
  if (lt.matches[field].length) { lt.matches[field] = []; renderGrammar(field); }
  scheduleGrammarCheck(field);
}

// A click inside an underlined word opens its suggestions.
function onGrammarClick(field) {
  if (!lt.on) return;
  const area = els[field];
  if (area.selectionStart !== area.selectionEnd) return;
  const pos = area.selectionStart;
  const index = lt.matches[field].findIndex((m) => m.offset <= pos && pos <= m.offset + m.length);
  if (index < 0) { hideLtPop(); return; }
  showLtPop(field, index);
}

function showLtPop(field, index) {
  const m = lt.matches[field][index];
  const span = lt.mirrors[field]?.querySelector(`[data-i="${index}"]`) || lt.ranges[field]?.[index];
  if (!m || !span) return;
  lt.open = { field, index };
  const pop = $("ltPop");
  $("ltMsg").textContent = m.message;
  $("ltMsg").title = m.detail;
  const reps = $("ltReps");
  reps.innerHTML = m.replacements.length ? "" : `<span class="muted">${escapeHtml(t("lt.noSuggestions"))}</span>`;
  for (const value of m.replacements) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = value;
    chip.addEventListener("click", () => applyGrammarFix(field, m, value));
    reps.append(chip);
  }
  pop.hidden = false;
  const r = span.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top = `${r.bottom + 6 + pop.offsetHeight > window.innerHeight ? r.top - pop.offsetHeight - 6 : r.bottom + 6}px`;
}

function hideLtPop() {
  $("ltPop").hidden = true;
  lt.open = null;
}

function applyGrammarFix(field, m, value) {
  const area = els[field];
  hideLtPop();
  area.focus();
  area.setRangeText(value, m.offset, m.offset + m.length, "end");
  area.dispatchEvent(new Event("input"));
}

function ignoreGrammarMatch() {
  if (!lt.open) return;
  const { field, index } = lt.open;
  const m = lt.matches[field][index];
  lt.ignored.add(ltKey(els[field].value, m));
  lt.matches[field].splice(index, 1);
  hideLtPop();
  renderGrammar(field);
}

// Underlines in Prompt and Draft: "off", "spelling" (the browser's built-in
// spellchecker) or "grammar" (LanguageTool on this PC).
function applyCheckMode(mode) {
  app.checkMode = mode;
  $("checkMode").value = mode;
  for (const field of LT_FIELDS) els[field].spellcheck = mode === "spelling";
  setLiveGrammar(mode === "grammar");
}

// The Underline dropdown in the top bar. "grammar" needs the checker: the
// dropdown keeps the current mode until it's downloaded and running.
async function onCheckModeChange() {
  const mode = $("checkMode").value;
  if (mode === app.checkMode) return;
  if (mode === "grammar") {
    $("checkMode").value = app.checkMode;
    await enableLiveGrammar();
    return;
  }
  applyCheckMode(mode);
  api().set_check_mode(mode);
}

// Choosing "grammar" the first time downloads the checker, after the size
// warning; declining keeps the current mode.
async function enableLiveGrammar() {
  const info = await api().grammar_info();
  if (!info.ok) { setStatus(info.error, true); return false; }
  if (!info.installed) {
    const ok = await confirmBox(t("lt.setupTitle"),
      t("lt.setupText", { download: info.download_mb, disk: info.disk_mb }), t("lt.download"));
    if (!ok) return false;
    const start = await api().start_grammar_setup();
    if (!start.ok) { setStatus(start.error, true); return false; }
    for (;;) {
      await sleep(700);
      const s = await api().grammar_progress();
      if (!s.ok) { setStatus(s.error, true); return false; }
      if (s.total_mb) {
        setStatus(t("lt.downloading", { percent: Math.min(100, Math.floor((100 * s.done_mb) / s.total_mb)),
          done: Math.round(s.done_mb), total: Math.round(s.total_mb) }));
      }
      if (s.running) continue;
      if (s.error) { setStatus(s.error, true); return false; }
      break;
    }
  }
  await api().set_check_mode("grammar");
  applyCheckMode("grammar");
  setStatus(t("lt.ready"));
  return true;
}

// ---------------------------------------------------------------------------
// Version history, in a column inside the Result panel (History button).
// Every Review/Create saves the draft and the result (in Python); the user
// can save the draft by hand. Clicking a version shows it in the Result, with
// its changes and notes (or what changed from the version before). Turning
// History off keeps the version that's shown.
// ---------------------------------------------------------------------------
const hist = { on: false, data: null, selectedId: null, diffSeq: 0 };

function formatWhen(iso) {
  try {
    return new Date(iso).toLocaleString(uiLang, { dateStyle: "medium", timeStyle: "short" });
  } catch { return iso; }
}

function toggleHistory(on = !hist.on) {
  hist.on = on;
  els.histColumn.hidden = !on;
  $("historyToggle").classList.toggle("active", on);
  if (on) refreshHistory();
  else hist.selectedId = null;   // the shown version stays as the Result
}

async function refreshHistory() {
  const res = await api().history_list();
  if (!res.ok) { els.histList.innerHTML = `<p class="error">${escapeHtml(res.error)}</p>`; return; }
  hist.data = res;
  renderHistory();
}

function renderHistory() {
  const { versions = [], group, enabled } = hist.data || {};
  els.histList.innerHTML = "";
  if (!enabled) els.histList.insertAdjacentHTML("beforeend", `<p class="muted">${escapeHtml(t("history.off"))}</p>`);
  if (!versions.length) {
    if (enabled) els.histList.insertAdjacentHTML("beforeend", `<p class="muted">${escapeHtml(t("history.empty"))}</p>`);
    return;
  }
  let lastGroup = null;
  for (const v of versions) {
    if (v.group !== lastGroup) {
      lastGroup = v.group;
      const title = v.group === group ? t("history.current") : t("history.earlier", { date: formatWhen(v.time) });
      els.histList.insertAdjacentHTML("beforeend", `<h3 class="hist-group">${escapeHtml(title)}</h3>`);
    }
    els.histList.append(historyItem(v));
  }
}

function historyItem(v) {
  const item = document.createElement("div");
  item.className = "hist-item" + (v.id === hist.selectedId ? " selected" : "");
  const ai = v.provider ? `${escapeHtml(providerLabel(v.provider))}${v.model ? ` (${escapeHtml(v.model)})` : ""}` : "";
  item.innerHTML =
    `<div class="hist-top"><span>${escapeHtml(formatWhen(v.time))}</span>` +
    `<span class="badge">${escapeHtml(t(`history.src.${v.source}`))}</span></div>` +
    (v.label ? `<div class="hist-top"><span class="label">${escapeHtml(v.label)}</span></div>` : "") +
    `<div class="hist-preview">${escapeHtml(mdToPlain(v.text).replace(/\s+/g, " ").trim())}</div>` +
    (ai ? `<div class="hist-ai">${ai}</div>` : "");
  const del = document.createElement("button");
  del.className = "tool hist-del";
  del.textContent = "✕";
  del.title = t("history.delete");
  del.addEventListener("click", (e) => { e.stopPropagation(); deleteVersion(v); });
  item.append(del);
  item.addEventListener("click", () => selectVersion(v));
  return item;
}

// Shows a version in the Result. The Result shown before is saved first
// (unless it's already one of the versions), so switching never loses work.
async function selectVersion(v) {
  if (hist.selectedId === v.id) return;
  const current = resultMd();
  const known = (hist.data?.versions || []).some((x) => normMd(x.text) === current);
  if (current.trim() && !known) await api().history_save(current, t("history.beforeSwitch"));
  hist.selectedId = v.id;
  showVersion(v);
  await refreshHistory();
}

function showVersion(v) {
  const lines = v.rich?.length ? v.rich : mdToRich(v.text);
  els.result.innerHTML = richToEditorHtml(lines);
  if (v.source === "result" && ["review", "refine"].includes(v.task)) markVersion(v, lines);
  app.resultTitle = { key: "history.viewing", date: formatWhen(v.time), src: v.source };
  renderResultTitle();
  app.lastRun = { task: v.task, provider: v.provider, model: v.model, prompt: v.prompt, language: v.language, when: v.time };
  if (v.source === "result" && v.task !== "refine" && (v.changes || v.notes)) {
    renderChanges({ task: v.task, changes: v.changes || [], notes: v.notes || "" });
  } else showDiffFromPrevious(v);
  updateRefine();
  checkUnsaved();
}

function previousVersion(v) {
  const versions = hist.data?.versions || [];
  return versions.slice(versions.findIndex((x) => x.id === v.id) + 1).find((x) => x.group === v.group);
}

// A reviewed or refined version shows its edits marked, against the version before.
async function markVersion(v, lines) {
  const previous = previousVersion(v);
  if (!previous) return;
  const res = await api().history_compare(linesText(mdToRich(previous.text)), linesText(lines));
  if (res.ok && hist.selectedId === v.id) els.result.innerHTML = richToEditorHtml(lines, marksFrom(res.parts));
}

// For drafts and saved versions (and results saved before changes were kept):
// what changed from the version before it.
async function showDiffFromPrevious(v) {
  const seq = ++hist.diffSeq;
  renderChanges(null);
  const previous = previousVersion(v);
  if (!previous) { els.changes.innerHTML = `<p class="muted">${escapeHtml(t("history.first"))}</p>`; return; }
  const res = await api().history_compare(mdToPlain(previous.text).trimEnd(), mdToPlain(v.text).trimEnd());
  if (seq !== hist.diffSeq) return;
  if (!res.ok) { setStatus(res.error, true); return; }
  els.changes.innerHTML = diffHtml(res.parts, "history.diffPrev");
  if (v.notes) els.changes.insertAdjacentHTML("beforeend", `<p class="note">${escapeHtml(t("changes.note", { text: v.notes }))}</p>`);
}

async function saveVersion() {
  const text = draftMd();
  if (!text.trim()) { setStatus(t("history.nothingToSave")); return; }
  const res = await api().history_save(text, els.histLabel.value.trim());
  if (!res.ok) { setStatus(res.error, true); return; }
  els.histLabel.value = "";
  setStatus(t("history.saved"));
  if (hist.on) refreshHistory();
}

async function deleteVersion(v) {
  const res = await api().history_delete(v.id);
  if (!res.ok) { setStatus(res.error, true); return; }
  if (hist.selectedId === v.id) hist.selectedId = null;   // the text stays in the Result
  setStatus(t("history.deleted"));
  refreshHistory();
}

async function clearHistory() {
  const ok = await confirmBox(t("settings.clearConfirmTitle"), t("settings.clearConfirm"), t("settings.clearYes"));
  if (!ok) return;
  const res = await api().history_clear();
  if (!res.ok) { setStatus(res.error, true); return; }
  hist.selectedId = null;
  setStatus(t("settings.historyCleared"));
  if (hist.on) refreshHistory();
}

// ---------------------------------------------------------------------------
// Sessions: a .wasession file holds the prompt, draft, result (with its
// formatting, changes and notes), the options, and this text's versions.
// Closing, opening another session or updating asks to save unsaved work.
// ---------------------------------------------------------------------------
const session = { savedSig: "", name: "", unsaved: null, asking: null };

const sessionSig = () => [els.prompt.value, els.draftEl.innerHTML, els.result.innerHTML].join("\u0001");
const hasWork = () => Boolean(els.prompt.value.trim() || els.draft.value.trim() || els.result.textContent.trim());

// Tells Python whether closing should ask (only when the answer changes).
function checkUnsaved() {
  scheduleAutosave();
  const unsaved = hasWork() && sessionSig() !== session.savedSig;
  if (unsaved === session.unsaved || !window.pywebview?.api) return unsaved;
  session.unsaved = unsaved;
  api().set_unsaved(unsaved);
  return unsaved;
}

// Everything a session file (or the autosave) holds, except the versions.
function collectSession() {
  const rich = resultRich();
  return {
    prompt: els.prompt.value, draft: draftMd(), result_text: richToPlain(rich),
    result: { rich, title: app.resultTitle, changes: app.lastChanges },
    options: { mode: els.mode.value, tone: els.tone.value, language: els.textLanguage.value,
      provider: els.provider.value, model: els.model.value },
    last_run: app.lastRun || null,
  };
}

// "Keep my work for next time" (like VS Code): the work is saved as it
// changes, and once more when the window closes, then reopened at the start.
const autosave = { sig: null, timer: null };

function scheduleAutosave() {
  if (app.onClose !== "keep" || !window.pywebview?.api || sessionSig() === autosave.sig) return;
  clearTimeout(autosave.timer);
  autosave.timer = setTimeout(flushAutosave, 800);
}

async function flushAutosave() {
  clearTimeout(autosave.timer);
  if (app.onClose !== "keep") return;
  autosave.sig = sessionSig();
  const data = hasWork() ? { ...collectSession(), session_name: session.name, unsaved: Boolean(checkUnsaved()) } : null;
  await api().autosave(data);
}

async function restoreAutosave() {
  if (app.onClose !== "keep") return;
  const res = await api().autosave_load();
  const s = res.ok && res.session;
  if (!s) return;
  applySession({ session: s, name: s.session_name || "" }, true);
  if (s.unsaved) { session.savedSig = ""; checkUnsaved(); }   // still not in a session file
  autosave.sig = sessionSig();
}

// Before something replaces the texts: what isn't in History yet goes there.
async function stashInHistory(label) {
  const known = (await api().history_list()).versions?.map((v) => normMd(v.text)) || [];
  const draft = draftMd();
  if (draft.trim() && !known.includes(draft)) await api().history_save(draft, label);
  const result = resultMd();
  if (result.trim() && !known.includes(result)) await api().history_save(result, label);
}

async function saveSession() {
  const res = await api().session_save(collectSession());
  if (!res.ok) { setStatus(res.error, true); return false; }
  if (res.cancelled) return false;
  session.savedSig = sessionSig();
  session.name = res.path.split(/[\\/]/).pop();
  checkUnsaved();
  setStatus(t("session.saved", { name: session.name }), false, () => api().open_folder(res.folder));
  return true;
}

async function openSession() {
  if (app.onClose === "ask") { if (!(await resolveUnsaved())) return; }
  else if (checkUnsaved()) await stashInHistory(t("history.beforeOpen"));   // nothing is lost, no question
  const res = await api().session_open();
  if (!res.ok) { setStatus(res.error, true); return; }
  if (!res.cancelled) applySession(res);
}

function setSelect(select, value) {
  if (value && [...select.options].some((o) => o.value === value)) select.value = value;
}

// Puts a session's texts and options back ({session, name} from Python).
function applySession(data, restored = false) {
  const s = data?.session;
  if (!s) return;
  closePanels();
  els.prompt.value = s.prompt || "";
  setDraftMd(s.draft || "");
  const r = s.result || {};
  els.result.innerHTML = r.rich?.length ? richToEditorHtml(r.rich) : linesHtml(s.result_text || "");
  app.resultTitle = r.title || null;
  renderResultTitle();
  renderChanges(r.changes || null);
  updateRefine();
  const o = s.options || {};
  setSelect(els.mode, o.mode);
  setSelect(els.tone, o.tone);
  setSelect(els.textLanguage, o.language);
  if (o.provider && app.providers[o.provider] && [...els.provider.options].some((x) => x.value === o.provider)) {
    els.provider.value = o.provider;
    app.lastProvider = o.provider;
    if (o.model) app.models[o.provider] = o.model;
    showProviderModels();
  }
  app.lastRun = s.last_run || null;
  hist.selectedId = null;
  if (hist.on) refreshHistory();
  updateTask();
  LT_FIELDS.forEach((f) => scheduleGrammarCheck(f, 0));
  session.savedSig = sessionSig();
  session.name = data.name || "";
  checkUnsaved();
  setStatus(restored ? t("session.restored") : t("session.opened", { name: session.name }));
}

// Unsaved work: Save / Don't save / Cancel. True when it's fine to go on.
function resolveUnsaved() {
  if (!checkUnsaved()) return Promise.resolve(true);
  if (session.asking) return session.asking;
  session.asking = new Promise((resolve) => {
    const dialog = $("quitDialog");
    const done = async (choice) => {
      dialog.close();
      resolve(choice === "save" ? await saveSession() : choice === "discard");
      session.asking = null;
    };
    $("quitSave").onclick = () => done("save");
    $("quitDiscard").onclick = () => done("discard");
    $("quitCancel").onclick = () => done("cancel");
    dialog.oncancel = (e) => { e.preventDefault(); done("cancel"); };
    dialog.showModal();
  });
  return session.asking;
}

// Python cancelled a close because of unsaved work.
async function confirmQuit() {
  if (await resolveUnsaved()) api().quit();
}

// ---------------------------------------------------------------------------
// Resizable panels: drag the dividers, double-click to reset
// ---------------------------------------------------------------------------
const LAYOUT_DEFAULT = { cols: 0.5, left: 0.26, right: 0.64 };
const layout = { ...LAYOUT_DEFAULT };

function applyLayout() {
  const clamp = (x) => Math.min(0.85, Math.max(0.15, Number(x) || 0.5));
  for (const key of Object.keys(LAYOUT_DEFAULT)) layout[key] = clamp(layout[key]);
  document.querySelector(".grid").style.gridTemplateColumns = `minmax(0, ${layout.cols}fr) 12px minmax(0, ${1 - layout.cols}fr)`;
  document.querySelector(".prompt-card").style.flexBasis = `${layout.left * 100}%`;
  document.querySelector(".result-card").style.flexBasis = `${layout.right * 100}%`;
}

function layoutChanged(save) {
  applyLayout();
  window.dispatchEvent(new Event("resize"));   // underlines, highlights and panels follow
  if (save) api().save_state({ layout: { ...layout } });
}

function startSplit(splitter, e) {
  if (e.button !== 0) return;
  e.preventDefault();
  const key = splitter.dataset.split;
  const box = splitter.parentElement.getBoundingClientRect();
  splitter.setPointerCapture(e.pointerId);
  splitter.classList.add("dragging");
  const move = (ev) => {
    layout[key] = key === "cols" ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
    layoutChanged(false);
  };
  const up = () => {
    splitter.classList.remove("dragging");
    splitter.removeEventListener("pointermove", move);
    splitter.removeEventListener("pointerup", up);
    layoutChanged(true);
  };
  splitter.addEventListener("pointermove", move);
  splitter.addEventListener("pointerup", up);
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------
const PROJECT_URL = "https://github.com/luigihmtz/write-assist";

function openAbout() {
  $("aboutVersion").textContent = t("settings.version", { version: app.info?.version || "" }) + (app.info?.is_dev ? t("settings.devCopy") : "");
  $("aboutAuthor").textContent = t("about.author", { name: "Luis Martinez" });
  $("aboutUpdate").hidden = true;
  $("aboutDialog").showModal();
  $("aboutClose").focus();
}

// The setup report (version, settings, AIs, recent errors) for a bug report.
async function copyDiagnostics() {
  const note = $("aboutUpdate");
  note.hidden = false;
  note.textContent = t("about.diagWorking");
  const res = await api().diagnostics();
  if (!res.ok) { note.textContent = res.error; return; }
  await copyText(res.text, true);
  note.textContent = t("about.diagCopied");
}

async function aboutCheckUpdate() {
  const note = $("aboutUpdate");
  note.hidden = false;
  if (app.info?.is_dev) { note.textContent = t("about.dev"); return; }
  note.textContent = t("about.checking");
  const res = await api().check_update();
  if (!res.ok) { note.textContent = res.error; return; }
  if (!res.tag) { note.textContent = t("about.upToDate"); return; }
  app.updateTag = res.tag;
  els.updateBtn.textContent = t("update.button", { tag: res.tag });
  els.updateBtn.hidden = false;
  note.textContent = t("about.available", { tag: res.tag });
}

// ---------------------------------------------------------------------------
// Export: Word, PDF, text or Markdown, to a file or a synced cloud folder,
// with a "details" side-text at the end
// ---------------------------------------------------------------------------
const exp = { source: null, targets: null };

function currentSource() {
  if ($("expWhat").value === "draft") {
    const rich = richModel(els.draftEl);
    return { text: richToPlain(rich), rich, when: new Date().toISOString(), prompt: els.prompt.value.trim(),
      language: els.textLanguage.value === "auto" ? "" : els.textLanguage.value };
  }
  const rich = resultRich();
  return { text: richToPlain(rich), rich, ...(app.lastRun || {}), when: app.lastRun?.when || new Date().toISOString() };
}

async function openExport(source = null) {
  exp.source = source;
  $("expWhatBlock").hidden = Boolean(source);
  $("expVersion").hidden = !source;
  if (source) $("expVersion").textContent = t("export.version", { date: formatWhen(source.when) });
  else $("expWhat").value = resultText().trim() ? "result" : "draft";
  $("expError").hidden = true;
  const res = await api().export_targets();
  exp.targets = res.ok ? res : { clouds: [], pdf: false, author: "" };
  $("expFormat").querySelector('option[value="pdf"]').hidden = !exp.targets.pdf;
  if (!exp.targets.pdf && $("expFormat").value === "pdf") $("expFormat").value = "docx";
  const clouds = $("expClouds");
  clouds.innerHTML = "";
  for (const cloud of exp.targets.clouds) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool";
    button.textContent = t("export.to", { name: cloud.name });
    button.title = t("export.toTitle", { path: cloud.path });
    button.addEventListener("click", () => doExport(cloud.key));
    clouds.append(button);
  }
  $("expCloudBlock").hidden = !exp.targets.clouds.length;
  $("exportDialog").showModal();
}

function exportDetails(src) {
  const rows = [];
  if (exp.targets.author) rows.push([t("export.author"), exp.targets.author]);
  rows.push([t("export.date"), formatWhen(src.when)]);
  if (src.task) rows.push([t("export.task"), t(src.task === "create" ? "run.create" : "run.review")]);
  if (src.prompt) rows.push([t("export.prompt"), src.prompt]);
  if (src.language) rows.push([t("export.language"), src.language]);
  if (src.provider) rows.push([t("export.ai"), providerLabel(src.provider) + (src.model ? ` (${src.model})` : "")]);
  rows.push([t("export.madeWith"), `Write Assist ${app.info?.version || ""} · github.com/luigihmtz/write-assist`]);
  return rows;
}

async function doExport(target) {
  const src = exp.source || currentSource();
  if (!src.text || !src.text.trim()) { showExportError(t("export.empty")); return; }
  const format = $("expFormat").value;
  const details = $("expDetails").checked ? exportDetails(src) : [];
  if (format === "pdf") {   // the window prints only this area to the PDF
    const body = src.rich ? richToHtml(src.rich) : escapeHtml(src.text);
    $("printArea").innerHTML = `<div class="print-text">${body}</div>` + (details.length
      ? `<div class="print-details">${details.map(([label, value]) => `<p><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</p>`).join("")}</div>` : "");
  }
  const res = await api().export_file({ text: src.text, rich: src.rich || null, format, target, details, when: src.when });
  $("printArea").innerHTML = "";
  if (!res.ok) { showExportError(res.error); return; }
  if (res.cancelled) return;
  $("exportDialog").close();
  const name = res.path.split(/[\\/]/).pop();
  setStatus(t("export.saved", { name }), false, () => api().open_folder(res.folder));
}

function showExportError(message) {
  $("expError").textContent = message;
  $("expError").hidden = false;
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
  const value = area.value;
  caret = Math.min(caret, value.length);
  const before = value.slice(0, caret);
  const after = value.slice(caret);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  area.focus();
  area.setRangeText(lead + text + trail, caret, caret, "end");
  const pos = caret + (lead + text).length;
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
  $("historyOn").checked = res.history !== false;
  $("onClose").value = res.on_close || "keep";
  $("authorName").value = res.author_name || "";
  $("authorName").placeholder = res.author_default || "";
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
    history: $("historyOn").checked, author_name: $("authorName").value.trim(),
    on_close: $("onClose").value,
  });
  if (!res.ok) { $("settingsError").textContent = res.error; $("settingsError").hidden = false; return; }
  app.microphone = $("microphone").value;
  app.onClose = $("onClose").value;
  autosave.sig = null;
  if (app.onClose === "keep") flushAutosave(); else api().autosave(null);   // start keeping, or forget the kept work
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
  if (app.onClose === "ask") { if (!(await resolveUnsaved())) return; }
  else await flushAutosave();   // the work comes back after the update
  const res = await api().start_update();
  if (!res.ok) setStatus(t("status.updateFailed", { error: res.error }), true);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function wire() {
  els.runBtn.addEventListener("click", () => run());
  els.refineBtn.addEventListener("click", () => run(true));
  els.result.addEventListener("input", updateRefine);
  $("pasteBtn").addEventListener("click", pasteAndReview);
  $("clearBtn").addEventListener("click", clearAll);
  $("copyBtn").addEventListener("click", () => copyResult());
  $("useDraftBtn").addEventListener("click", useAsDraft);
  $("settingsBtn").addEventListener("click", () => openSettings(false));
  $("aboutBtn").addEventListener("click", openAbout);
  $("aboutClose").addEventListener("click", () => $("aboutDialog").close());
  $("aboutProject").addEventListener("click", () => api().open_url(PROJECT_URL));
  $("aboutCredits").addEventListener("click", () => api().open_url(`${PROJECT_URL}#third-party-software`));
  $("aboutCheck").addEventListener("click", aboutCheckUpdate);
  $("aboutDiag").addEventListener("click", copyDiagnostics);
  $("openSessionBtn").addEventListener("click", openSession);
  $("saveSessionBtn").addEventListener("click", saveSession);
  document.querySelectorAll(".splitter").forEach((splitter) => {
    splitter.addEventListener("pointerdown", (e) => startSplit(splitter, e));
    splitter.addEventListener("dblclick", () => {
      layout[splitter.dataset.split] = LAYOUT_DEFAULT[splitter.dataset.split];
      layoutChanged(true);
    });
  });
  $("settingsSave").addEventListener("click", () => closeSettings(true));
  $("settingsCancel").addEventListener("click", () => closeSettings(false));
  $("settingsDialog").addEventListener("cancel", (e) => { e.preventDefault(); closeSettings(false); });
  els.updateBtn.addEventListener("click", startUpdate);

  // Thesaurus and Translate buttons keep the selection in the text (no focus change).
  for (const id of ["thesaurusBtn", "translateBtn"]) $(id).addEventListener("mousedown", (e) => e.preventDefault());
  $("thesaurusBtn").addEventListener("click", openThesaurus);
  $("translateBtn").addEventListener("click", openTranslate);

  $("thClose").addEventListener("click", closeThesaurus);
  $("historyToggle").addEventListener("click", () => toggleHistory());
  $("histSave").addEventListener("click", saveVersion);
  $("histClear").addEventListener("click", clearHistory);
  els.histLabel.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveVersion(); } });
  $("exportBtn").addEventListener("click", () => openExport());
  $("expCancel").addEventListener("click", () => $("exportDialog").close());
  $("expSaveAs").addEventListener("click", () => doExport("dialog"));
  $("historyClear").addEventListener("click", clearHistory);
  els.thBack.addEventListener("click", () => { if (th.history.length) lookup(th.history.pop(), true); });
  els.thSearch.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); lookup(els.thSearch.value); } });
  $("thReplace").addEventListener("click", replaceWithChip);
  $("thLookup").addEventListener("click", () => lookup(th.chipWord));
  els.thBody.addEventListener("scroll", hideChipMenu);

  $("trClose").addEventListener("click", closeTranslate);
  for (const panel of [els.thesaurus, els.translate]) {
    panel.querySelector(".detach").addEventListener("click", () => toggleFloating(panel));
    panel.querySelector(".popover-head").addEventListener("pointerdown", (e) => startDrag(panel, e));
  }
  // The highlight follows the text box's scrolling and size; typing in it
  // shifts the text, so the highlight and the pending Replace no longer apply.
  for (const area of [els.prompt, els.draft]) {
    area.addEventListener("scroll", () => { if (hl.area === area && hl.mirror) hl.mirror.scrollTop = area.scrollTop; });
    area.addEventListener("input", () => {
      if (hl.area !== area) return;
      clearSourceHighlight();
      if (tr.target?.area === area) { tr.target = null; $("trReplace").hidden = true; }
      if (th.target?.area === area) { th.target = null; $("thReplace").hidden = true; }
    });
  }
  for (const field of LT_FIELDS) {
    const area = els[field];
    area.addEventListener("input", () => onGrammarInput(field));
    area.addEventListener("click", () => onGrammarClick(field));
    area.addEventListener("scroll", () => { if (lt.mirrors[field]) lt.mirrors[field].scrollTop = area.scrollTop; hideLtPop(); });
  }
  $("ltIgnore").addEventListener("click", ignoreGrammarMatch);
  $("checkMode").addEventListener("change", onCheckModeChange);
  els.textLanguage.addEventListener("change", () => LT_FIELDS.forEach((f) => scheduleGrammarCheck(f, 0)));
  window.addEventListener("resize", () => {
    LT_FIELDS.forEach(renderGrammar);
    syncSourceHighlight();
    for (const panel of [els.thesaurus, els.translate]) if (!panel.hidden) keepOnScreen(panel);
  });
  $("trGo").addEventListener("click", translateNow);
  $("trReplace").addEventListener("click", replaceWithTranslation);
  $("trCopy").addEventListener("click", () => copyText(els.trText.textContent));
  $("trUseDraft").addEventListener("click", () => { setDraft(els.trText.textContent); closeTranslate(); });
  els.trTarget.addEventListener("change", () => { saveState(); if (!els.trOut.hidden) translateNow(); });

  for (const el of [els.prompt, els.draft]) el.addEventListener("input", updateTask);
  for (const el of [els.prompt, els.draft, els.result]) el.addEventListener("input", checkUnsaved);
  setInterval(checkUnsaved, 1500);   // also catches changes made by code (dictation, Replace...)
  for (const field of ["prompt", "draft"]) els[field].addEventListener("focus", () => { app.lastField = field; });
  els.result.addEventListener("focus", () => { app.lastField = "result"; });
  // The Draft gets the same formatting bar as the result.
  document.querySelector('.format-bar[data-target="draft"]').innerHTML = $("formatBar").innerHTML;
  document.querySelectorAll(".format-bar .fmt").forEach((button) => {
    button.addEventListener("mousedown", (e) => e.preventDefault());   // keep the selection in the text
    button.addEventListener("click", () => formatCommand(button.dataset.cmd, formatTarget(button)));
  });
  document.execCommand("defaultParagraphSeparator", false, "div");   // Enter makes a new line block
  for (const el of [els.result, els.draftEl]) {
    el.addEventListener("keydown", (e) => {
      const mod = onMac ? e.metaKey : e.ctrlKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        formatCommand("link", el);
      }
    });
    el.addEventListener("paste", pasteRich);
    // Emptied by hand, it leaves a stray <br>: clear it so the placeholder shows.
    el.addEventListener("input", () => { if (!el.textContent && !el.querySelector("li")) el.innerHTML = ""; });
  }
  document.addEventListener("selectionchange", updateFormatState);
  els.result.addEventListener("mouseup", () => { app.lastField = "result"; });

  els.provider.addEventListener("change", onProviderChange);
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
    const mod = onMac ? e.metaKey : e.ctrlKey;   // ⌘ on macOS, Ctrl on Windows
    if (mod && e.shiftKey && e.key === "Enter") { e.preventDefault(); run(true); }
    else if (mod && e.key === "Enter") {
      e.preventDefault();
      if (els.translate.contains(document.activeElement)) translateNow();
      else run();
    }
    else if (mod && e.shiftKey && key === "v") { e.preventDefault(); pasteAndReview(); }
    else if (mod && e.shiftKey && key === "c") { e.preventDefault(); copyResult(); }
    else if (mod && e.shiftKey && key === "t") { e.preventDefault(); openTranslate(); }
    else if (mod && e.shiftKey && key === "s") { e.preventDefault(); saveSession(); }
    else if (mod && !e.shiftKey && key === "s") { e.preventDefault(); saveVersion(); }
    else if (mod && !e.shiftKey && key === "o") { e.preventDefault(); openSession(); }
    else if (mod && !e.shiftKey && key === "t") {
      e.preventDefault();
      if (document.activeElement === els.thSearch) lookup(els.thSearch.value);
      else openThesaurus();
    }
    else if (e.key === "Escape") {
      if (!$("ltPop").hidden) hideLtPop();
      else if (rec.recorder) stopRecording(true);
      else if (!els.thMenu.hidden) hideChipMenu();
      else if (!els.thesaurus.hidden || !els.translate.hidden) closePanels();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (!$("ltPop").hidden && !$("ltPop").contains(e.target)) hideLtPop();
    if (e.target.closest("#thesaurusBtn, #translateBtn, dialog")) return;
    const floating = (panel) => panel.classList.contains("floating");
    if (!els.translate.hidden && !floating(els.translate) && !els.translate.contains(e.target)) closeTranslate();
    if (els.thesaurus.hidden) return;
    if (!els.thesaurus.contains(e.target)) { if (floating(els.thesaurus)) hideChipMenu(); else closeThesaurus(); }
    else if (!e.target.closest(".chip, #thMenu")) hideChipMenu();
  });
}

window.WA = {
  focusDraft: () => els.draft.focus(),
  applySession,
  showError: (message) => setStatus(message, true),
  confirmQuit,
  flushAutosave,
};
applyLanguage("");   // static text in the Windows language until settings load
wire();
window.addEventListener("pywebviewready", init);
