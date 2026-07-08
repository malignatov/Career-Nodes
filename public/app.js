import { STR, PHASES, NODES } from "/i18n.js";

const $ = (id) => document.getElementById(id);
const journeyEl = $("journey");

let lang = localStorage.getItem("lang") ?? "en";
let theme = localStorage.getItem("theme") ?? "light";
let mode = localStorage.getItem("mode") ?? "client";
let profile = localStorage.getItem("profile") ?? "default";
let profiles = [{ id: "default", name: null }];
let journey = null;
let ws = null;
let modal = null; // { node, view, feedbackMode, review: {payload, currentText, edited} }
let pract = null; // practitioner modal state

/** Every artifact-touching request carries the active client profile. */
const api = (p) => p + (p.includes("?") ? "&" : "?") + `profile=${encodeURIComponent(profile)}`;

const t = (key, ...args) => {
  const v = STR[lang][key] ?? STR.en[key];
  return typeof v === "function" ? v(...args) : v;
};
const nodeTitle = (n) => (NODES[lang]?.[n.id]?.title) ?? n.title;
const nodeDesc = (n) => (NODES[lang]?.[n.id]?.desc) ?? n.desc;
const phaseLabel = (sector) => PHASES[lang]?.[sector.n] ?? sector.label;
const byId = (id) => journey.nodes.find((n) => n.id === id);

function applyTheme() {
  document.documentElement.dataset.theme = theme;
  document.documentElement.lang = lang;
}
applyTheme();

/* ── journey home ────────────────────────────────────── */

async function loadJourney() {
  journey = await (await fetch(api("/api/journey"))).json();
  renderJourney();
}

async function loadProfiles() {
  try {
    profiles = (await (await fetch("/api/profiles")).json()).profiles;
  } catch {
    profiles = [{ id: "default", name: null }];
  }
  if (!profiles.some((p) => p.id === profile)) profile = "default";
}

const profileName = (p) => (p.id === "default" ? t("profile_default") : (p.name ?? p.id));

function chipHtml(status) {
  return `<span class="chip ${status}">${t(`chip_${status}`)}</span>`;
}

/** Stale keeps its AUTHORIZED chip — staleness annotates, it doesn't revoke. */
function statusChips(status) {
  if (status !== "stale") return chipHtml(status);
  return `<span class="chip stale" data-tip="${esc(t("stale_tooltip"))}">${t("chip_stale")}</span>${chipHtml("authorized")}`;
}

function depHint(n) {
  if (n.id === "counseling_goal") return t("goal_hint");
  if (n.id === "closing_check") return t("closing_hint");
  if (n.id === "life_portrait") return t("portrait_hint");
  const parts = [];
  const names = (ids) => ids.map((id) => nodeTitle(byId(id))).join(", ");
  if (n.kind === "conversation" && n.feeds.length) parts.push(t("feeds", names(n.feeds)));
  if (n.kind === "derived" && n.uses.length) parts.push(t("uses", names(n.uses)));
  if (n.skippable) parts.push(t("fallback_hint"));
  return parts.join(" ");
}

function actionLabel(n) {
  if (n.status === "stale") return t("btn_refresh");
  if (n.status === "authorized") return t("btn_open");
  if (n.status === "in_progress") return t("btn_resume");
  if (mode === "practitioner") return n.kind === "conversation" ? t("btn_record") : t("btn_fill");
  return n.kind === "conversation" ? t("btn_start") : t("btn_draft");
}

const isSettled = (status) => status === "authorized" || status === "stale";

/** The step to draw attention to: resume first, then the next new step, then upkeep. */
function currentNodeId() {
  for (const status of ["in_progress", "available", "stale"]) {
    const hit = journey.nodes.find((n) => n.status === status);
    if (hit) return hit.id;
  }
  return null;
}

function summaryLine(n) {
  if (isSettled(n.status) && n.distilled?.length) {
    const parts = n.distilled
      .map((p) => `${p.label ? `<div class="sum-label">${esc(p.label)}</div>` : ""}<p>${esc(p.text)}</p>`)
      .join("");
    return `<div class="summary distilled">${parts}</div>`;
  }
  if (n.status === "in_progress") return `<div class="summary">${t("in_progress_summary")}</div>`;
  return `<div class="summary">${esc(nodeDesc(n))}</div>`;
}

