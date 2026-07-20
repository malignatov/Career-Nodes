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

/** Will authorizing this node leave the user with a natural next step? */
function hasNextAfter(node) {
  if (node.id === "closing_check") return false; // the journey's end
  const actionable = (s) => s === "available" || s === "in_progress" || s === "stale";
  return journey.nodes.some((n) => n.id !== node.id && actionable(n.status))
    || node.feeds.some((id) => byId(id)?.status === "planned");
}

function summaryLine(n) {
  if (isSettled(n.status) && n.distilled?.length) {
    const parts = n.distilled
      .map((p) => `${p.label ? `<div class="sum-label">${esc(p.label)}</div>` : ""}<p>${esc(p.text)}</p>`)
      .join("");
    return `<div class="summary distilled">${parts}</div>`;
  }
  if (n.status === "in_progress") {
    return `<div class="summary">${t(mode === "practitioner" ? "in_progress_summary_pract" : "in_progress_summary")}</div>`;
  }
  return `<div class="summary">${esc(nodeDesc(n))}</div>`;
}

/** Everything the braid surface needs from the app — no globals cross the seam. */
function braidCtx() {
  return {
    journey, t, lang, theme, mode, profile, profiles, profileName,
    nodeTitle, nodeDesc, phaseLabel, esc, api, connect, wsSend,
    currentNodeId, isSettled, markVerbatim, localizeNote, exportPdf,
    renderFields, compiledHtml,
    wsLive: () => Boolean(ws),
    stopDictation() {
      stopVoice(true);
      micBtn.hidden = true;
    },
    voice: {
      enabled: () => journey?.voice === true,
      active: () => Boolean(voice),
      start(el) { startVoice(el); },
      stop() { stopVoice(); },
    },
    reload: loadJourney,
    async reset() {
      await fetch(api("/api/reset"), { method: "POST" });
      await loadJourney();
    },
    closeWs() {
      if (ws) { ws.onclose = null; ws.close(); ws = null; }
    },
    actions: {
      toggleTheme() {
        theme = theme === "light" ? "dark" : "light";
        localStorage.setItem("theme", theme);
        applyTheme();
        renderJourney();
      },
      toggleLang() {
        lang = lang === "en" ? "ru" : "en";
        localStorage.setItem("lang", lang);
        applyTheme();
        renderJourney();
      },
      toggleMode() {
        mode = mode === "client" ? "practitioner" : "client";
        localStorage.setItem("mode", mode);
        renderJourney();
      },
    },
  };
}

