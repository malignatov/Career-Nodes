const mapEl = document.getElementById("map");
const panel = document.getElementById("panel");

const NODE_W = 158;
const NODE_H = 44;
let mapData = null;
let selectedId = null;
let ws = null;

async function loadMap() {
  mapData = await (await fetch("/api/map")).json();
  renderMap();
}

function nodeById(id) {
  return mapData.nodes.find((n) => n.id === id);
}

function renderMap() {
  const s = [];
  s.push(`<svg viewBox="0 0 680 1010" xmlns="http://www.w3.org/2000/svg">`);

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
    const cls = `node ${n.kind} ${n.status}${n.id === selectedId ? " selected" : ""}`;
    s.push(`<g class="${cls}" data-id="${n.id}">`);
    s.push(`<rect x="${n.x - NODE_W / 2}" y="${n.y - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}" rx="7"/>`);
    s.push(`<text x="${n.x}" y="${n.y + 4.5}">${esc(n.title)}</text>`);
    s.push(`</g>`);
  }

  s.push(`</svg>`);
  mapEl.innerHTML = s.join("");

  for (const g of mapEl.querySelectorAll(".node")) {
    g.addEventListener("click", () => selectNode(g.dataset.id));
  }
}

async function selectNode(id) {
  if (ws) return; // don't navigate away mid-conversation
  selectedId = id;
  renderMap();
  const node = nodeById(id);
  panel.classList.remove("empty");

  const pbRes = await fetch(`/api/playbook/${id}`);
  const pb = pbRes.ok ? await pbRes.json() : null;
  const artRes = await fetch(`/api/artifact/${id}`);
  const artifact = artRes.ok ? await artRes.json() : null;

  const parts = [];
  parts.push(`<h2>${esc(node.title)}</h2>`);
  parts.push(`<div class="status-line">${esc(node.kind)} · ${esc(node.status.replace("_", " "))}</div>`);

  if (!pb) {
    parts.push(`<p class="hint" style="text-align:left">This checkpoint is planned — its playbook hasn't been written yet.</p>`);
    panel.innerHTML = parts.join("");
    return;
  }

  parts.push(`<div class="purpose-label">What the model is instructed to do here — always visible</div>`);
  parts.push(`<div class="purpose">${esc(pb.purpose)}</div>`);

  if (artifact) {
    parts.push(`<div class="purpose-label">Your authorized artifact (${esc(artifact.authorized_at ?? "")})</div>`);
    parts.push(`<pre class="artifact">${esc(JSON.stringify(artifact.content, null, 2))}</pre>`);
  }

  const label =
    node.status === "in_progress" ? "Resume conversation"
    : node.status === "authorized" ? "Redo this step"
    : pb.stages.length > 0 ? "Start conversation" : "Draft from my artifacts";
  parts.push(`<button class="primary" id="start">${esc(label)}</button>`);

  panel.innerHTML = parts.join("");
  document.getElementById("start").addEventListener("click", () => startSession(id, node.title));
}

function startSession(id, title) {
  panel.innerHTML = `
    <h2>${esc(title)}</h2>
    <div id="chat">
      <div id="messages"></div>
      <form id="composer" class="disabled">
        <textarea id="input" rows="2" placeholder="…" disabled></textarea>
        <button type="submit">Send</button>
      </form>
    </div>`;

  const messages = document.getElementById("messages");
  const composer = document.getElementById("composer");
  const input = document.getElementById("input");

  const add = (cls, text) => {
    const div = document.createElement("div");
    div.className = `msg ${cls}`;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  };

  ws = new WebSocket(`ws://${location.host}/ws?playbook=${id}`);

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "say") add("say", msg.text);
    else if (msg.type === "note") add("note", msg.text);
    else if (msg.type === "error") add("error", msg.text);
    else if (msg.type === "ask") {
      composer.classList.remove("disabled");
      input.disabled = false;
      input.placeholder = msg.text;
      input.focus();
    } else if (msg.type === "done") {
      add("note", msg.text === "authorized" ? "Artifact authorized ✓" : `Session ended (${msg.text})`);
    }
  });

  ws.addEventListener("close", () => {
    ws = null;
    composer.classList.add("disabled");
    input.disabled = true;
    loadMap();
    add("note", "— conversation closed — select the checkpoint again to review or continue —");
  });

  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !ws) return;
    add("user", text);
    ws.send(JSON.stringify({ type: "answer", text }));
    input.value = "";
    input.disabled = true;
    composer.classList.add("disabled");
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

loadMap();