function renderJourney() {
  const pct = Math.round((journey.authorized / journey.total) * 100);
  const current = currentNodeId();
  const parts = [];
  const profileControl = mode === "practitioner"
    ? `<select id="profileSel" class="tool-select">${profiles
        .map((p) => `<option value="${esc(p.id)}"${p.id === profile ? " selected" : ""}>${esc(profileName(p))}</option>`)
        .join("")}<option value="__new">${t("profile_new")}</option></select>`
    : profile !== "default"
      ? `<span class="tool-btn" style="cursor:default">${esc(profileName(profiles.find((p) => p.id === profile) ?? { id: profile }))}</span>`
      : "";
  const aiNote = journey.ai ? "" :
    `<div class="ai-note">${mode === "practitioner" ? t("no_ai_note") : t("ai_missing_client")}</div>`;
  parts.push(`
    <div class="j-header">
      <div>
        <div class="j-title">${t("journey_title")}</div>
        <div class="j-sub">${mode === "practitioner" ? t("journey_sub_pract") : t("journey_sub")}</div>
        ${aiNote}
      </div>
      <div class="j-progress">
        <div class="j-tools">
          ${profileControl}
          <button id="modeBtn" class="tool-btn">${mode === "client" ? t("mode_practitioner") : t("mode_client")}</button>
          <button id="themeBtn" class="tool-btn">${theme === "light" ? t("theme_dark") : t("theme_light")}</button>
          <button id="langBtn" class="tool-btn">${lang === "en" ? "RU" : "EN"}</button>
        </div>
        <div class="j-count">${t("authorized_of", journey.authorized, journey.total)}</div>
        <div class="j-bar"><div class="j-fill" style="width:${pct}%"></div></div>
      </div>
    </div>`);

  for (const sector of journey.sectors) {
    const nodes = journey.nodes.filter((n) => n.sector === sector.n);
    parts.push(`<div class="phase-label">${esc(phaseLabel(sector))}</div>`);

    for (const n of nodes.filter((x) => x.status !== "planned")) {
      const btnClass = n.status === "authorized" ? "btn-outline" : "btn-fill";
      const chips = (n.skippable && !isSettled(n.status) ? `<span class="chip skippable">${t("chip_skippable")}</span>` : "") + statusChips(n.status);
      const isCurrent = n.id === current;
      parts.push(`
        <div class="node-card${isCurrent ? " current" : ""}">
          ${isCurrent ? `<div class="current-tag">${t("current_tag")}</div>` : ""}
          <div class="row1"><div class="title">${esc(nodeTitle(n))}</div><div class="chips">${chips}</div></div>
          ${summaryLine(n)}
          <div class="row3">
            <div class="dep">${esc(depHint(n))}</div>
            <button class="${btnClass}" data-open="${n.id}">${actionLabel(n)}</button>
          </div>
        </div>`);
    }

    const planned = nodes.filter((x) => x.status === "planned");
    if (sector.n <= 2) {
      for (const n of planned) {
        const chips = (n.skippable ? `<span class="chip skippable">${t("chip_skippable")}</span>` : "") + chipHtml("planned");
        parts.push(`
          <div class="node-row">
            <div class="title">${esc(nodeTitle(n))} <span class="dep">${esc(depHint(n))}</span></div>
            <div class="chips">${chips}</div>
          </div>`);
      }
    } else if (planned.length) {
      parts.push(`<div class="cond-grid">${planned
        .map((n) => `<div class="cond-cell">${esc(nodeTitle(n))} <span class="dep">${esc(depHint(n))}</span></div>`)
        .join("")}</div>`);
    }
  }

  journeyEl.innerHTML = parts.join("");
  for (const btn of journeyEl.querySelectorAll("[data-open]")) {
    btn.addEventListener("click", () => openModal(btn.dataset.open));
  }
  $("themeBtn").addEventListener("click", () => {
    theme = theme === "light" ? "dark" : "light";
    localStorage.setItem("theme", theme);
    applyTheme();
    renderJourney();
  });
  $("langBtn").addEventListener("click", () => {
    lang = lang === "en" ? "ru" : "en";
    localStorage.setItem("lang", lang);
    applyTheme();
    renderJourney();
  });
  $("modeBtn").addEventListener("click", () => {
    mode = mode === "client" ? "practitioner" : "client";
    localStorage.setItem("mode", mode);
    renderJourney();
  });
  const sel = $("profileSel");
  if (sel) {
    sel.addEventListener("change", () => {
      if (sel.value === "__new") return newProfileInput(sel);
      profile = sel.value;
      localStorage.setItem("profile", profile);
      loadJourney();
    });
  }
}

/** Inline replacement for window.prompt (unavailable in the Electron shell). */
function newProfileInput(sel) {
  const input = document.createElement("input");
  input.id = "profileNew";
  input.placeholder = t("profile_name_placeholder");
  sel.replaceWith(input);
  input.focus();
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") return renderJourney();
    if (e.key !== "Enter") return;
    const name = input.value.trim();
    if (!name) return;
    const res = await fetch("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      profile = (await res.json()).id;
      localStorage.setItem("profile", profile);
      await loadProfiles();
    }
    loadJourney();
  });
  input.addEventListener("blur", () => {
    if (document.getElementById("profileNew")) renderJourney();
  });
}

/* ── modal shell ─────────────────────────────────────── */

function setChip(status) {
  const chip = $("modalChip");
  chip.className = `chip ${status}`;
  chip.textContent = t(`chip_${status}`);
}

function setStaleChip(show) {
  const el = $("modalStaleChip");
  el.hidden = !show;
  if (show) {
    el.textContent = t("chip_stale");
    el.dataset.tip = t("stale_tooltip");
  }
}

