const els = {
  body: document.body,
  crumb: document.getElementById("crumb"),
  mapToggle: document.getElementById("mapToggle"),
  mapHome: document.getElementById("mapHome"),
  focus: document.getElementById("focus"),
  focusTitle: document.getElementById("focusTitle"),
  focusStatus: document.getElementById("focusStatus"),
  briefing: document.getElementById("briefing"),
  purpose: document.getElementById("purpose"),
  artifactCard: document.getElementById("artifactCard"),
  artifactPre: document.getElementById("artifactPre"),
  actions: document.getElementById("actions"),
  chat: document.getElementById("chat"),
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  input: document.getElementById("input"),
  drawer: document.getElementById("drawer"),
  drawerMap: document.getElementById("drawerMap"),
};

const NODE_W = 158;
const NODE_H = 44;
let mapData = null;
let currentId = null;
let ws = null;

/* ── map rendering ───────────────────────────────────── */

function nodeById(id) {
  return mapData.nodes.find((n) => n.id === id);
}

function mapSvg() {
  const s = [`<svg viewBox="0 0 680 1010" xmlns="http://www.w3.org/2000/svg">`];
  for (const sec of mapData.sectors) {
    s.push(`<rect class="sector-band" x="28" y="${sec.y0}" width="624" height="${sec.y1 - sec.y0}" rx="8"/>`);
    s.push(`<text class="sector-label" x="40" y="${sec.y0 + 17}">${esc(sec.label)}</text>`);
  }
  for (const [from, to] of mapData.edges) {
    const a = nodeById(from);
    const b = nodeById(to);
    if (!a || !b) continue;
    s.push(`<line class="edge" x1="${a.x}" y1="${a.y + NODE_H / 2}" x2="${b.x}" y2="${b.y - NODE_H / 2}"/>`);
  }
  for (const n of mapData.nodes) {
    s.push(`<g class="node ${n.kind} ${n.status}" data-id="${n.id}">`);
    s.push(`<rect x="${n.x - NODE_W / 2}" y="${n.y - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}" rx="7"/>`);
    s.push(`<text x="${n.x}" y="${n.y + 4.5}">${esc(n.title)}</text>`);
    s.push(`</g>`);
  }
  s.push(`</svg>`);
  return s.join("");
}

function renderMaps() {
  const html = mapSvg();
  els.mapHome.innerHTML = html;
  els.drawerMap.innerHTML = html;
  for (const container of [els.mapHome, els.drawerMap]) {
    for (const g of container.querySelectorAll(".node")) {
      g.addEventListener("click", () => {
        if (ws) return; // conversation running — stay put
        closeDrawer();
        openFocus(g.dataset.id);
      });
    }
  }
}

async function loadMap() {
  mapData = await (await fetch("/api/map")).json();
  renderMaps();
}

/* ── views ───────────────────────────────────────────── */

function showMapView() {
  currentId = null;
  els.body.classList.remove("view-focus");
  els.body.classList.add("view-map");
  els.focus.hidden = true;
  els.crumb.textContent = "Career construction";
}

async function openFocus(id) {
  currentId = id;
  const node = nodeById(id);
  els.body.classList.remove("view-map");
  els.body.classList.add("view-focus");
  els.focus.hidden = false;
  els.crumb.textContent = `${mapData.sectors.find((s) => s.n === node.sector)?.label ?? ""} — ${node.title}`;
  els.focusTitle.textContent = node.title;
  els.focusStatus.textContent = `${node.kind} · ${node.status.replace("_", " ")}`;
  els.chat.hidden = true;
  els.messages.innerHTML = "";

  const pbRes = await fetch(`/api/playbook/${id}`);
  const pb = pbRes.ok ? await pbRes.json() : null;
  const artRes = await fetch(`/api/artifact/${id}`);
  const artifact = artRes.ok ? await artRes.json() : null;

  if (!pb) {
    els.briefing.hidden = true;
    els.artifactCard.hidden = true;
    els.actions.innerHTML = `<p class="hint">This checkpoint is planned — its playbook hasn't been written yet.</p>`;
    return;
  }

  els.briefing.hidden = false;
  els.briefing.open = true;
  els.purpose.textContent = pb.purpose;

  if (artifact) {
    els.artifactCard.hidden = false;
    els.artifactPre.textContent = JSON.stringify(artifact.content, null, 2);
  } else {
    els.artifactCard.hidden = true;
  }

  const label =
    node.status === "in_progress" ? "Resume conversation"
    : node.status === "authorized" ? "Redo this step"
    : pb.stages.length > 0 ? "Start conversation" : "Draft from my artifacts";
  els.actions.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "primary";
  btn.textContent = label;
  btn.addEventListener("click", () => startSession(id));
  els.actions.appendChild(btn);
}

/* ── conversation ────────────────────────────────────── */

function startSession(id) {
  els.actions.innerHTML = "";
  els.artifactCard.hidden = true;
  els.briefing.open = false;
  els.chat.hidden = false;
  els.messages.innerHTML = "";
  els.mapToggle.disabled = true;
  els.mapToggle.title = "The map waits until this conversation ends";

  const add = (cls, text) => {
    const div = document.createElement("div");
    div.className = `msg ${cls}`;
    div.textContent = text;
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
  };

  ws = new WebSocket(`ws://${location.host}/ws?playbook=${id}`);

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "say") add("say", msg.text);
    else if (msg.type === "note") add("note", msg.text);
    else if (msg.type === "error") add("error", msg.text);
    else if (msg.type === "ask") {
      els.composer.classList.remove("disabled");
      els.input.disabled = false;
      els.input.placeholder = msg.text;
      els.input.focus();
    } else if (msg.type === "done") {
      add("note", msg.text === "authorized" ? "Artifact authorized ✓" : `Session ended (${msg.text})`);
    }
  });

  ws.addEventListener("close", async () => {
    ws = null;
    els.composer.classList.add("disabled");
    els.input.disabled = true;
    els.mapToggle.disabled = false;
    els.mapToggle.title = "Map (Esc)";
    await loadMap();
    const backBtn = document.createElement("button");
    backBtn.className = "ghost";
    backBtn.textContent = "Back to this step's overview";
    backBtn.addEventListener("click", () => openFocus(currentId));
    const mapBtn = document.createElement("button");
    mapBtn.className = "primary";
    mapBtn.textContent = "Back to the map";
    mapBtn.addEventListener("click", showMapView);
    els.actions.innerHTML = "";
    els.actions.append(mapBtn, backBtn);
  });

  els.composer.onsubmit = (e) => {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text || !ws) return;
    add("user", text);
    ws.send(JSON.stringify({ type: "answer", text }));
    els.input.value = "";
    els.input.disabled = true;
    els.composer.classList.add("disabled");
  };

  els.input.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.composer.requestSubmit();
    }
  };
}

/* ── drawer & keys ───────────────────────────────────── */

function openDrawer() {
  els.drawer.hidden = false;
}
function closeDrawer() {
  els.drawer.hidden = true;
}

els.mapToggle.addEventListener("click", () => {
  if (ws) return;
  els.drawer.hidden ? openDrawer() : closeDrawer();
});

els.drawer.addEventListener("click", (e) => {
  if (e.target === els.drawer) closeDrawer();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!els.drawer.hidden) return closeDrawer();
  if (els.body.classList.contains("view-focus") && !ws) showMapView();
});

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

loadMap();
