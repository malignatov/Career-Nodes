const $ = (id) => document.getElementById(id);
const journeyEl = $("journey");

let journey = null;
let ws = null;
let modal = null; // { node, view, feedbackMode, review: {payload, currentText, edited} }

/* ── journey home ────────────────────────────────────── */

async function loadJourney() {
  journey = await (await fetch("/api/journey")).json();
  renderJourney();
}

function chipHtml(status) {
  const label = status === "authorized" ? "AUTHORIZED ✓" : status.replace("_", " ").toUpperCase();
  return `<span class="chip ${status}">${label}</span>`;
}

function depHint(n) {
  if (n.hint) return n.hint;
  const parts = [];
  if (n.kind === "conversation" && n.feeds.length) parts.push(`↳ feeds ${n.feeds.join(", ")}`);
  if (n.kind === "derived" && n.uses.length) parts.push(`· uses ${n.uses.join(", ")}`);
  if (n.skippable) parts.push("· fallback: Role models");
  return parts.join(" ");
}

function actionLabel(n) {
  if (n.status === "authorized") return "Redo";
  if (n.status === "in_progress") return "Resume";
  return n.kind === "conversation" ? "Start" : "Draft";
}

function summaryLine(n) {
  if (n.status === "authorized" && n.distilled) return `<div class="summary distilled">${esc(n.distilled)}</div>`;
  if (n.status === "in_progress") return `<div class="summary">Conversation in progress — your words are saved after every turn.</div>`;
  return `<div class="summary">${esc(n.desc)}</div>`;
}