function setView(view) {
  modal.view = view;
  $("chatView").hidden = view !== "chat";
  $("reviewView").hidden = view !== "review";
  $("exitHint").textContent = view === "review" ? t("exit_draft") : t("exit_saved");
  setChip(view === "review" ? "drafted" : "in_progress");
  if (view === "chat") setStaleChip(false);
}

function setStatusLine(text) {
  const el = $("reviewStatus");
  el.hidden = !text;
  el.textContent = text ?? "";
}

function applyModalStrings() {
  $("exitBtn").childNodes[0].textContent = `${t("exit")} `;
  $("tToggle").childNodes[1].textContent = ` ${t("transparency")} `;
  $("tLabelWhat").textContent = t("t_what");
  $("tLabelCompiled").textContent = t("t_compiled");
  $("input").placeholder = t("placeholder");
  $("sendBtn").textContent = t("send");
  $("changesBtn").textContent = t("ask_changes");
  $("saveEdit").textContent = t("save_wording");
  $("practAmendSend").textContent = t("send");
}

async function openModal(id) {
  if (mode === "practitioner") return openPractitioner(id);
  const node = byId(id);
  // Authorized nodes open straight into review of the saved artifact (no model
  // call); derived nodes never show the chat — status + review only.
  const reviewMode = isSettled(node.status);
  const chatless = reviewMode || node.kind === "derived";
  modal = { node, view: "chat", review: null, reviewMode, chatless };

  applyModalStrings();
  $("modalTitle").textContent = nodeTitle(node);
  $("modalPhase").textContent = phaseLabel(journey.sectors.find((s) => s.n === node.sector));
  $("messages").innerHTML = "";
  $("reviewBody").hidden = true;
  $("amendBox").hidden = true;
  $("practView").hidden = true;
  $("tPanel").hidden = true;
  $("tArrow").textContent = "▸";
  $("scrim").hidden = false;

  if (chatless) {
    setView("review");
    setChip(reviewMode ? "authorized" : "in_progress");
    setStaleChip(reviewMode && node.status === "stale");
    setStatusLine(reviewMode ? null : t("status_preparing"));
  } else {
    setView("chat");
    setStaleChip(false);
  }

  const pb = await (await fetch(`/api/playbook/${id}?lang=${lang}`)).json();
  $("tWhat").textContent = (lang !== "en" ? `${t("playbook_lang_note")}\n\n` : "") + pb.purpose;
  $("tCompiled").innerHTML = compiledHtml(pb.compiled);

  let resuming = false;
  if (node.status === "in_progress" && node.kind === "conversation") {
    const sessRes = await fetch(api(`/api/session/${id}`));
    if (sessRes.ok) {
      const saved = await sessRes.json();
      for (const e of saved.exchange ?? []) addMsg(e.speaker === "user" ? "user" : "say", e.text);
      addMsg("note", t("resumed_note"));
      resuming = true;
    }
  }

  connect(id, { resuming, review: reviewMode });
}

function closeModal() {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  if (pract) {
    // Fire pending debounced saves before the state goes away.
    if (pract.draftTimer) saveDraft();
    if (pract.sessionTimer) saveSession();
    pract = null;
  }
  $("scrim").hidden = true;
  modal = null;
  loadJourney();
}

function compiledHtml(compiled) {
  const parts = [];
  for (const stage of compiled.stages) {
    parts.push(`<h5>${esc(t("t_interviewer", stage.id))}</h5>${esc(stage.system)}`);
    parts.push(`<h5>${esc(t("t_checklist"))}</h5>${esc(stage.done_when.map((d) => `- ${d}`).join("\n"))}`);
  }
  if (compiled.checker) parts.push(`<h5>${esc(t("t_checker"))}</h5>${esc(compiled.checker)}`);
  for (const step of compiled.induce) {
    parts.push(`<h5>${esc(t("t_step", step.id, step.model_tier))}</h5>${esc(step.system)}`);
    parts.push(`<h5>${esc(t("t_shape"))}</h5>${esc(JSON.stringify(step.output_schema, null, 2))}`);
  }
  parts.push(`<h5>${esc(t("t_runtime_label"))}</h5>${esc(t("t_runtime"))}`);
  return parts.join("\n");
}

/* ── conversation ────────────────────────────────────── */

function addMsg(cls, text) {
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  div.textContent = text;
  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
}

/** Engine notes arrive in English; map the known ones to the UI language. */
function localizeNote(text) {
  if (lang === "en") return text;
  const topic = text.match(/^\(topic (\d+) of (\d+): (.+)\)$/);
  if (topic) return t("topic_note", topic[1], topic[2], topic[3]);
  if (text.startsWith("(the conversation is complete")) return t("drafting_note");
  if (text.startsWith("(revising")) return t("revising_note");
  return text;
}

function enableComposer(placeholder) {
  $("composer").classList.remove("disabled");
  $("input").disabled = false;
  if (placeholder && placeholder.includes("esume")) $("input").placeholder = t("placeholder_resume");
  else if (placeholder && placeholder !== "you") $("input").placeholder = placeholder;
  else $("input").placeholder = t("placeholder");
  $("input").focus();
}