function renderJourney() {
  const braidActive = Boolean(window.Braid?.active?.()) && mode === "client";
  const braidMActive = !braidActive && Boolean(window.BraidM?.active?.()) && mode === "client";
  journeyEl.classList.toggle("braid-on", braidActive);
  journeyEl.classList.toggle("braidm-on", braidMActive);
  if (braidActive) {
    window.BraidM?.abortSession?.();
    window.Braid.renderJourney(journeyEl, braidCtx());
    return;
  }
  if (braidMActive) {
    window.Braid?.abortSession?.();
    window.BraidM.renderJourney(journeyEl, braidCtx());
    return;
  }
  // Leaving braid mode (resize, mode switch) must not strand a live inline
  // session — its DOM is about to be replaced.
  window.Braid?.abortSession?.();
  window.BraidM?.abortSession?.();
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
          ${journey.authorized > 0 ? `<button id="exportBtn" class="tool-btn" title="${esc(t("btn_export_title"))}">${t("btn_export")}</button>` : ""}
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

  const hasProgress = journey.nodes.some((n) => isSettled(n.status) || n.status === "in_progress");
  if (hasProgress) {
    parts.push(`<div class="j-footer"><button id="resetBtn" class="reset-link">${t("btn_reset")}</button></div>`);
  }

  journeyEl.innerHTML = parts.join("");
  for (const btn of journeyEl.querySelectorAll("[data-open]")) {
    btn.addEventListener("click", () => openModal(btn.dataset.open));
  }
  const resetBtn = $("resetBtn");
  if (resetBtn) resetBtn.addEventListener("click", () => resetProgress(resetBtn));
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
  const exportBtn = $("exportBtn");
  if (exportBtn) exportBtn.addEventListener("click", exportPdf);
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
  if (window.Braid?.active?.()) return window.Braid.openSession(id, braidCtx());
  if (window.BraidM?.active?.()) return window.BraidM.openSession(id, braidCtx());
  const node = byId(id);
  // Authorized nodes open straight into review of the saved artifact (no model
  // call); derived nodes never show the chat — status + review only.
  const reviewMode = isSettled(node.status);
  const chatless = reviewMode || node.kind === "derived";
  modal = { node, view: "chat", review: null, reviewMode, chatless };
  // Closing or reopening while the fetches below are in flight must strand
  // this invocation — its identity is the modal object it created.
  const myModal = modal;

  applyModalStrings();
  $("modalTitle").textContent = nodeTitle(node);
  $("modalPhase").textContent = phaseLabel(journey.sectors.find((s) => s.n === node.sector));
  $("messages").innerHTML = "";
  $("reviewBody").hidden = true;
  $("amendBox").hidden = true;
  $("practView").hidden = true;
  $("modal").classList.remove("wide");
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
  if (modal !== myModal) return;
  $("tWhat").textContent = (lang !== "en" ? `${t("playbook_lang_note")}\n\n` : "") + pb.purpose;
  $("tCompiled").innerHTML = compiledHtml(pb.compiled);

  let resuming = false;
  if (node.status === "in_progress" && node.kind === "conversation") {
    const sessRes = await fetch(api(`/api/session/${id}`));
    if (modal !== myModal) return;
    if (sessRes.ok) {
      const saved = await sessRes.json();
      if (modal !== myModal) return;
      for (const e of saved.exchange ?? []) addMsg(e.speaker === "user" ? "user" : "say", e.text);
      addMsg("note", t("resumed_note"));
      resuming = true;
    }
  }

  // Settled conversation nodes: the recorded interview stays reachable from
  // the review screen, folded above the draft.
  $("chatHistory").hidden = true;
  if (reviewMode && node.kind === "conversation") {
    const recRes = await fetch(api(`/api/session/${id}`));
    if (modal !== myModal) return;
    if (recRes.ok) {
      const rec = await recRes.json();
      if (modal !== myModal) return;
      if (rec.exchange?.length) {
        $("chatHistoryLabel").textContent = t("chat_history");
        $("chatHistoryBody").innerHTML = rec.exchange
          .map((e) => `<div class="msg ${e.speaker === "user" ? "user" : "say"}">${esc(e.text)}</div>`)
          .join("");
        $("chatHistory").hidden = false;
        $("chatHistory").open = false;
      }
    }
  }

  if (modal !== myModal) return;
  connect(id, { resuming, review: reviewMode });
}

