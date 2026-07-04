import { STR, PHASES, NODES } from "/i18n.js";

const $ = (id) => document.getElementById(id);
const journeyEl = $("journey");

let lang = localStorage.getItem("lang") ?? "en";
let theme = localStorage.getItem("theme") ?? "light";
let journey = null;
let ws = null;
let modal = null; // { node, view, feedbackMode, review: {payload, currentText, edited} }

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
  journey = await (await fetch("/api/journey")).json();
  renderJourney();
}

function chipHtml(status) {
  return `<span class="chip ${status}">${t(`chip_${status}`)}</span>`;
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
  if (n.status === "authorized") return t("btn_redo");
  if (n.status === "in_progress") return t("btn_resume");
  return n.kind === "conversation" ? t("btn_start") : t("btn_draft");
}

function summaryLine(n) {
  if (n.status === "authorized" && n.distilled) return `<div class="summary distilled">${esc(n.distilled)}</div>`;
  if (n.status === "in_progress") return `<div class="summary">${t("in_progress_summary")}</div>`;
  return `<div class="summary">${esc(nodeDesc(n))}</div>`;
}

function renderJourney() {
  const pct = Math.round((journey.authorized / journey.total) * 100);
  const parts = [];
  parts.push(`
    <div class="j-header">
      <div>
        <div class="j-title">${t("journey_title")}</div>
        <div class="j-sub">${t("journey_sub")}</div>
      </div>
      <div class="j-progress">
        <div class="j-tools">
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
      const chips = (n.skippable && n.status !== "authorized" ? `<span class="chip skippable">${t("chip_skippable")}</span>` : "") + chipHtml(n.status);
      parts.push(`
        <div class="node-card">
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
}

/* ── modal shell ─────────────────────────────────────── */

function setChip(status) {
  const chip = $("modalChip");
  chip.className = `chip ${status}`;
  chip.textContent = t(`chip_${status}`);
}

function setView(view) {
  modal.view = view;
  $("chatView").hidden = view !== "chat";
  $("reviewView").hidden = view !== "review";
  $("exitHint").textContent = view === "review" ? t("exit_draft") : t("exit_saved");
  setChip(view === "review" ? "drafted" : "in_progress");
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
}

async function openModal(id) {
  const node = byId(id);
  modal = { node, view: "chat", feedbackMode: false, review: null };

  applyModalStrings();
  $("modalTitle").textContent = nodeTitle(node);
  $("modalPhase").textContent = phaseLabel(journey.sectors.find((s) => s.n === node.sector));
  $("messages").innerHTML = "";
  $("tPanel").hidden = true;
  $("tArrow").textContent = "▸";
  $("scrim").hidden = false;
  setView("chat");

  const pb = await (await fetch(`/api/playbook/${id}?lang=${lang}`)).json();
  $("tWhat").textContent = (lang !== "en" ? `${t("playbook_lang_note")}\n\n` : "") + pb.purpose;
  $("tCompiled").innerHTML = compiledHtml(pb.compiled);

  connect(id);
}

function closeModal() {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
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

function connect(id) {
  const langParam = lang === "en" ? "" : `&lang=${lang}`;
  ws = new WebSocket(`ws://${location.host}/ws?playbook=${id}${langParam}`);

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "say") addMsg("say", msg.text);
    else if (msg.type === "note") addMsg("note", localizeNote(msg.text));
    else if (msg.type === "error") addMsg("error", msg.text);
    else if (msg.type === "ask") enableComposer(msg.text);
    else if (msg.type === "review") showReview(msg.payload);
    else if (msg.type === "done") {
      if (msg.text === "authorized") {
        setChip("authorized");
        setTimeout(closeModal, 600);
      } else {
        addMsg("note", t("session_saved", msg.text));
      }
    }
  };

  ws.onclose = () => {
    ws = null;
    disableComposer();
    if (modal) addMsg("note", t("conn_closed"));
  };
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("input").value.trim();
  if (!text || !ws) return;
  addMsg("user", text);
  if (modal.feedbackMode) {
    modal.feedbackMode = false;
    ws.send(JSON.stringify({ type: "review_action", action: "feedback", text }));
  } else {
    ws.send(JSON.stringify({ type: "answer", text }));
  }
  $("input").value = "";
  disableComposer();
});

/* ── review & authorize ──────────────────────────────── */

function shortName(node) {
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
    const parts = [];
    for (const [key, value] of Object.entries(payload.draft)) {
      if (key === "_verbatim_warnings" || key === "candidates") continue;
      parts.push(`<div class="field-label">${esc(key.replaceAll("_", " "))}</div>`);
      if (typeof value === "string") {
        parts.push(`<div class="field-value">${markVerbatim(value, payload.verified_quotes)}</div>`);
      } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        parts.push(`<ul>${value.map((v) => `<li>${markVerbatim(v, payload.verified_quotes)}</li>`).join("")}</ul>`);
      } else if (value !== null) {
        parts.push(`<pre>${markVerbatim(JSON.stringify(value, null, 2), payload.verified_quotes)}</pre>`);
      }
    }
    body.innerHTML = parts.join("");
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

  const name = shortName(modal.node);
  $("reviewExplainer").textContent = t("review_explainer", name);
  $("draftKicker").textContent = t("kicker", name);
  $("authorizeBtn").textContent = t("authorize", name);
  $("reviewFoot").textContent = payload.authorize_language;
  $("editBtn").hidden = payload.mode !== "candidates";
  $("editBtn").textContent = t("edit_wording");
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
  setView("chat");
  modal.feedbackMode = true;
  addMsg("say", t("changes_prompt"));
  enableComposer(t("placeholder_changes"));
});

$("authorizeBtn").addEventListener("click", () => {
  if (!ws || !modal.review) return;
  const { payload, currentText } = modal.review;
  const msg = { type: "review_action", action: "authorize" };
  if (payload.mode === "candidates") msg.value = currentText;
  ws.send(JSON.stringify(msg));
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

loadJourney();