function disableComposer() {
  $("composer").classList.add("disabled");
  $("input").disabled = true;
}

function connect(id, { resuming = false, review = false } = {}) {
  const langParam = lang === "en" ? "" : `&lang=${lang}`;
  const resumeParam = resuming ? "&resume=1" : "";
  const modeParam = review ? "&mode=review" : "";
  const profileParam = profile === "default" ? "" : `&profile=${encodeURIComponent(profile)}`;
  ws = new WebSocket(`ws://${location.host}/ws?playbook=${id}${langParam}${resumeParam}${modeParam}${profileParam}`);

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "say") {
      if (modal?.chatless) return setStatusLine(msg.text);
      if (msg.anchor) addMsg("note anchor", t("anchor_label"));
      addMsg("say", msg.text);
    }
    else if (msg.type === "note") {
      const text = localizeNote(msg.text);
      if (modal?.chatless || modal?.view === "review") setStatusLine(text);
      else addMsg("note", text);
    }
    else if (msg.type === "error") {
      if (modal?.chatless) setStatusLine(msg.text);
      else addMsg("error", msg.text);
    }
    else if (msg.type === "ask") enableComposer(msg.text);
    else if (msg.type === "review") showReview(msg.payload);
    else if (msg.type === "done") {
      if (msg.text === "authorized") {
        setChip("authorized");
        setTimeout(closeModal, 600);
      } else if (!modal?.chatless) {
        addMsg("note", t("session_saved", msg.text));
      }
    }
  };

  ws.onclose = () => {
    ws = null;
    disableComposer();
    $("amendBox").classList.remove("busy");
    if (modal && !modal.chatless) addMsg("note", t("conn_closed"));
  };
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("input").value.trim();
  if (!text || !ws) return;
  addMsg("user", text);
  ws.send(JSON.stringify({ type: "answer", text }));
  $("input").value = "";
  disableComposer();
});

/* ── review & authorize ──────────────────────────────── */

function shortEntry(node) {
  const dict = STR[lang].short;
  return dict[node.id] ?? dict.default;
}

function markVerbatim(text, quotes) {
  let html = esc(text);
  for (const q of [...quotes].sort((a, b) => b.length - a.length)) {
    const eq = esc(q);
    if (eq.length > 2) html = html.split(eq).join(`<mark>${eq}</mark>`);
  }
  return html;
}

function quotesIn(text, quotes) {
  return quotes.filter((q) => text.includes(q)).length;
}

/* Recursive human rendering of a structured draft — never raw JSON. */
const HIDDEN_KEYS = new Set([
  "_verbatim_warnings", "candidates",
  "named_order", "spoken_order", "first_mentioned_rank", "order",
]);