function closeModal(thenContinue = false) {
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
  stopVoice(true);
  micBtn.hidden = true;
  $("scrim").hidden = true;
  modal = null;
  loadJourney().then(() => {
    // "Authorize and continue": flow straight into the next actionable step.
    if (thenContinue !== true) return;
    const next = currentNodeId();
    if (next) openModal(next);
  });
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

/* The modal's handling of session messages — one implementation of the
 * "surface" contract. The braid session view provides its own; connect()
 * itself stays the single WebSocket owner either way. */
const modalSurface = {
  say(text, anchor) {
    if (modal?.chatless) return setStatusLine(text);
    // Mid-review the chat column is hidden; the amend conversation's replies
    // surface on the status line instead.
    if (modal?.view === "review") return setStatusLine(text);
    if (anchor) addMsg("note anchor", t("anchor_label"));
    addMsg("say", text);
  },
  note(text) {
    const localized = localizeNote(text);
    if (modal?.chatless || modal?.view === "review") setStatusLine(localized);
    else addMsg("note", localized);
  },
  error(text) {
    if (modal?.chatless) setStatusLine(text);
    else addMsg("error", text);
  },
  ask(prompt) {
    // An ask during review is the amend conversation waiting for the next
    // note — reopen the amend box (its feedback resolves the ask server-side).
    if (modal?.view === "review") return $("amendBox").classList.remove("busy");
    enableComposer(prompt);
  },
  review(payload) {
    showReview(payload);
  },
  done(outcome) {
    if (outcome === "authorized") {
      setChip("authorized");
      const cont = modal?.continueAfter === true;
      setTimeout(() => closeModal(cont), 600);
    } else if (!modal?.chatless) {
      addMsg("note", t("session_saved", outcome));
    }
  },
  closed() {
    disableComposer();
    $("amendBox").classList.remove("busy");
    if (modal && !modal.chatless) addMsg("note", t("conn_closed"));
  },
};

let wsSurface = modalSurface;

/** Send on the live session socket. Returns false when there is none. */
function wsSend(obj) {
  if (!ws) return false;
  ws.send(JSON.stringify(obj));
  return true;
}

function connect(id, { resuming = false, review = false, surface } = {}) {
  // One socket at a time: a stale connect (e.g. an interrupted open) must
  // never leave a second session feeding the surface.
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  wsSurface = surface ?? modalSurface;
  const langParam = lang === "en" ? "" : `&lang=${lang}`;
  const resumeParam = resuming ? "&resume=1" : "";
  const modeParam = review ? "&mode=review" : "";
  const profileParam = profile === "default" ? "" : `&profile=${encodeURIComponent(profile)}`;
  ws = new WebSocket(`ws://${location.host}/ws?playbook=${id}${langParam}${resumeParam}${modeParam}${profileParam}`);

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "say") wsSurface.say(msg.text, Boolean(msg.anchor));
    else if (msg.type === "note") wsSurface.note(msg.text);
    else if (msg.type === "error") wsSurface.error(msg.text);
    else if (msg.type === "ask") wsSurface.ask(msg.text);
    else if (msg.type === "review") wsSurface.review(msg.payload);
    else if (msg.type === "done") wsSurface.done(msg.text);
  };

  ws.onclose = () => {
    ws = null;
    wsSurface.closed?.();
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

/* Verbatim trichotomy: <mark> = verified user words; "assumed" = a string
 * the composer offered as a quote that verification could not find in the
 * user's words or their authorized artifacts; plain = connective tissue. */
function flagged(value, quotes, warnings) {
  const marked = markVerbatim(value, quotes);
  if (warnings?.includes(value)) {
    return `<span class="assumed">${marked}</span><span class="assumed-tag">${esc(t("assumed_tag"))}</span>`;
  }
  return marked;
}

function renderValue(value, quotes, warnings) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return `<div class="field-value">${flagged(value, quotes, warnings)}</div>`;
  if (typeof value === "number" || typeof value === "boolean") {
    return `<div class="field-value">${esc(String(value))}</div>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    if (isEntityList(value)) return renderEntityBlocks(value, quotes, warnings);
    if (value.every((v) => typeof v === "string")) {
      return `<ul>${value.map((v) => `<li>${flagged(v, quotes, warnings)}</li>`).join("")}</ul>`;
    }
    return value.map((v) => `<div class="sub-card">${renderValue(v, quotes, warnings)}</div>`).join("");
  }
  if (typeof value === "object") return renderFields(value, quotes, warnings);
  return "";
}

/* Any list of titled things — role models, media, stories, recollections,
 * portrait movements, plan directions — reads as one block per entity: big
 * serif title, then its material. Titles must never get lost in a field dump. */
const TITLE_KEYS = ["name", "title", "headline"];
const ENTITY_SECTIONS = [
  ["similarities", "rm_similarities"],
  ["differences", "rm_differences"],
  ["descriptors", "rm_descriptors"],
];

function entityTitle(v) {
  for (const k of TITLE_KEYS) {
    if (typeof v[k] === "string" && v[k].trim()) return k;
  }
  return null;
}

function isEntityList(value) {
  return Array.isArray(value) && value.length > 0
    && value.every((v) => v && typeof v === "object" && !Array.isArray(v))
    && value.some((v) => entityTitle(v) !== null);
}

function renderEntityBlocks(list, quotes, warnings) {
  return list.map((m) => {
    const titleKey = entityTitle(m);
    let h = titleKey ? `<div class="rm-name">${flagged(m[titleKey], quotes, warnings)}</div>` : "";
    // Short scalar facts (a guide's relationship, a headline's verb) sit
    // under the title; long prose falls through to the body renderer below.
    // Nothing the user authorizes may vanish from the review.
    const rest = [];
    for (const [k, v] of Object.entries(m)) {
      if (k === titleKey || HIDDEN_KEYS.has(k)) continue;
      if (typeof v === "string" && v.trim() && v.length <= 90) {
        h += `<div class="rm-rel">${flagged(v, quotes, warnings)}</div>`;
      } else rest.push([k, v]);
    }
    for (const [field, key] of ENTITY_SECTIONS) {
      const items = (m[field] ?? [])
        .map((it) => (typeof it === "string" ? it : it?.text))
        .filter(Boolean);
      if (!items.length) continue;
      h += `<div class="rm-sec">${esc(t(key))}</div>`
        + items.map((it) => `<div class="rm-item">«<span>${flagged(it, quotes, warnings)}</span>»</div>`).join("");
    }
    for (const [k, v] of rest) {
      if (ENTITY_SECTIONS.some(([f]) => f === k)) continue;
      if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) {
        h += `<div class="rm-sec">${esc(k.replaceAll("_", " "))}</div>`
          + v.map((it) => `<div class="rm-item">«<span>${flagged(it, quotes, warnings)}</span>»</div>`).join("");
        continue;
      }
      const rendered = renderValue(v, quotes, warnings);
      if (!rendered) continue;
      h += `<div class="rm-sec">${esc(k.replaceAll("_", " "))}</div>${rendered}`;
    }
    return `<div class="rm-block">${h}</div>`;
  }).join("");
}

function renderFields(obj, quotes, warnings) {
  const parts = [];
  for (const [key, value] of Object.entries(obj)) {
    if (HIDDEN_KEYS.has(key)) continue;
    if (isEntityList(value)) {
      parts.push(renderEntityBlocks(value, quotes, warnings)); // no field label — the titles carry it
      continue;
    }
    const rendered = renderValue(value, quotes, warnings);
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
    body.innerHTML = renderFields(payload.draft, payload.verified_quotes, payload.warnings ?? []);
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
  if (!modal) return; // a stray frame after the modal closed
  modal.review = { payload, currentText: payload.candidates[0] ?? "", edited: false };
  setView("review");
  setStatusLine(null);
  $("reviewBody").hidden = false;
  $("amendBox").classList.remove("busy");
  // A fresh payload ends any amend conversation — thaw the actions.
  ["authorizeBtn", "changesBtn", "reprocessBtn", "editBtn", "restartBtn"]
    .forEach((id) => { $(id).disabled = false; });
  const stale = modal.node.status === "stale";
  setChip(payload.existing ? "authorized" : "drafted");
  setStaleChip(payload.existing && stale);
  $("staleNote").hidden = !(payload.existing && stale);
  $("staleNote").textContent = t("stale_note");

  const short = shortEntry(modal.node);
  $("reviewExplainer").textContent = t("review_explainer", short.label);
  $("draftKicker").textContent = payload.existing ? t("kicker_existing", short.label) : t("kicker", short.label);
  $("authorizeBtn").textContent = hasNextAfter(modal.node) ? t("btn_auth_continue") : short.auth;
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
  // .busy only blocks the pointer — Enter mid-turn must not eat the note.
  if ($("amendBox").classList.contains("busy")) return;
  const text = $("amendInput").value.trim();
  if (!text || !ws) return;
  ws.send(JSON.stringify({ type: "review_action", action: "feedback", text }));
  $("amendInput").value = "";
  $("amendBox").classList.add("busy");
  // The note opens a conversation; the counselor's reply lands on the status
  // line, and "revising…" comes from the server when it actually revises.
  setStatusLine("…");
  // The engine stops listening for review actions until the conversation
  // settles — freeze them so an Authorize click can't be silently swallowed.
  ["authorizeBtn", "changesBtn", "reprocessBtn", "editBtn", "restartBtn"]
    .forEach((id) => { $(id).disabled = true; });
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
  modal.continueAfter = hasNextAfter(modal.node);
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
  $("modal").classList.add("wide");
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
  $("primaryKicker").textContent = t("pane_primary");
  $("primarySub").textContent = isConv ? t("pane_primary_sub_conv") : t("pane_primary_sub_derived");
  $("secondaryKicker").textContent = t("pane_secondary");
  $("secondarySub").textContent = t("pane_secondary_sub");

  $("scriptSection").hidden = !isConv;
  if (isConv) {
    $("scriptNote").hidden = !pract.readonlyScript;
    $("scriptNote").textContent = pract.session?.settled ? t("script_record") : t("script_readonly");
    renderScript();
  }

  const deps = Object.keys(pract.upstream);
  $("sourcesSection").hidden = deps.length === 0;
  if (deps.length) {
    // For derived nodes the sources ARE the primary material — open them up;
    // in an interview they are reference context, folded away.
    $("sourcesList").innerHTML = deps.map((dep) => `
      <details${isConv ? "" : " open"}><summary>${esc(nodeTitle(byId(dep) ?? { id: dep, title: dep }))}</summary>
        <div class="src-body">${renderFields(pract.upstream[dep], [])}</div>
      </details>`).join("");
  }

  renderForm();

  $("generateBtn").hidden = !journey.ai;
  $("generateBtn").disabled = false;
  $("generateBtn").textContent = pb.kind === "conversation" ? t("btn_generate_interview") : t("btn_generate_sources");
  $("practAmendBtn").hidden = !journey.ai;
  $("practAmendBtn").textContent = t("ask_changes");
  $("practAmendBtn").classList.remove("active");
  $("practAmendBox").hidden = true;
  $("practAmendInput").placeholder = t("amend_placeholder");
  $("practAuthorizeBtn").textContent = hasNextAfter(node) ? t("btn_auth_continue") : shortEntry(node).auth;
  // The playbook's authorize_language speaks to the client ("your words…") —
  // client mode shows it; here the practitioner gets their own contract.
  $("practFoot").textContent = t("pract_foot");
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
      <div class="stage-q">${esc(s.opening.replace(/\{\{\s*(\w+)\s*\}\}/g, "⟨$1⟩"))}</div>
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
  const cont = hasNextAfter(pract.node);
  setTimeout(() => closeModal(cont), 600);
});

/** Two-step destructive reset of the ACTIVE profile only: arm, then confirm within 5s. */
async function resetProgress(btn) {
  if (!btn.classList.contains("armed")) {
    const who = profileName(profiles.find((p) => p.id === profile) ?? { id: profile });
    btn.classList.add("armed");
    btn.textContent = t("reset_confirm", who);
    setTimeout(() => {
      if (btn.isConnected && btn.classList.contains("armed")) {
        btn.classList.remove("armed");
        btn.textContent = t("btn_reset");
      }
    }, 5000);
    return;
  }
  btn.disabled = true;
  await fetch(api("/api/reset"), { method: "POST" });
  loadJourney();
}

/* ── PDF export: the active profile's journey, print-ready ── */

const fmtDate = (d) =>
  new Date(d).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", { year: "numeric", month: "long", day: "numeric" });

async function exportPdf() {
  const settled = journey.nodes.filter((n) => isSettled(n.status));
  if (!settled.length) return;
  const arts = await Promise.all(settled.map(async (n) => ({
    n,
    art: await (await fetch(api(`/api/artifact/${n.id}`))).json(),
  })));
  const who = profileName(profiles.find((p) => p.id === profile) ?? { id: profile });

  const parts = [`
    <div class="pd-head">
      <h1>${esc(t("journey_title"))}</h1>
      <div class="pd-meta">${esc(who)} · ${esc(fmtDate(Date.now()))} · ${t("authorized_of", journey.authorized, journey.total)}</div>
    </div>`];
  for (const sector of journey.sectors) {
    const inPhase = arts.filter(({ n }) => n.sector === sector.n);
    if (!inPhase.length) continue;
    parts.push(`<div class="pd-phase">${esc(phaseLabel(sector))}</div>`);
    for (const { n, art } of inPhase) {
      parts.push(`
        <section class="pd-node">
          <h2>${esc(nodeTitle(n))}</h2>
          <div class="pd-date">${esc(t("pdf_authorized", fmtDate(art.authorized_at)))}</div>
          ${renderFields(art.content, [])}
        </section>`);
    }
  }
  $("printDoc").innerHTML = parts.join("");

  // The print dialog's suggested file name comes from the page title.
  const prev = document.title;
  document.title = `Career Counseling — ${who} — ${new Date().toISOString().slice(0, 10)}`;
  window.print();
  document.title = prev;
}

/* ── voice dictation (OpenAI live transcription) ─────── */

let voice = null; // { ws, ctx, node, stream, target, base, turn, itemId, ready }
let micTarget = null;

const MIC_ICONS = {
  mic: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="11" height="11"><rect x="4" y="4" width="16" height="16" rx="4" fill="currentColor"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
};

const micBtn = document.createElement("button");
micBtn.id = "micBtn";
micBtn.type = "button";
micBtn.hidden = true;
document.body.appendChild(micBtn);

/** idle → mic outline · connecting → pulsing mic · rec → stop square · error → warning */
function setMic(state) {
  micBtn.innerHTML = state === "rec" ? MIC_ICONS.stop : state === "error" ? MIC_ICONS.warn : MIC_ICONS.mic;
  micBtn.classList.toggle("rec", state === "connecting" || state === "rec");
  micBtn.classList.toggle("err", state === "error");
  // Surfaces with their own mic (the braid) mirror this state.
  document.dispatchEvent(new CustomEvent("cc-voice-state", { detail: state }));
}
setMic("idle");

/** Fields that render their own mic (the braid composer) opt out of the
 * floating one via data-own-mic; dictation itself still works for them. */
const voiceEligible = (el) =>
  journey?.voice === true && el && !el.disabled && !el.readOnly && !el.dataset?.ownMic &&
  (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el.type === "text"));

function placeMic(el) {
  const r = el.getBoundingClientRect();
  // Single-line inputs get a vertically centered mic; textareas anchor it
  // in the top-right corner so it doesn't drift away while they grow.
  const single = el.tagName === "INPUT" || r.height <= 48;
  const top = single ? r.top + (r.height - 28) / 2 : r.top + 5;
  micBtn.style.top = `${Math.max(4, top)}px`;
  micBtn.style.left = `${r.right - 36}px`;
  if (!voice) micBtn.title = t("voice_dictate");
  micBtn.hidden = false;
}

document.addEventListener("focusin", (e) => {
  if (voice) return; // recording: the mic stays with its target
  if (voiceEligible(e.target)) {
    micTarget = e.target;
    placeMic(e.target);
  }
});

document.addEventListener("focusout", () => {
  if (voice) return;
  setTimeout(() => {
    if (!voice && (!document.activeElement || !voiceEligible(document.activeElement))) {
      micBtn.hidden = true;
      micTarget = null;
    }
  }, 120);
});

function repositionMic() {
  const el = voice?.target ?? micTarget;
  if (!el || micBtn.hidden) return;
  if (!document.contains(el)) {
    micBtn.hidden = true;
    stopVoice(true);
    return;
  }
  placeMic(el);
}
document.addEventListener("scroll", repositionMic, true);
window.addEventListener("resize", repositionMic);

micBtn.addEventListener("mousedown", (e) => e.preventDefault()); // keep field focus
micBtn.addEventListener("click", () => (voice ? stopVoice() : startVoice(micTarget)));

async function startVoice(target) {
  if (!target) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    return voiceError(t("voice_mic_denied"));
  }
  const sock = new WebSocket(`ws://${location.host}/ws/voice?lang=${lang}`);
  const ctx = new AudioContext({ sampleRate: 24000 });
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(2048, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  voice = {
    ws: sock, ctx, node, stream, target,
    base: "", turn: "", itemId: null, ready: false, finishing: false, finishTimer: null,
  };

  node.onaudioprocess = (ev) => {
    if (!voice || voice.finishing || voice.ws.readyState !== WebSocket.OPEN || !voice.ready) return;
    const f32 = ev.inputBuffer.getChannelData(0);
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 0x7fff;
    voice.ws.send(i16.buffer);
  };
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination); // silent sink — ScriptProcessor needs one to run

  setMic("connecting");
  micBtn.title = "";

  sock.onmessage = (ev) => {
    if (!voice) return;
    const msg = JSON.parse(ev.data);
    if (msg.type === "ready") {
      voice.ready = true;
      if (!voice.finishing) setMic("rec");
    } else if (msg.type === "delta") insertVoice(msg.item, msg.text, false);
    else if (msg.type === "final") {
      insertVoice(msg.item, msg.text, true);
      if (voice?.finishing) stopVoice(true);
    } else if (msg.type === "error") voiceError(msg.text);
  };
  sock.onclose = () => stopVoice(true);
}

/** Deltas stream in live; the final transcript replaces the whole turn. */
function insertVoice(item, text, isFinal) {
  const el = voice.target;
  if (voice.itemId !== item) {
    voice.itemId = item;
    voice.turn = "";
    voice.base = el.value && !/\s$/.test(el.value) ? `${el.value} ` : el.value;
  }
  voice.turn = isFinal ? text : voice.turn + text;
  el.value = voice.base + voice.turn;
  if (isFinal) voice.itemId = null;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.scrollTop = el.scrollHeight;
}

function stopVoice(force = false) {
  if (!voice) return;
  const v = voice;
  try {
    v.node.disconnect();
    v.ctx.close();
    v.stream.getTracks().forEach((tr) => tr.stop());
  } catch { /* already torn down */ }
  // Graceful stop: our "stop" triggers the buffer commit that yields the
  // final transcript — keep the socket open until it lands (max 4s).
  if (!force && !v.finishing && v.ready && v.ws.readyState === WebSocket.OPEN) {
    v.finishing = true;
    v.ws.send(JSON.stringify({ type: "stop" }));
    setMic("connecting");
    v.finishTimer = setTimeout(() => stopVoice(true), 4000);
    return;
  }
  clearTimeout(v.finishTimer);
  voice = null;
  if (v.ws.readyState === WebSocket.OPEN || v.ws.readyState === WebSocket.CONNECTING) {
    v.ws.onclose = null;
    v.ws.close();
  }
  setMic("idle");
  micBtn.title = t("voice_dictate");
}

function voiceError(text) {
  console.error("voice:", text);
  stopVoice();
  setMic("error");
  micBtn.title = text ?? "";
  setTimeout(() => {
    if (!voice) {
      setMic("idle");
      micBtn.title = t("voice_dictate");
    }
  }, 2500);
}

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