function renderJourney() {
  const pct = Math.round((journey.authorized / journey.total) * 100);
  const parts = [];
  parts.push(`
    <div class="j-header">
      <div>
        <div class="j-title">Your journey</div>
        <div class="j-sub">You author every step — nothing moves forward without your approval.</div>
      </div>
      <div class="j-progress">
        <div class="j-count">${journey.authorized} of ${journey.total} authorized</div>
        <div class="j-bar"><div class="j-fill" style="width:${pct}%"></div></div>
      </div>
    </div>`);

  for (const sector of journey.sectors) {
    const nodes = journey.nodes.filter((n) => n.sector === sector.n);
    parts.push(`<div class="phase-label">${esc(sector.label)}</div>`);

    for (const n of nodes.filter((x) => x.status !== "planned")) {
      const btnClass = n.status === "authorized" ? "btn-outline" : "btn-fill";
      const chips = (n.skippable && n.status !== "authorized" ? `<span class="chip skippable">SKIPPABLE</span>` : "") + chipHtml(n.status);
      parts.push(`
        <div class="node-card">
          <div class="row1"><div class="title">${esc(n.title)}</div><div class="chips">${chips}</div></div>
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
        const chips = (n.skippable ? `<span class="chip skippable">SKIPPABLE</span>` : "") + chipHtml("planned");
        parts.push(`
          <div class="node-row">
            <div class="title">${esc(n.title)} <span class="dep">${esc(depHint(n))}</span></div>
            <div class="chips">${chips}</div>
          </div>`);
      }
    } else if (planned.length) {
      parts.push(`<div class="cond-grid">${planned
        .map((n) => `<div class="cond-cell">${esc(n.title)} <span class="dep">${esc(depHint(n))}</span></div>`)
        .join("")}</div>`);
    }
  }

  journeyEl.innerHTML = parts.join("");
  for (const btn of journeyEl.querySelectorAll("[data-open]")) {
    btn.addEventListener("click", () => openModal(btn.dataset.open));
  }
}

/* ── modal shell ─────────────────────────────────────── */

function setChip(status) {
  const chip = $("modalChip");
  chip.className = `chip ${status}`;
  chip.textContent = status === "authorized" ? "AUTHORIZED ✓" : status.replace("_", " ").toUpperCase();
}

function setView(view) {
  modal.view = view;
  $("chatView").hidden = view !== "chat";
  $("reviewView").hidden = view !== "review";
  $("exitHint").textContent = view === "review" ? "· draft kept until you decide" : "· saved automatically";
  setChip(view === "review" ? "drafted" : "in_progress");
}

async function openModal(id) {
  const node = journey.nodes.find((n) => n.id === id);
  modal = { node, view: "chat", feedbackMode: false, review: null };

  $("modalTitle").textContent = node.title;
  $("modalPhase").textContent = journey.sectors.find((s) => s.n === node.sector)?.label ?? "";
  $("messages").innerHTML = "";
  $("tPanel").hidden = true;
  $("tArrow").textContent = "▸";
  $("scrim").hidden = false;
  setView("chat");

  const pb = await (await fetch(`/api/playbook/${id}`)).json();
  $("tWhat").textContent = pb.purpose;
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
    parts.push(`<h5>Interviewer — topic “${esc(stage.id)}”</h5>${esc(stage.system)}`);
    parts.push(`<h5>Completion checklist (separate checker call)</h5>${esc(stage.done_when.map((d) => `- ${d}`).join("\n"))}`);
  }
  if (compiled.checker) parts.push(`<h5>Checker — system prompt</h5>${esc(compiled.checker)}`);
  for (const step of compiled.induce) {
    parts.push(`<h5>Drafting step “${esc(step.id)}” (${esc(step.model_tier)} model)</h5>${esc(step.system)}`);
    parts.push(`<h5>Required output shape</h5>${esc(JSON.stringify(step.output_schema, null, 2))}`);
  }
  parts.push(`<h5>Added at runtime</h5>Your conversation, short bracketed stage directions, and your authorized upstream artifacts. Nothing else.`);
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

function enableComposer(placeholder) {
  $("composer").classList.remove("disabled");
  $("input").disabled = false;
  // The engine's per-turn ask label ("you") is a CLI-ism — keep the design placeholder.
  $("input").placeholder = placeholder && placeholder !== "you" ? placeholder : "Write in your own words…";
  $("input").focus();
}

function disableComposer() {
  $("composer").classList.add("disabled");
  $("input").disabled = true;
}

function connect(id) {
  ws = new WebSocket(`ws://${location.host}/ws?playbook=${id}`);

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "say") addMsg("say", msg.text);
    else if (msg.type === "note") addMsg("note", msg.text);
    else if (msg.type === "error") addMsg("error", msg.text);
    else if (msg.type === "ask") enableComposer(msg.text);
    else if (msg.type === "review") showReview(msg.payload);
    else if (msg.type === "done") {
      if (msg.text === "authorized") {
        setChip("authorized");
        setTimeout(closeModal, 600);
      } else {
        addMsg("note", `Session ended (${msg.text}) — your progress is saved.`);
      }
    }
  };

  ws.onclose = () => {
    ws = null;
    disableComposer();
    if (modal) addMsg("note", "Connection closed — reopen this step to continue; everything is saved.");
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
  const map = { counseling_goal: "goal", motto: "motto", identity_statement: "statement", life_portrait: "portrait" };
  return map[node.id] ?? "draft";
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
        `<div class="alt-label">Alternative phrasings — click to swap</div>` +
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
    verify.innerHTML = `<span>✓</span> Edited by you — your own words, verbatim by definition`;
  } else {
    const n = payload.mode === "candidates"
      ? quotesIn(currentText, payload.verified_quotes)
      : payload.verified_quotes.length;
    verify.innerHTML = n > 0
      ? `<span>✓</span> ${n} verbatim quote${n === 1 ? "" : "s"} verified against your transcript`
      : "";
  }
}

function showReview(payload) {
  modal.review = { payload, currentText: payload.candidates[0] ?? "", edited: false };
  setView("review");

  const name = shortName(modal.node);
  $("reviewExplainer").textContent =
    `Your ${name}, distilled from the conversation. Highlighted phrases are your exact words — nothing was paraphrased.`;
  $("draftKicker").textContent = `Draft · your ${name}`;
  $("authorizeBtn").textContent = `Authorize this ${name}`;
  $("reviewFoot").textContent = payload.authorize_language;
  $("editBtn").hidden = payload.mode !== "candidates";
  $("editArea").hidden = true;
  $("draftBody").hidden = false;
  renderDraftBody();
}

$("editBtn").addEventListener("click", () => {
  const editing = $("editArea").hidden;
  $("editArea").hidden = !editing;
  $("draftBody").hidden = editing;
  if (editing) $("draftTextarea").value = modal.review.currentText;
  $("editBtn").textContent = editing ? "Cancel edit" : "Edit wording";
});

$("saveEdit").addEventListener("click", () => {
  const text = $("draftTextarea").value.trim();
  if (text) {
    modal.review.currentText = text;
    modal.review.edited = true;
  }
  $("editArea").hidden = true;
  $("draftBody").hidden = false;
  $("editBtn").textContent = "Edit wording";
  renderDraftBody();
});

$("changesBtn").addEventListener("click", () => {
  setView("chat");
  modal.feedbackMode = true;
  addMsg("say", "What should change in this draft? Tell me in a sentence or two, and I'll redraft it from your words.");
  enableComposer("Describe what to change…");
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