function renderValue(value, quotes) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return `<div class="field-value">${markVerbatim(value, quotes)}</div>`;
  if (typeof value === "number" || typeof value === "boolean") {
    return `<div class="field-value">${esc(String(value))}</div>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    if (value.every((v) => typeof v === "string")) {
      return `<ul>${value.map((v) => `<li>${markVerbatim(v, quotes)}</li>`).join("")}</ul>`;
    }
    return value.map((v) => `<div class="sub-card">${renderValue(v, quotes)}</div>`).join("");
  }
  if (typeof value === "object") return renderFields(value, quotes);
  return "";
}

function renderFields(obj, quotes) {
  const parts = [];
  for (const [key, value] of Object.entries(obj)) {
    if (HIDDEN_KEYS.has(key)) continue;
    const rendered = renderValue(value, quotes);
    if (!rendered) continue;
    parts.push(`<div class="field-label">${esc(key.replaceAll("_", " "))}</div>`);
    parts.push(rendered);
  }
  return parts.join("");
}

function renderDraftBody() {
  const { payload, currentText, edited } = modal.review;
  const body = $("draftBody");

  if (payload.mode === "candidates") {
    body.innerHTML = edited ? esc(currentText) : markVerbatim(currentText, payload.verified_quotes);
    const others = payload.candidates.filter((c) => c !== currentText);
    const alt = $("altList");
    if (!edited && others.length) {
      alt.hidden = false;
      alt.innerHTML =
        `<div class="alt-label">${t("alt_label")}</div>` +
        others.map((c, i) => `<button class="alt-option" data-alt="${i}">${markVerbatim(c, payload.verified_quotes)}</button>`).join("");
      alt.querySelectorAll("[data-alt]").forEach((b) =>
        b.addEventListener("click", () => {
          modal.review.currentText = others[Number(b.dataset.alt)];
          renderDraftBody();
        }),
      );
    } else {
      alt.hidden = true;
    }
  } else {
    $("altList").hidden = true;
    body.innerHTML = renderFields(payload.draft, payload.verified_quotes);
  }

  const verify = $("verifyLine");
  if (edited) {
    verify.innerHTML = `<span>✓</span> ${t("edited_by_you")}`;
  } else {
    const n = payload.mode === "candidates"
      ? quotesIn(currentText, payload.verified_quotes)
      : payload.verified_quotes.length;
    verify.innerHTML = n > 0 ? `<span>✓</span> ${t("verified", n)}` : "";
  }
}

function showReview(payload) {
  modal.review = { payload, currentText: payload.candidates[0] ?? "", edited: false };
  setView("review");
  setStatusLine(null);
  $("reviewBody").hidden = false;
  $("amendBox").classList.remove("busy");
  const stale = modal.node.status === "stale";
  setChip(payload.existing ? "authorized" : "drafted");
  setStaleChip(payload.existing && stale);
  $("staleNote").hidden = !(payload.existing && stale);
  $("staleNote").textContent = t("stale_note");

  const short = shortEntry(modal.node);
  $("reviewExplainer").textContent = t("review_explainer", short.label);
  $("draftKicker").textContent = payload.existing ? t("kicker_existing", short.label) : t("kicker", short.label);
  $("authorizeBtn").textContent = short.auth;
  $("reviewFoot").textContent = payload.authorize_language;
  $("editBtn").hidden = payload.mode !== "candidates";
  $("editBtn").textContent = t("edit_wording");
  $("changesBtn").textContent = t("ask_changes");
  $("reprocessBtn").hidden = !modal.reviewMode && !payload.existing;
  $("reprocessBtn").textContent = modal.node.kind === "derived" ? t("reprocess") : t("reprocess_conversation");
  $("restartBtn").hidden = !(modal.reviewMode && modal.node.kind === "conversation");
  $("restartBtn").textContent = t("restart_interview");
  $("editArea").hidden = true;
  $("draftBody").hidden = false;
  renderDraftBody();
}

$("editBtn").addEventListener("click", () => {
  const editing = $("editArea").hidden;
  $("editArea").hidden = !editing;
  $("draftBody").hidden = editing;
  if (editing) $("draftTextarea").value = modal.review.currentText;
  $("editBtn").textContent = editing ? t("cancel_edit") : t("edit_wording");
});

$("saveEdit").addEventListener("click", () => {
  const text = $("draftTextarea").value.trim();
  if (text) {
    modal.review.currentText = text;
    modal.review.edited = true;
  }
  $("editArea").hidden = true;
  $("draftBody").hidden = false;
  $("editBtn").textContent = t("edit_wording");
  renderDraftBody();
});

$("changesBtn").addEventListener("click", () => {
  const box = $("amendBox");
  box.hidden = !box.hidden;
  $("changesBtn").classList.toggle("active", !box.hidden);
  if (!box.hidden) {
    $("amendInput").placeholder = t("amend_placeholder");
    $("amendInput").focus();
  }
});

$("amendBox").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("amendInput").value.trim();
  if (!text || !ws) return;
  ws.send(JSON.stringify({ type: "review_action", action: "feedback", text }));
  $("amendInput").value = "";
  $("amendBox").classList.add("busy");
  setStatusLine(t("status_revising"));
});

$("amendInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("amendBox").requestSubmit();
  }
});

$("reprocessBtn").addEventListener("click", () => {
  if (!ws) return;
  ws.send(JSON.stringify({ type: "review_action", action: "reprocess" }));
  setStatusLine(t("status_revising"));
});

$("restartBtn").addEventListener("click", () => {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  modal.reviewMode = false;
  modal.chatless = modal.node.kind === "derived";
  $("reviewBody").hidden = true;
  $("amendBox").hidden = true;
  $("messages").innerHTML = "";
  setView("chat");
  connect(modal.node.id, { resuming: false, review: false });
});

$("authorizeBtn").addEventListener("click", () => {
  if (!ws || !modal.review) return;
  const { payload, currentText } = modal.review;
  const msg = { type: "review_action", action: "authorize" };
  if (payload.mode === "candidates") msg.value = currentText;
  ws.send(JSON.stringify(msg));
});

/* ── practitioner mode ───────────────────────────────── */

async function openPractitioner(id) {
  const node = byId(id);
  modal = { node, practitioner: true, chatless: true, view: "pract" };
  pract = {
    node, content: {}, origin: "manual", answers: {}, candidates: [],
    pb: null, upstream: {}, session: null, readonlyScript: false,
    draftTimer: null, sessionTimer: null, busy: false,
  };

  applyModalStrings();
  $("modalTitle").textContent = nodeTitle(node);
  $("modalPhase").textContent = phaseLabel(journey.sectors.find((s) => s.n === node.sector));
  $("chatView").hidden = true;
  $("reviewView").hidden = true;
  $("practView").hidden = false;
  $("tPanel").hidden = true;
  $("tArrow").textContent = "▸";
  $("exitHint").textContent = t("exit_saved");
  setChip(isSettled(node.status) ? "authorized" : node.status === "in_progress" ? "in_progress" : "available");
  setStaleChip(node.status === "stale");
  $("scrim").hidden = false;
  $("stageList").innerHTML = "";
  $("formBody").innerHTML = "";

  const [pbRes, artRes, draftRes, upRes, sessRes] = await Promise.all([
    fetch(`/api/playbook/${id}?lang=${lang}`),
    fetch(api(`/api/artifact/${id}`)),
    fetch(api(`/api/draft/${id}`)),
    fetch(api(`/api/upstream/${id}`)),
    fetch(api(`/api/session/${id}`)),
  ]);
  if (!pract || pract.node.id !== id) return; // closed meanwhile

  const pb = await pbRes.json();
  pract.pb = pb;
  $("tWhat").textContent = (lang !== "en" ? `${t("playbook_lang_note")}\n\n` : "") + pb.purpose;
  $("tCompiled").innerHTML = compiledHtml(pb.compiled);

  const artifact = artRes.ok ? await artRes.json() : null;
  const draft = draftRes.ok ? await draftRes.json() : null;
  pract.upstream = upRes.ok ? (await upRes.json()).upstream ?? {} : {};
  pract.session = sessRes.ok ? await sessRes.json() : null;

  // A pending draft outranks the authorized artifact; a blank slate is manual.
  pract.content = structuredClone(draft?.content ?? artifact?.content ?? {});
  pract.origin = draft?.origin ?? artifact?.origin ?? (artifact ? "generated" : "manual");
  if (pract.session?.manual_answers) pract.answers = { ...pract.session.manual_answers };
  pract.readonlyScript = Boolean(pract.session && !pract.session.manual_answers && pract.session.exchange?.length);

  renderPractitioner();
}

function renderPractitioner() {
  const { pb, node } = pract;

  const isConv = pb.stages.length > 0;
  $("scriptSection").hidden = !isConv;
  if (isConv) {
    $("scriptTitle").textContent = t("script_title");
    $("scriptHint").textContent = t("script_hint");
    $("scriptNote").hidden = !pract.readonlyScript;
    $("scriptNote").textContent = t("script_readonly");
    renderScript();
  }

  const deps = Object.keys(pract.upstream);
  $("sourcesSection").hidden = deps.length === 0;
  if (deps.length) {
    $("sourcesTitle").textContent = t("sources_title");
    $("sourcesList").innerHTML = deps.map((dep) => `
      <details><summary>${esc(nodeTitle(byId(dep) ?? { id: dep, title: dep }))}</summary>
        <div class="src-body">${renderFields(pract.upstream[dep], [])}</div>
      </details>`).join("");
  }

  $("formTitle").textContent = t("artifact_section");
  renderForm();

  $("generateBtn").hidden = !journey.ai;
  $("generateBtn").disabled = false;
  $("generateBtn").textContent = pb.kind === "conversation" ? t("btn_generate_interview") : t("btn_generate_sources");
  $("practAmendBtn").hidden = !journey.ai;
  $("practAmendBtn").textContent = t("ask_changes");
  $("practAmendBtn").classList.remove("active");
  $("practAmendBox").hidden = true;
  $("practAmendInput").placeholder = t("amend_placeholder");
  $("practAuthorizeBtn").textContent = shortEntry(node).auth;
  $("practFoot").textContent = pb.authorize_language ?? "";
  $("saveLine").hidden = true;
  $("formWarnings").hidden = true;
}

function renderScript() {
  const stages = pract.pb.stages;
  if (pract.readonlyScript) {
    $("stageList").innerHTML = `<div class="pract-transcript">${(pract.session.exchange ?? [])
      .map((e) => `<div class="msg ${e.speaker === "user" ? "user" : "say"}">${esc(e.text)}</div>`).join("")}</div>`;
    return;
  }
  $("stageList").innerHTML = stages.map((s, i) => `
    <div class="stage-card">
      <div class="stage-num">${t("stage_label", i + 1, stages.length)} · ${esc(s.id)}</div>
      <div class="stage-q">${esc(s.opening)}</div>
      ${s.probes.length || s.done_when.length ? `
      <details>
        <summary>${t("stage_hints")}</summary>
        <ul>
          ${s.probes.map((p) => `<li>${esc(p.when)} → ${esc(p.then)}</li>`).join("")}
          ${s.done_when.map((d) => `<li>✓ ${esc(d)}</li>`).join("")}
        </ul>
      </details>` : ""}
      <textarea class="f-text" data-stage="${esc(s.id)}" rows="3"
        placeholder="${esc(t("answer_placeholder"))}">${esc(pract.answers[s.id] ?? "")}</textarea>
    </div>`).join("");
  for (const ta of $("stageList").querySelectorAll("[data-stage]")) {
    ta.addEventListener("input", () => {
      pract.answers[ta.dataset.stage] = ta.value;
      scheduleSessionSave();
    });
  }
}

/* ── schema-driven form editor ───────────────────────── */

const schemaType = (s) => {
  const ty = s?.type;
  return Array.isArray(ty) ? (ty.find((x) => x !== "null") ?? "string") : ty;
};

function schemaAt(path) {
  let s = { type: "object", properties: pract.pb.form?.properties ?? {} };
  for (const seg of path.split(".")) {
    s = /^\d+$/.test(seg) ? (s?.items ?? {}) : (s?.properties?.[seg] ?? {});
  }
  return s;
}

function emptyItem(itemSchema) {
  if (schemaType(itemSchema) !== "object") return "";
  const obj = {};
  for (const [k, ps] of Object.entries(itemSchema.properties ?? {})) {
    obj[k] = schemaType(ps) === "array" ? [] : "";
  }
  return obj;
}

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== "object") {
      o[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    }
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

function fieldHtml(key, s, value, path) {
  const ty = s.enum ? "enum" : (schemaType(s) ?? (Array.isArray(value) ? "array" : "string"));
  const verbatim = s["x-verbatim"] === true || s.items?.["x-verbatim"] === true;
  const label = `<div class="f-label">${esc(key.replaceAll("_", " "))}${
    verbatim ? ` <span class="v-hint">❝ ${t("verbatim_hint")}</span>` : ""}</div>`;

  if (ty === "enum") {
    const current = s.enum.includes(value) ? value : s.enum[0];
    const opts = s.enum.map((o) =>
      `<option value="${esc(o)}"${o === current ? " selected" : ""}>${esc(String(o).replaceAll("_", " "))}</option>`).join("");
    return `${label}<select class="f-select" data-path="${esc(path)}">${opts}</select>`;
  }
  if (ty === "array") {
    const items = s.items ?? {};
    const arr = Array.isArray(value) ? value : [];
    const rows = schemaType(items) === "object"
      ? arr.map((v, i) =>
          `<div class="f-card"><button type="button" class="f-remove" data-remove="${esc(path)}" data-i="${i}">✕</button>${
            Object.entries(items.properties ?? {})
              .filter(([k]) => !HIDDEN_KEYS.has(k))
              .map(([k, ps]) => fieldHtml(k, ps, v?.[k], `${path}.${i}.${k}`)).join("")}</div>`).join("")
      : arr.map((v, i) =>
          `<div class="f-row"><textarea class="f-text${items["x-verbatim"] ? " verbatim" : ""}" data-path="${esc(path)}.${i}" rows="2">${esc(v ?? "")}</textarea><button type="button" class="f-remove" data-remove="${esc(path)}" data-i="${i}">✕</button></div>`).join("");
    return `${label}${rows}<button type="button" class="f-add" data-add="${esc(path)}">${t("form_add")}</button>`;
  }
  if (ty === "object" && s.properties) {
    return `${label}<div class="f-card">${Object.entries(s.properties)
      .filter(([k]) => !HIDDEN_KEYS.has(k))
      .map(([k, ps]) => fieldHtml(k, ps, value?.[k], `${path}.${k}`)).join("")}</div>`;
  }
  if (ty === "integer" || ty === "number") {
    return `${label}<input type="number" class="f-select" data-path="${esc(path)}" value="${value ?? ""}" />`;
  }
  const text = typeof value === "string" ? value : "";
  const rows = Math.min(10, Math.max(2, Math.ceil(text.length / 90)));
  return `${label}<textarea class="f-text${s["x-verbatim"] ? " verbatim" : ""}" data-path="${esc(path)}" rows="${rows}" placeholder="${esc(String(s.description ?? "").trim())}">${esc(text)}</textarea>`;
}

function renderForm() {
  const props = pract.pb.form?.properties ?? {};
  const parts = [];
  for (const [key, s] of Object.entries(props)) {
    if (HIDDEN_KEYS.has(key)) continue;
    parts.push(fieldHtml(key, s, pract.content[key], key));
    if (key === pract.pb.choice_field && pract.candidates.length > 0) {
      const others = pract.candidates.filter((c) => c !== pract.content[key]);
      if (others.length) {
        parts.push(`<div class="alt-label">${t("alt_label")}</div>` + others
          .map((c) => `<button type="button" class="alt-option" data-cand="${esc(c)}">${esc(c)}</button>`).join(""));
      }
    }
  }
  const body = $("formBody");
  body.innerHTML = parts.join("");

  // Enum selects have no empty option — make the displayed default real in
  // the content, so authorizing an untouched select records what it shows.
  body.querySelectorAll("select[data-path]").forEach((el) => {
    if (getPath(pract.content, el.dataset.path) !== el.value) setPath(pract.content, el.dataset.path, el.value);
  });

  body.querySelectorAll("[data-path]").forEach((el) => {
    el.addEventListener("input", () => {
      const val = el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value;
      setPath(pract.content, el.dataset.path, val);
      touchContent();
    });
  });
  body.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
    const path = b.dataset.add;
    const arr = Array.isArray(getPath(pract.content, path)) ? getPath(pract.content, path) : [];
    arr.push(emptyItem(schemaAt(path).items ?? {}));
    setPath(pract.content, path, arr);
    renderForm();
    touchContent();
  }));
  body.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
    const arr = getPath(pract.content, b.dataset.remove);
    if (Array.isArray(arr)) arr.splice(Number(b.dataset.i), 1);
    renderForm();
    touchContent();
  }));
  body.querySelectorAll("[data-cand]").forEach((b) => b.addEventListener("click", () => {
    pract.content[pract.pb.choice_field] = b.dataset.cand;
    renderForm();
    touchContent();
  }));
  updateAuthorizeState();
}

function hasContent(v) {
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.some(hasContent);
  if (v && typeof v === "object") return Object.values(v).some(hasContent);
  return v != null && v !== "";
}

function updateAuthorizeState() {
  $("practAuthorizeBtn").disabled = pract.busy || !hasContent(pract.content);
}

/** Hand edits taint model output: generated → mixed. Manual stays manual. */
function touchContent() {
  if (pract.origin === "generated") pract.origin = "mixed";
  scheduleDraftSave();
  updateAuthorizeState();
}

/* ── persistence & AI assists ────────────────────────── */

function scheduleDraftSave() {
  clearTimeout(pract.draftTimer);
  pract.draftTimer = setTimeout(saveDraft, 900);
}

async function saveDraft() {
  clearTimeout(pract.draftTimer);
  const { node, content, origin } = pract;
  pract.draftTimer = null;
  const res = await fetch(api(`/api/draft/${node.id}`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, origin }),
  });
  if (!res.ok || !pract || pract.node.id !== node.id) return;
  showWarnings((await res.json()).warnings);
  $("saveLine").hidden = false;
  $("saveLine").textContent = `✓ ${t("draft_saved")}`;
}

function scheduleSessionSave() {
  clearTimeout(pract.sessionTimer);
  pract.sessionTimer = setTimeout(saveSession, 900);
}

async function saveSession() {
  clearTimeout(pract.sessionTimer);
  const { node, answers } = pract;
  pract.sessionTimer = null;
  await fetch(api(`/api/manual-session/${node.id}?lang=${lang}`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers }),
  });
}

function showWarnings(warnings) {
  const box = $("formWarnings");
  if (!warnings?.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = `${esc(t("warnings_title"))}<ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`;
}

function showPractError(msg) {
  const box = $("formWarnings");
  box.hidden = false;
  box.textContent = msg;
}

async function compose(feedback) {
  if (!pract || pract.busy) return;
  pract.busy = true;
  const node = pract.node;
  $("generateBtn").disabled = true;
  $("generateBtn").textContent = t("btn_generating");
  $("formBody").classList.add("busy");
  $("practAmendBox").classList.add("busy");
  updateAuthorizeState();
  try {
    // The model reads the recorded interview from disk — flush it first.
    if (pract.sessionTimer) await saveSession();
    const res = await fetch(api(`/api/compose/${node.id}?lang=${lang}`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(feedback ? { feedback, prior: pract.content } : {}),
    });
    const data = await res.json();
    if (!pract || pract.node.id !== node.id) return;
    if (!res.ok) throw new Error(data.error ?? `${res.status}`);
    pract.origin = feedback && pract.origin !== "generated" ? "mixed" : "generated";
    pract.content = data.content ?? {};
    pract.candidates = data.candidates ?? [];
    renderForm();
    showWarnings(data.warnings);
    saveDraft();
  } catch (err) {
    if (pract) showPractError(t("compose_failed", err.message));
  } finally {
    if (pract && pract.node.id === node.id) {
      pract.busy = false;
      $("formBody").classList.remove("busy");
      $("practAmendBox").classList.remove("busy");
      $("generateBtn").disabled = false;
      $("generateBtn").textContent =
        pract.pb.kind === "conversation" ? t("btn_generate_interview") : t("btn_generate_sources");
      updateAuthorizeState();
    }
  }
}

$("generateBtn").addEventListener("click", () => compose());

$("practAmendBtn").addEventListener("click", () => {
  if (!pract) return;
  const box = $("practAmendBox");
  box.hidden = !box.hidden;
  $("practAmendBtn").classList.toggle("active", !box.hidden);
  if (!box.hidden) $("practAmendInput").focus();
});

$("practAmendBox").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("practAmendInput").value.trim();
  if (!text || !pract) return;
  $("practAmendInput").value = "";
  compose(text);
});

$("practAmendInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("practAmendBox").requestSubmit();
  }
});

$("practAuthorizeBtn").addEventListener("click", async () => {
  if (!pract || pract.busy) return;
  clearTimeout(pract.draftTimer);
  pract.draftTimer = null;
  if (pract.sessionTimer) await saveSession();
  const res = await fetch(api(`/api/authorize/${pract.node.id}`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: pract.content, origin: pract.origin }),
  });
  if (!pract) return;
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    return showPractError(d.error ?? `${res.status}`);
  }
  showWarnings((await res.json()).warnings);
  setChip("authorized");
  setStaleChip(false);
  setTimeout(closeModal, 600);
});

/* ── shell events ────────────────────────────────────── */

$("exitBtn").addEventListener("click", closeModal);

$("tToggle").addEventListener("click", () => {
  const panel = $("tPanel");
  panel.hidden = !panel.hidden;
  $("tArrow").textContent = panel.hidden ? "▸" : "▾";
});

$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal) closeModal();
});

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

loadProfiles().then(loadJourney);
