/**
 * Braid UI scenarios, run inside the real renderer (Electron/Chromium).
 * No network, no model: a fabricated journey enters through the ctx seam and
 * the test plays the counselor through the captured session surface.
 * Results land on window.__uiResults for the runner to collect.
 */
import { STR, prose } from "../../public/i18n.js";
import { makeRenderer } from "../../public/draft-view.js";

const t = (key, ...args) => {
  const v = STR.en[key];
  return typeof v === "function" ? v(...args) : v;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (sel) => document.querySelector(sel);
const root = document.getElementById("journey");

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

/* ── the fabricated map (mirrors src/map.ts shape) ────────── */

const SECTORS = [
  { n: 1, label: "1 · Why you're here" },
  { n: 2, label: "2 · Your stories" },
  { n: 3, label: "3 · What they mean" },
  { n: 4, label: "4 · The whole picture" },
  { n: 5, label: "5 · What you do next" },
];
const DEFS = [
  ["counseling_goal", "What you're here for", 1, "conversation", 5],
  ["role_models", "Who you looked up to", 2, "conversation", 10],
  ["favorite_media", "What you're into", 2, "conversation", 5],
  ["favorite_story", "Your favorite story", 2, "conversation", 5],
  ["motto", "Your motto", 2, "conversation", 2],
  ["early_recollections", "Earliest memories", 2, "conversation", 10],
  ["perspective", "How you see it", 3, "derived", 2],
  ["character_sketch", "Who you are", 3, "derived", 2],
  ["preferred_settings", "Your kind of place", 3, "derived", 2],
  ["script", "The story you're in", 3, "derived", 2],
  ["advice_to_self", "Your own advice", 3, "derived", 2],
  ["life_portrait", "Your portrait", 4, "derived", 3],
  ["identity_statement", "Your success formula", 4, "derived", 2],
  ["action_recipe", "Your first moves", 5, "derived", 3],
  ["closing_check", "Did we get there?", 5, "conversation", 5],
];

function makeJourney(statuses, flags = {}) {
  const nodes = DEFS.map(([id, title, sector, kind, minutes], i) => ({
    id, title, sector, kind, minutes,
    status: statuses[i],
    desc: `About ${title}.`,
    distilled: statuses[i] === "authorized" && id === "identity_statement"
      ? [{ label: null, text: "I will be happy and successful when the test passes." }]
      : [],
    feeds: [], uses: [],
  }));
  return {
    sectors: SECTORS, nodes,
    authorized: statuses.filter((s) => s === "authorized").length,
    total: DEFS.length, ai: true, voice: false, flags,
  };
}

function makeCtx(journey) {
  const spies = { reload: 0, flags: [], sent: [], exports: 0, resets: [] };
  const ctx = {
    journey, t, lang: "en", theme: "light", mode: "client",
    profile: "test", profiles: [], profileName: () => "Test",
    nodeTitle: (n) => n.title, nodeDesc: (n) => n.desc, phaseLabel: (s) => s.label,
    esc, api: (p) => p,
    connect: (id, opts) => { ctx._surface = opts.surface; },
    wsSend: (m) => { spies.sent.push(m); return true; },
    wsLive: () => true, closeWs: () => { ctx._surface = null; },
    currentNodeId: () => journey.nodes.find((n) => n.status === "available" || n.status === "in_progress")?.id ?? null,
    isSettled: (s) => s === "authorized" || s === "stale",
    markVerbatim: (x) => esc(x), localizeNote: (x) => x,
    prose: (x) => prose(x, esc),
    renderFields: makeRenderer({ esc, t, markVerbatim: (x) => esc(x) }), compiledHtml: (x) => esc(String(x)),
    exportPdf: async () => { spies.exports++; },
    setFlag: (name) => { spies.flags.push(name); journey.flags = { ...(journey.flags ?? {}), [name]: true }; },
    reload: () => { spies.reload++; },
    resetNode: (id) => { spies.resets.push(id); },
    stopDictation: () => {}, voice: { enabled: () => false },
    actions: [],
  };
  return { ctx, spies };
}

const render = (ctx) => {
  // app.js does this in the real client, and it matters: style.css lays the
  // journey out as a centred 900px card list until `braid-on` releases it.
  root.classList.add("braid-on");
  window.Braid.renderJourney(root, ctx);
};
const debug = () => window.Braid._debug();
const core = (i) => $(`.br-node[data-i="${i}"] [data-core]`);

async function settle() {
  // leave any session/ceremony before the next scenario
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  for (let i = 0; i < 40 && (debug().merge || debug().sess); i++) await sleep(250);
  await sleep(300);
}

async function openAndCapture(ctx, id) {
  window.Braid.openSession(id, ctx);
  for (let i = 0; i < 20 && !ctx._surface; i++) await sleep(100);
  expect(ctx._surface, "session surface never connected");
  return ctx._surface;
}

const REVIEW = {
  mode: "candidates", candidates: ["Draft wording"], choice_field: "statement",
  verified_quotes: [], warnings: [], existing: false, authorize_language: "Authorize?",
};

/* ── scenarios ────────────────────────────────────────────── */

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("node statuses paint their materials, phases recede, counter reads the stage", async () => {
  const statuses = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);
  expect(core(0).__c === "solid3", `woven core is ${core(0).__c}, want solid3`);
  expect(core(2).__c === "live", `up-next core is ${core(2).__c}, want live (canvas-drawn)`);
  expect(core(5).__c === "wlo", `planned core is ${core(5).__c}, want wlo`);
  expect($('.br-node[data-i="8"]').classList.contains("br-future"), "later-phase node lacks br-future");
  expect(!$('.br-node[data-i="4"]').classList.contains("br-future"), "current-phase node wrongly br-future");
  // Only derived steps explain their wait; an interview step never claims a
  // step above it, because it depends on the goal alone.
  const conv = $('.br-label[data-i="3"]');
  expect(!conv.querySelector(".br-label-sub"), `interview step must not carry a lock line: ${conv.textContent}`);
  expect(conv.textContent.trim() === "Your favorite story", `interview label should be the name alone: ${conv.textContent}`);
  const der = $('.br-label[data-i="6"]').textContent;
  expect(der.includes(t("derived_sub")), `derived sub wrong: ${der}`);
  expect($('.br-label[data-i="0"]').textContent.trim() === "What you're here for", "done label should be title only");
  // Guards the phase-label contract: braid.js shows the last "·" segment only.
  expect($(".br-count-phase").textContent === "Your stories · 1 of 5", `counter: ${$(".br-count-phase").textContent}`);
  expect($(".br-count-total").textContent === t("braid_woven_of", 2, 15), `total: ${$(".br-count-total").textContent}`);
  expect($(".br-plaque-time").textContent === t("braid_minutes", 5), `plaque time: ${$(".br-plaque-time").textContent}`);
  // The caption and the glow hang off the focused node ITSELF. Hanging them
  // on the raw pre-gravity anchor put them ~40px away, which is how far the
  // caption jumped when the canvas (which draws node-relative) handed it back.
  const xOf = (sel) => new DOMMatrixReadOnly(getComputedStyle($(sel)).transform).m41;
  const nodeX = xOf('.br-node[data-i="2"]');
  expect(Math.abs(xOf(".br-plaque") - nodeX) < 1, `the caption is ${(xOf(".br-plaque") - nodeX).toFixed(1)}px off its node`);
  expect(Math.abs(xOf(".br-nimbus") - nodeX) < 1, `the glow is ${(xOf(".br-nimbus") - nodeX).toFixed(1)}px off its node`);
});

test("hover accelerates and brightens the waking sphere", async () => {
  const statuses = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(300);
  const stage = $(".br-stage");
  const nd = $('.br-node[data-i="2"]');
  const core = nd.querySelector("[data-core]");
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(nd.style.transform);
  const sm = /,\s*([-\d.]+)px\)/.exec($(".br-strip").style.transform);
  const offX = (stage.clientWidth - 900) / 2;
  const x = offX + parseFloat(m[1]);
  const y = parseFloat(m[2]) + parseFloat(sm[1]);
  // Hover lives entirely in canvas state (growth eased via hovK, brightness
  // via ctx.filter) — the DOM must stay untouched (cursor-war rule).
  stage.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
  let ts = performance.now();
  for (let i = 0; i < 30; i++) { ts += 16; window.Braid._frame(ts); }
  expect(debug().hov === true, "proximity must set the hover state");
  expect(debug().hovK > 1.07, `hover growth should ease toward 1.09, at ${debug().hovK}`);
  expect(core.innerHTML === "", "waking core must carry no DOM material (canvas-drawn)");
  stage.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
  for (let i = 0; i < 40; i++) { ts += 16; window.Braid._frame(ts); }
  expect(debug().hov === false, "leave must clear the hover state");
  expect(debug().hovK < 1.02, `hover growth should decay, still ${debug().hovK}`);
});

test("the pointer field: sway never sheds the cursor, décor never owns a hit", async () => {
  const statuses = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(300);
  const stage = $(".br-stage");
  const nd = $('.br-node[data-i="2"]');
  const pad = nd.querySelector("[data-pad]");
  expect(pad && !pad.hidden, "static hit pad missing from waking node");
  // NOTHING may animate in the strip at idle — even compositor transform
  // animations near a parked cursor re-arm the macOS cursor race. All idle
  // motion must be canvas paint.
  const anims = document.getAnimations().filter((a) => {
    const el = a.effect && a.effect.target;
    return el && $(".br-strip").contains(el);
  });
  expect(anims.length === 0, `idle strip runs ${anims.length} CSS animation(s): ${anims.map((a) => a.animationName || a.constructor.name).join(", ")}`);
  window.Braid._frame(0); // amp = 0 — the sphere's rest position
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(nd.style.transform);
  const sm = /,\s*([-\d.]+)px\)/.exec($(".br-strip").style.transform);
  const offX = (stage.clientWidth - 900) / 2;
  const cx = offX + parseFloat(m[1]);
  const cy = parseFloat(m[2]) + parseFloat(sm[1]);
  // A cursor parked anywhere in the swing corridor stays a pointer through the
  // whole 6.5s sway cycle — the sphere must never slip out from under it.
  // The hit target must also be the SAME live node every frame: Chromium drops
  // a stationary cursor to the arrow when its hovered element is destroyed
  // (per-frame innerHTML), and only a real mouse move restores it.
  const anchors = {};
  for (let t = 0; t <= 6600; t += 220) {
    window.Braid._frame(t);
    for (const dx of [-34, 0, 34]) {
      const el = document.elementFromPoint(cx + dx, cy);
      expect(el && el.closest(".br-node"), `t=${t} dx=${dx}: corridor hit left the node (${el?.tagName})`);
      expect(getComputedStyle(el).cursor === "pointer", `t=${t} dx=${dx}: cursor ${getComputedStyle(el).cursor}, want pointer`);
      if (!(dx in anchors)) anchors[dx] = el;
      expect(anchors[dx] === el && el.isConnected, `t=${t} dx=${dx}: hit target was rebuilt under a parked cursor`);
    }
  }
  // The zero-write invariant: idle frames may only paint to canvases. Any
  // per-frame DOM/style write feeds the macOS cursor race that flips a
  // stationary pointer to the arrow (the sway/ping live in CSS keyframes).
  const mo = new MutationObserver(() => {});
  mo.observe($(".br-strip"), { attributes: true, childList: true, characterData: true, subtree: true });
  for (let t = 7000; t <= 8600; t += 40) window.Braid._frame(t);
  const writes = mo.takeRecords();
  mo.disconnect();
  expect(writes.length === 0,
    `idle frames wrote to the DOM ${writes.length}× (first: ${writes[0] && writes[0].type} on ${writes[0] && (writes[0].target.className || writes[0].target.nodeName)})`);
  // Threads and knots are décor: a probe across open braid must never land on
  // svg outside a node — pointer-opaque décor eats hovers and clicks.
  const decorHits = [];
  for (const y of [460, 520]) for (let x = offX + 100; x <= offX + 800; x += 50) {
    const el = document.elementFromPoint(x, y);
    if (el && el.closest("svg") && !el.closest(".br-node")) decorHits.push(`${el.tagName}@${Math.round(x)},${y}`);
  }
  expect(decorHits.length === 0, `décor svg owns hits: ${decorHits.join(" ")}`);
});

test("thinking dots, rotating phrase, and Saturn rings live through a wait", async () => {
  const statuses = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx, spies } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);
  const surface = await openAndCapture(ctx, "favorite_media");
  surface.ask("you");
  await sleep(100);
  const inp = $(".br7-input");
  expect(!inp.disabled, "composer should be enabled after ask");
  inp.value = "my answer";
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await sleep(150);
  expect(spies.sent.some((x) => x.type === "answer"), "answer never sent");
  // The wait ensemble is canvas state now (cursor-war rule): assert the
  // loader row + its inline canvas, and the rotation/ring clocks via debug.
  expect($("[data-think]"), "thinking row missing after send");
  expect($("[data-thinkcv]"), "loader canvas missing (dots+phrase are paint)");
  expect(debug().thinkIdx === 1, `phrase index starts at ${debug().thinkIdx}, want 1`);
  expect(debug().sat === "on", `Saturn rings should be on, state: ${debug().sat}`);
  await sleep(2200);
  expect(debug().thinkIdx === 2, `phrase should rotate to 2, at ${debug().thinkIdx}`);
  surface.note("(inducing: extract…)");
  await sleep(150);
  expect($("[data-think]") && debug().think && debug().sat === "on", "induction note must keep the loader");
  expect(debug().thinkIdx !== null, "note re-entry must not reset the rotation clock");
  surface.say("Here are the counselor's words.");
  await sleep(900);
  expect(!$("[data-think]"), "thinking row must clear when words arrive");
  expect(!debug().think, "think state must clear when words arrive");
  expect(debug().sat !== "on", `rings must fade when words arrive, state: ${debug().sat}`);
});

test("the rings belong to the conversation and never follow it out", async () => {
  const statuses = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);
  const surface = await openAndCapture(ctx, "favorite_media");
  surface.note("(inducing: extract…)");
  await sleep(150);
  expect(debug().sat === "on", `rings should be orbiting during the wait, state: ${debug().sat}`);

  // Leaving mid-wait. The .7s release used to keep painting after the session
  // was already closed, so the rings rode the camera back out and orbited a
  // bead on the open field.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await sleep(120);
  expect(!debug().sess, "the session should be closed");
  expect(debug().sat === null, `rings outlived the conversation: ${debug().sat}`);
  await sleep(500);
  expect(debug().sat === null, `rings came back on the field: ${debug().sat}`);
});

test("alternative wordings: selection replaces the original, survives the click, authorizes as chosen", async () => {
  const statuses = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx, spies } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);
  const surface = await openAndCapture(ctx, "favorite_media");
  surface.review({
    ...REVIEW,
    candidates: ["First wording", "Second wording", "Third wording"],
    verified_quotes: [],
  });
  await sleep(200);
  const body = () => $("[data-review] .br7-review-body").textContent;
  const alts = () => [...document.querySelectorAll("[data-review] .br7-alt")].map((b) => b.textContent);
  expect(body() === "First wording", `card should open on the first candidate, shows "${body()}"`);
  expect(alts().join("|") === "Second wording|Third wording", `alternates wrong: ${alts().join("|")}`);
  // Selecting an alternate re-renders the card — the click's target detaches
  // mid-bubble. The fixed bug: the stage click-out used to close the session.
  document.querySelectorAll("[data-review] .br7-alt")[0]
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await sleep(200);
  expect(debug().sess, "the session must SURVIVE selecting an alternate (detached-target regression)");
  expect(body() === "Second wording", `selection must replace the shown wording, shows "${body()}"`);
  expect(alts().join("|") === "First wording|Third wording", `original must join the alternates: ${alts().join("|")}`);
  // Switch again — the selection is a live choice, not a one-shot.
  document.querySelectorAll("[data-review] .br7-alt")[1]
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await sleep(200);
  expect(body() === "Third wording", `second switch must hold, shows "${body()}"`);
  // Authorize sends the SELECTED wording, not the original.
  $("[data-review] [data-auth]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await sleep(150);
  const auth = spies.sent.find((x) => x.action === "authorize");
  expect(auth && auth.value === "Third wording", `authorize must carry the selection, sent ${JSON.stringify(auth)}`);
  // close without the ceremony: the engine never confirmed, so just exit
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(300);
});

test("a stray click never costs work: unsent words hold the session, and outlive leaving it", async () => {
  const statuses = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(400);
  const id = "favorite_media";
  try { localStorage.removeItem(`cc_draft_${id}`); } catch { /* ignore */ }
  const surface = await openAndCapture(ctx, id);
  surface.ask("you");
  await sleep(150);

  // A click on the bare field, mid-thought, must not close the interview.
  const inp = $(".br7-input");
  inp.value = "my grandfather, who fixed everything himself";
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  const strip = $(".br-strip");
  strip.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 400 }));
  await sleep(250);
  expect(debug().lOpen, "a stray click discarded a session with unsent words in it");
  expect($(".br7-input").value.includes("grandfather"), "the unsent words were lost");

  // Paragraphs (Shift+Enter, or the counselor's own) must survive rendering.
  surface.say("First paragraph.\n\nSecond paragraph.");
  await sleep(150);
  const bubble = $(".br7-say");
  expect(bubble && bubble.textContent.includes("\n"), "the newline was lost before rendering");
  expect(getComputedStyle(bubble).whiteSpace === "pre-line",
    "chat bubbles collapse newlines — Shift+Enter paragraphs vanish on send");

  // Leaving deliberately keeps the words for the return.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  for (let i = 0; i < 20 && debug().sess; i++) await sleep(150); // the leave animation owns the field
  await sleep(300);
  expect(!debug().lOpen, "Escape must still leave the session");
  let stored = null;
  try { stored = localStorage.getItem(`cc_draft_${id}`); } catch { /* ignore */ }
  expect(stored && stored.includes("grandfather"), `the draft was not kept for the return (${stored})`);

  // …and an empty composer keeps the click-out affordance intact.
  const surface2 = await openAndCapture(ctx, id);
  surface2.ask("you");
  await sleep(150);
  const inp2 = $(".br7-input");
  expect(inp2.value.includes("grandfather"), "the kept draft did not come back on reopen");
  inp2.value = "";
  inp2.dispatchEvent(new Event("input", { bubbles: true }));
  $(".br-strip").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 400 }));
  await sleep(400);
  expect(!debug().lOpen, "with nothing at stake, clicking the field should still leave");
});

test("the name never blinks out when the canvas hands it back to the DOM", async () => {
  // While a step wakes, its name is canvas paint; the moment it is woven the
  // DOM label takes over. If that label fades in, the name is simply absent
  // for a third of a second — it read as the name vanishing and reappearing
  // at the far end of the weave.
  const waking = DEFS.map((_, i) => (i === 0 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(waking, { overture_done: true }));
  render(ctx);
  await sleep(600); // past the .34s fade
  const span = () => $('.br-label[data-i="0"] [data-lab]');
  const yielded = parseFloat(getComputedStyle(span()).opacity);
  expect(yielded < 0.05, `a waking step's DOM name must yield to the canvas (opacity ${yielded})`);

  // Weave it: the same journey with the step authorized.
  const woven = DEFS.map((_, i) => (i === 0 ? "authorized" : i === 1 ? "available" : "planned"));
  const { ctx: ctx2 } = makeCtx(makeJourney(woven, { overture_done: true }));
  render(ctx2);
  await sleep(60); // one frame's grace, far inside any fade
  const op = parseFloat(getComputedStyle(span()).opacity);
  expect(op > 0.9, `the name blinked out during the hand-off (opacity ${op})`);

  // …and the other way. When the canvas TAKES a name, the DOM copy has to go
  // in the same frame: a fade leaves both on screen at once, in two different
  // places, and the name reads as doubled.
  const nextSpan = () => $('.br-label[data-i="2"] [data-lab]');
  expect(parseFloat(getComputedStyle(nextSpan()).opacity) > 0.1, "step 3 should own its name in the DOM here");
  const waking2 = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx: ctx3 } = makeCtx(makeJourney(waking2, { overture_done: true }));
  render(ctx3);
  await sleep(60);
  const handed = parseFloat(getComputedStyle(nextSpan()).opacity);
  expect(handed < 0.1, `the DOM name lingered beside its canvas copy (opacity ${handed})`);
});

test("the counselor's asterisks become emphasis, the client's survive as typed", async () => {
  const statuses = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);
  const surface = await openAndCapture(ctx, "favorite_media");
  surface.say("completely open *and* a machine of **output**.");
  await sleep(150);
  const said = $(".br7-say");
  expect(!said.textContent.includes("*"), `markdown reached the client: ${said.textContent}`);
  expect(said.querySelector("em") && said.querySelector("strong"), "emphasis was not rendered");

  // Not everything with a star is markup: arithmetic and code-ish words are
  // the client's own text and must arrive exactly as written.
  surface.say("I work 5*8 hours and read snake_case_names all day");
  await sleep(150);
  const plain = [...document.querySelectorAll(".br7-say")].pop();
  expect(plain.textContent.includes("5*8"), `arithmetic was eaten: ${plain.textContent}`);
  expect(plain.textContent.includes("snake_case_names"), `underscores were eaten: ${plain.textContent}`);

  // And the client's own words are never re-rendered — they show as typed.
  surface.ask("you");
  await sleep(100);
  const inp = $(".br7-input");
  inp.value = "he said *nothing*";
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await sleep(200);
  const mine = [...document.querySelectorAll(".br7-user")].pop();
  expect(mine.textContent.includes("*nothing*"), `the client's asterisks were altered: ${mine.textContent}`);
});

test("the unfolded record reads like the conversation did", async () => {
  // A second rendering path, and it read raw: the client opened a woven step
  // and saw the counselor's asterisks printed as characters.
  window.__net["/api/session/favorite_story"] = {
    exchange: [
      { speaker: "interviewer", text: "you were *completely* open" },
      { speaker: "user", text: "he said *nothing*" },
    ],
  };
  const statuses = DEFS.map((_, i) => (i <= 3 ? "authorized" : i === 4 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);
  const surface = await openAndCapture(ctx, "favorite_story");
  await sleep(200); // the saved session lands before the passage is built
  surface.review({ ...REVIEW, existing: true });
  await sleep(400);
  const toggle = $("[data-whisper]");
  expect(toggle && toggle.classList.contains("br7-hist-toggle"), "the whisper never became a toggle");
  toggle.click();
  await sleep(150);
  const replayed = $("[data-hist] .br7-say");
  expect(replayed, "the transcript never unfolded");
  expect(!replayed.textContent.includes("*"), `markdown reached the record: ${replayed.textContent}`);
  expect(replayed.querySelector("em"), "emphasis was not rendered in the record");
  const replayedMine = $("[data-hist] .br7-user");
  expect(replayedMine.textContent.includes("*nothing*"),
    `the client's asterisks were altered in the record: ${replayedMine.textContent}`);
  delete window.__net["/api/session/favorite_story"];
});

test("writing keeps the end of the conversation in view", async () => {
  const statuses = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);
  const surface = await openAndCapture(ctx, "favorite_media");
  const para = (i) => `Turn ${i}. ` + "A counselor's answer runs several lines on this stage, ".repeat(4);
  for (let i = 0; i < 8; i++) surface.say(para(i));
  surface.ask("you");
  await sleep(900); // let the transcript's own settle timers finish first
  const box = $(".br7-msgs");
  const inp = $(".br7-input");
  const atEnd = () => box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
  expect(box.scrollHeight > box.clientHeight, "transcript must overflow for this to mean anything");
  expect(atEnd(), "the transcript should open at the end");

  // The field grows as the client writes, and the transcript floor rides up
  // with it. The last thing the counselor said was left behind the rising
  // floor, clipped mid-sentence, and the client had to scroll to find it.
  box.scrollTop = 0;
  inp.value = Array.from({ length: 8 }, (_, i) => `line ${i} of what the client is writing`).join("\n");
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(700);
  expect(inp.offsetHeight > 60, `the field never grew (${inp.offsetHeight}px)`);
  expect(atEnd(),
    `writing left the end of the conversation off-screen by ` +
    `${(box.scrollHeight - box.clientHeight - box.scrollTop).toFixed(1)}px`);
  const last = [...document.querySelectorAll(".br7-say")].pop();
  const over = last.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom;
  expect(over <= 1, `the growing field cut off the newest words by ${over.toFixed(1)}px`);
});

test("the readout reads as people, then the pattern about all of them", async () => {
  // Role models and guides are both lists of named blocks. Unlabelled they
  // ran together as six anonymous names, and the artifact-wide traits under
  // them looked like they belonged to whoever happened to be last — a tester
  // asked, reasonably, whether he had ever said those things about Hitman.
  const statuses = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);
  const surface = await openAndCapture(ctx, "role_models");
  surface.review({
    ...REVIEW,
    mode: "structured_review",
    field_order: ["models", "guides", "shared_by_all", "primacy_trait", "repeated_traits"],
    warnings: ["I am more social"],
    draft: {
      models: [
        { name: "Archangel Michael", named_order: 1,
          descriptors: [
            { text: "strong", spoken_order: 2 },
            { text: "Benevolent", spoken_order: 1 },
            { text: "always committed to protect people and give them space to realize themselves, prevent to fall into the abyss", spoken_order: 3 },
          ],
          similarities: ["I am also can be counted on"], differences: ["I am more social"] },
        { name: "J.S. Bach", named_order: 2, descriptors: [{ text: "so emotional and honest" }],
          similarities: ["Try to be honest always"], differences: [] },
        { name: "Hitman", named_order: 3, descriptors: [{ text: "He does the work so clean" }],
          similarities: [], differences: [] },
      ],
      guides: [],
      shared_by_all: null,
      primacy_trait: "Benevolent",
      repeated_traits: [{ trait: "Honest", echoes: ["honest", "honest always"] }],
    },
  });
  await sleep(300);
  const body = $("[data-review] .br7-review-body");
  const secs = [...body.querySelectorAll(".dv-sec")];
  const heads = secs.map((s) => s.querySelector(".field-label")?.textContent);
  expect(heads.length === 2, `want a people section and a pattern section, got: ${heads.join("|")}`);
  expect(heads[0] === `${t("models_heading")} ${t("models_heading_soft")}`, `people heading: ${heads[0]}`);
  expect(heads[1] === `${t("pattern_heading")} ${t("pattern_heading_soft")}`, `pattern heading: ${heads[1]}`);

  // A person to a card, in the order they were named.
  const cards = [...secs[0].querySelectorAll(".rm-block")];
  expect(cards.length === 3, `want three people, got ${cards.length}`);
  expect(cards[0].querySelector(".dr-eyebrow").textContent === `${t("entity_model", 1)} · ${t("named_first")}`,
    `first eyebrow: ${cards[0].querySelector(".dr-eyebrow").textContent}`);
  expect(cards[1].querySelector(".dr-eyebrow").textContent === t("entity_model", 2), "second eyebrow wrong");
  expect(!cards[2].textContent.includes("Bach"), "one person's card swallowed another");

  // Every descriptor is its own chip, in the order it was spoken, and the
  // word said first about the first model is found by its TEXT.
  const chips = [...cards[0].querySelectorAll(".rm-chip")];
  expect(chips.length === 3, `want a chip per descriptor, got ${chips.length}`);
  expect(chips[0].textContent.includes("Benevolent"), `chips ignored spoken_order: ${chips.map((c) => c.textContent)}`);
  expect(chips[0].classList.contains("is-primacy"), "the said-first word is not marked on its chip");
  expect(!chips[1].classList.contains("is-primacy"), "a second chip was marked too");

  // A descriptor can be a word or a sentence, so a chip's SIZE varies — its
  // corner must not. A pill radius clamps to half the height and would curve
  // the wrapped chip twice as hard as the one beside it.
  // Measure the corner the browser DRAWS, not the one declared: a radius
  // larger than half the box is clamped to half, which is exactly how a pill
  // ends up with a different curve on every line count.
  const corner = (c) => {
    const { width, height } = c.getBoundingClientRect();
    return Math.round(Math.min(parseFloat(getComputedStyle(c).borderTopLeftRadius), height / 2, width / 2));
  };
  // Outline only: the field shows through a person's card, and the border
  // is the whole card. The sage pattern card is the deliberate exception.
  const cardBg = getComputedStyle(cards[0]).backgroundColor;
  expect(/rgba\(0, 0, 0, 0\)|transparent/.test(cardBg), `a person's card has a fill: ${cardBg}`);
  expect(getComputedStyle(cards[0]).borderTopWidth !== "0px", "the card lost its perimeter too");

  const radii = new Set(chips.map(corner));
  const heights = new Set(chips.map((c) => Math.round(c.getBoundingClientRect().height)));
  expect(heights.size > 1, "this only means something when the chips are different sizes");
  expect(radii.size === 1, `chips disagree on their corner: ${[...radii].join("px | ")}px`);

  // Like you / Unlike you, and a paraphrase flagged once — by its tag.
  const labs = [...cards[0].querySelectorAll(".dr-rowlab")].map((e) => e.textContent);
  expect(labs.join("|") === `${t("rm_similarities")}|${t("rm_differences")}`, `duo labels: ${labs.join("|")}`);
  const tag = cards[0].querySelector(".assumed-tag");
  expect(tag && tag.textContent === t("assumed_tag"), `paraphrase tag: ${tag?.textContent}`);
  expect(getComputedStyle(cards[0].querySelector(".assumed")).borderBottomStyle === "none",
    "the paraphrase is double-flagged — dashed underline AND tag");

  // The pattern is about all three, and must not read as the last one's.
  expect(!cards[2].textContent.includes("Benevolent"), "artifact-wide traits leaked into a person's card");
  const sage = secs[1].querySelector(".dr-sage");
  expect(sage && sage.textContent.includes("Benevolent") && sage.textContent.includes(t("salience_first")),
    "the said-first card is missing");
  expect(secs[1].textContent.includes("Honest") && secs[1].textContent.includes("honest always"),
    "the repeated trait lost its echoes");

  // Declared fields the client left empty are said, not silently dropped.
  const empty = body.querySelector(".dr-empty");
  expect(empty && empty.textContent === `${t("empty_guides")} · ${t("empty_shared")}`,
    `empty-state footnote: ${empty?.textContent}`);
});

test("guides that were named render as people, never as the empty footnote", async () => {
  const statuses = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);
  const surface = await openAndCapture(ctx, "role_models");
  surface.review({
    ...REVIEW,
    mode: "structured_review",
    field_order: ["models", "guides"],
    draft: {
      models: [{ name: "Archangel Michael", named_order: 1, descriptors: [{ text: "strong" }] }],
      guides: [{ name: "my mother", relationship: "mother", descriptors: ["she never sat down"] }],
    },
  });
  await sleep(300);
  const body = $("[data-review] .br7-review-body");
  const secs = [...body.querySelectorAll(".dv-sec")];
  const guide = secs[1].querySelector(".rm-block");
  expect(guide.querySelector(".dr-eyebrow").textContent === `${t("entity_guide")} · mother`,
    `guide eyebrow: ${guide.querySelector(".dr-eyebrow").textContent}`);
  expect(!guide.textContent.includes("mother\nmother"), "the relationship printed twice");
  expect(!body.querySelector(".dr-empty"), "named guides must never draw the empty-state footnote");
});

test("starting a step over asks twice before it erases anything", async () => {
  window.__net["/api/session/favorite_story"] = { exchange: [{ speaker: "user", text: "the story" }] };
  const statuses = DEFS.map((_, i) => (i <= 3 ? "authorized" : i === 4 ? "available" : "planned"));
  const { ctx, spies } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);
  const surface = await openAndCapture(ctx, "favorite_story");
  await sleep(200);
  surface.review({ ...REVIEW, existing: true });
  await sleep(400);
  const btn = $("[data-reset]");
  expect(btn, "a settled step offers no way to start over");
  const resting = btn.textContent;

  // One press only arms it — the client's words are still there.
  btn.click();
  await sleep(100);
  expect(spies.resets.length === 0, "one press erased the step");
  expect(btn.classList.contains("armed") && btn.textContent !== resting,
    "the armed press must say what is about to happen");

  // The second press is the one that means it.
  btn.click();
  await sleep(200);
  expect(spies.resets.join() === "favorite_story",
    `wrong step reset: ${spies.resets.join() || "(none)"}`);
  delete window.__net["/api/session/favorite_story"];
});

test("the document never scrolls out from under the braid", async () => {
  const { ctx } = makeCtx(makeJourney(DEFS.map(() => "planned"), { overture_done: true }));
  render(ctx);
  await sleep(200);
  // PageDown once carried the whole field away (the page scrolled beneath it)
  // and the session read as empty until a restart.
  expect(getComputedStyle(document.body).overflow === "hidden",
    "body must be locked while the braid owns the viewport");
  const before = document.documentElement.scrollTop;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
  await sleep(200);
  expect(document.documentElement.scrollTop === before,
    `the page scrolled under the braid (${before} → ${document.documentElement.scrollTop})`);
});

test("the α overture: withheld field, wake on invitation, dismissal on first weave", async () => {
  const statuses = DEFS.map((_, i) => (i === 0 ? "available" : "planned"));
  const { ctx, spies } = makeCtx(makeJourney(statuses, {}));
  render(ctx);
  await sleep(300);
  const alpha = $(".br-alpha");
  expect(alpha && !alpha.hidden, "overture layer should show on a virgin journey");
  expect($('[data-ao="lead"]').textContent === t("braid_alpha_lead"), "lead copy wrong");
  expect($(".br-plaque").style.opacity === "0", "plaque must be withheld pre-wake");
  // The aura (glow + ping) is canvas paint gated on ov && !ovWake — assert
  // the gate itself; the DOM nimbus stays dark for any waking node now.
  expect(debug().ov && !debug().ovWake, "canvas aura gate must hold pre-wake (ov set, ovWake unset)");
  expect($(".br-nimbus").style.opacity === "0", "DOM nimbus must stay dark while waking");
  expect(parseFloat($('path[data-s="5"]').style.opacity) === 0.16, "planned threads must lift to .16");
  $('[data-ao="begin"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await sleep(300);
  // The waking plaque is canvas-ridden: the DOM twin stays dark; the wake
  // must open the aura/text gates and the captured plaque strings must exist.
  expect(debug().ovWake, "wake must open the canvas aura gate");
  expect(debug().wake, "waking plaque strings must be captured for the canvas ride");
  // first authorize dismisses the overture forever
  const surface = await openAndCapture(ctx, "counseling_goal");
  surface.review(REVIEW);
  await sleep(200);
  $("[data-review] [data-auth]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await sleep(100);
  expect(spies.sent.some((x) => x.action === "authorize"), "authorize never sent");
  surface.done("authorized");
  await sleep(3300); // seal 1.4s + dismissal fade under way
  expect($(".br-alpha").style.opacity === "0" || $(".br-alpha").hidden, "overture must dismiss on first weave");
  expect(spies.flags.includes("overture_done"), "overture_done flag never persisted");
  await sleep(4500); // let the ceremony advance + resync settle
});

test("Σ holds back while a story is still untold", async () => {
  const statuses = DEFS.map((_, i) => (i <= 4 ? "authorized" : i === 5 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, {}));
  render(ctx);
  await sleep(300);
  const layer = $(".br-alpha");
  expect(!layer || layer.hidden, "Σ opened with an interview step still to tell");
  expect(!debug().ov, "the field must not be withheld yet");
});

test("Σ returns on every open while How-you-see-it waits", async () => {
  // Σ is state, not memory: six told and the first composed bead unwoven
  // means the moment still stands — a reload walks back into it.
  const statuses = DEFS.map((_, i) => (i <= 5 ? "authorized" : i === 6 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(400);
  const layer = $(".br-alpha");
  expect(layer && !layer.hidden && debug().ov && debug().ovKind === "sigma",
    "Σ must rise again on a reload while the first composed bead waits");
  expect($('[data-ao="lead"]').textContent === t("braid_sigma_lead"), "wrong copy on the reload path");
});

test("Σ stays gone once How-you-see-it is woven", async () => {
  const statuses = DEFS.map((_, i) => (i <= 6 ? "authorized" : i === 7 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(400);
  // (A fresh page would have no layer at all; in the harness the previous
  // scenario's Σ is still up, so this render must retire it — the 1.5s fade
  // is still running at this point, so ask the state and the opacity.)
  expect(!debug().ov, "the field is quiet once the reading has begun");
  const layer = $(".br-alpha");
  expect(!layer || layer.hidden || layer.style.opacity === "0",
    "Σ must not return after the first composed bead is woven");
});

test("Σ fires on the weave that completes the telling, and the next weave retires it", async () => {
  const statuses = DEFS.map((_, i) => (i <= 4 ? "authorized" : i === 5 ? "available" : "planned"));
  const { ctx, spies } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);

  // The sixth telling is authorized live: seal ≈1.4s, weave ≈+1.75s,
  // advance ≈+3.6s — and Σ arrives with the advance.
  const er = await openAndCapture(ctx, "early_recollections");
  er.review(REVIEW);
  await sleep(200);
  $("[data-review] [data-auth]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  er.done("authorized");
  await sleep(6200);
  expect(debug().ov && debug().ovKind === "sigma", `Σ should be up after the sixth weave: ${JSON.stringify({ ov: debug().ov, kind: debug().ovKind })}`);
  const layer = $(".br-alpha");
  expect(layer && !layer.hidden, "the layer never showed");
  expect($('[data-ao="lead"]').textContent === t("braid_sigma_lead"),
    `Σ is showing the wrong copy: ${$('[data-ao="lead"]').textContent}`);
  const pause = $('[data-ao="pause"]');
  expect(pause && !pause.hidden && pause.textContent === t("braid_sigma_pause"),
    `the pause offer is missing: ${pause?.textContent}`);

  // The braid the client just built keeps its weight; loose threads step back.
  const woven = $('[data-s="0"]'), planned = $('[data-s="10"]');
  expect(woven.style.opacity !== "0.16" && woven.style.opacity !== ".16",
    `a woven thread dimmed under Σ: ${woven.style.opacity}`);
  expect(planned.style.opacity === "0.16" || planned.style.opacity === ".16",
    `a loose thread should lift to .16: ${planned.style.opacity}`);

  // The wake releases the hold — Σ's copy stands left of the field and the
  // bead's name rises beside it. Half a screen fits both.
  await sleep(5200);
  expect(debug().ovWake && !debug().ovHold, "the wake should release Σ's hold");
  {
    const cv = $(".br-live"), g = cv.getContext("2d");
    const seen = [];
    const orig = g.fillText.bind(g);
    g.fillText = function (txt, x, ...rest) {
      if (typeof txt === "string" && /How|you|see/.test(txt)) {
        seen.push(g.textAlign === "right" ? x - g.measureText(txt).width : x);
      }
      return orig(txt, x, ...rest);
    };
    const t0 = performance.now();
    for (let k = 0; k < 60; k++) window.Braid._frame(t0 + k * 40);
    g.fillText = orig;
    expect(seen.length > 0, "the waking bead's name never rose beside Σ");
    // …and on the empty right half, not through Σ's column (ends ≈ x 368).
    expect(Math.min(...seen) > 370, `the name ran into Σ's copy: left edge ${Math.min(...seen).toFixed(0)}`);
  }

  // The invitation leads to the step that composes itself.
  $('[data-ao="begin"]').click();
  await sleep(1300);
  expect(debug().focus === 6, `the invitation went to ${debug().focus}, want the first derived step`);

  // Entering the seventh bead's session releases the hold: Σ's copy is
  // CSS-hidden there, and the bead the client is talking to gets its name
  // back — painted on the canvas, beside the chat.
  const pv = await openAndCapture(ctx, "perspective");
  await sleep(400);
  expect(debug().sess && !debug().ovHold, "Σ's withhold followed the client into the session");
  {
    const cv = $(".br-live"), g = cv.getContext("2d");
    const seen = [];
    const orig = g.fillText.bind(g);
    g.fillText = function (txt, ...rest) {
      if (typeof txt === "string" && /How|you|see/.test(txt)) seen.push(txt);
      return orig(txt, ...rest);
    };
    const t0 = performance.now();
    for (let k = 0; k < 40; k++) window.Braid._frame(t0 + k * 40);
    g.fillText = orig;
    expect(seen.length > 0, "the seventh bead's name never painted inside the session");
  }

  // The next weave retires it — no flag, ever: it either played or it didn't.
  pv.review(REVIEW);
  await sleep(200);
  $("[data-review] [data-auth]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  pv.done("authorized");
  await sleep(2400);
  expect(!debug().ov, "Σ must leave when the next bead weaves");
  expect(spies.flags.length === 0, `Σ persisted something: ${spies.flags.join(",")}`);
});

test("the waking name stays on its canvas — wrapped into the room the session leaves", async () => {
  // Far down the journey the waking bead sits left of centre, and the session
  // pins the name to the node's left (the chat owns the right). The risen
  // name used to run off the canvas edge: "ur first moves".
  const statuses = DEFS.map((_, i) => (i <= 12 ? "authorized" : i === 13 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);
  await openAndCapture(ctx, "action_recipe");
  await sleep(400);
  const cv = $(".br-live"), g = cv.getContext("2d");
  const seen = [];
  const orig = g.fillText.bind(g);
  g.fillText = function (txt, x, y, ...rest) {
    if (typeof txt === "string" && /Your|first|moves/.test(txt)) {
      const w = g.measureText(txt).width;
      seen.push({ left: g.textAlign === "right" ? x - w : x, right: g.textAlign === "right" ? x : x + w, y });
    }
    return orig(txt, x, y, ...rest);
  };
  const t0 = performance.now();
  for (let k = 0; k < 160; k++) window.Braid._frame(t0 + k * 40); // nameP eases to 1
  g.fillText = orig;
  expect(seen.length > 0, "the waking name never painted");
  const minLeft = Math.min(...seen.map((s) => s.left));
  const maxRight = Math.max(...seen.map((s) => s.right));
  expect(minLeft >= 0, `the name ran off the canvas: left edge ${minLeft.toFixed(1)}`);
  expect(maxRight <= 900, `the name ran off the right: ${maxRight.toFixed(1)}`);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(300);
});

test("α plays for a fresh profile even after another journey's moments", async () => {
  // One journey stands mid-Σ…
  const s1 = DEFS.map((_, i) => (i <= 5 ? "authorized" : i === 6 ? "available" : "planned"));
  const a = makeCtx(makeJourney(s1, { overture_done: true }));
  render(a.ctx);
  await sleep(300);
  expect(debug().ov && debug().ovKind === "sigma", "precondition: Σ up on the first profile");

  // …and a brand-new profile must still get its overture. The moment state
  // lives in the module, and it used to travel: a fresh journey booted with
  // the old one's "already played" and showed nothing at all.
  const b = makeCtx(makeJourney(DEFS.map(() => "planned"), {}));
  b.ctx.profile = "fresh-" + Math.floor(performance.now());
  render(b.ctx);
  await sleep(300);
  expect(debug().ov && debug().ovKind === "alpha",
    `α must open on the fresh profile: ${JSON.stringify({ ov: debug().ov, kind: debug().ovKind })}`);
  expect($('[data-ao="lead"]').textContent === t("braid_alpha_lead"), "the fresh profile got the wrong copy");
});

test("the authorize ceremony: travel wireframe, solidify, promoted next bead, resync", async () => {
  const statuses = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx, spies } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);
  const surface = await openAndCapture(ctx, "favorite_media");
  surface.review(REVIEW);
  await sleep(200);
  $("[data-review] [data-auth]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  surface.done("authorized"); // t0; seal 1.4s + 350ms stagger → weave starts ≈ t0+1.75s
  // The words stay ON the node while the weave carries it: sample the gap all
  // the way through the travel, not just once it has settled.
  const gapNow = () => {
    const x = (sel) => new DOMMatrixReadOnly(getComputedStyle($(sel)).transform).m41;
    return Math.abs(x(".br-plaque") - x('.br-node[data-i="2"]'));
  };
  let worstGap = 0;
  const watch = setInterval(() => { worstGap = Math.max(worstGap, gapNow()); }, 90);
  await sleep(2600); // mid-travel (weave+0.85s)
  clearInterval(watch);
  expect(worstGap < 6, `the caption came ${worstGap.toFixed(1)}px away from its node during the weave`);
  let d = debug();
  expect(d.merge, "ceremony merge state missing during travel");
  expect(d.status.split(",")[2] === "done", "status must flip to done at t=0");
  expect(core(2).__c === "wire2", `travel must keep the wireframe, core is ${core(2).__c}`);
  expect(!$("[data-sat]"), "rings must never orbit a solidifying bead");
  await sleep(1800); // ≈ weave+2.65s — solid phase
  expect(core(2).__c === "solid3", `solidify must swap the material, core is ${core(2).__c}`);
  expect($(".br-plaque-line").textContent === t("braid_woven_in"), "caption must read Woven in.");
  await sleep(1600); // ≈ weave+4.25s — advance done
  d = debug();
  expect(!d.merge, "merge must clear at advance");
  expect(d.focus === 3, `focus must glide to the next bead, is ${d.focus}`);
  expect(d.status.split(",")[3] === "next", "the next bead must be PROMOTED at advance, before the resync");
  expect(core(3).__c === "live", `promoted bead must wear the waking material (live), core is ${core(3).__c}`);
  expect(core(3).style.width === "50px", `promoted bead must grow to 50px, is ${core(3).style.width}`);
  await sleep(1600); // ≈ weave+5.85s — past advance+1.3s
  expect(spies.reload >= 1, "the always-resync never fired");
});

test("the Ω: descent, pour, the verbatim reading, rest, re-entry", async () => {
  const statuses = DEFS.map((_, i) => (i === 14 ? "available" : "authorized"));
  const { ctx, spies } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(200);
  const surface = await openAndCapture(ctx, "closing_check");
  surface.review(REVIEW);
  await sleep(200);
  $("[data-review] [data-auth]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  surface.done("authorized"); // t0; weave ≈ +1.75s; advance → Ω ≈ t0+5.35s
  await sleep(6300);
  const stage = $(".br-stage");
  expect(stage.dataset.omg === "1", "omega state must mark the stage");
  expect($(".br-strip").style.transform.includes("-1330"), `descent transform wrong: ${$(".br-strip").style.transform}`);
  await sleep(2200); // ≈ the pour (Ω+2.75s)
  expect(debug().merge, "the pour must hold the omega merge phase for the rope shake");
  await sleep(1800); // ≈ the reading (Ω+4.4s)
  const rd = $(".br-omread");
  expect(rd && !rd.hidden, "the reading must appear");
  expect(rd.querySelector(".br-om-reading").textContent.includes("«I will be happy and successful when the test passes"),
    "the identity statement must read back verbatim");
  expect(rd.querySelector(".br-om-note").textContent === t("braid_omega_note"), "the omega note copy is wrong");
  await sleep(1600); // ≈ rest (+5.7s)
  expect(spies.flags.includes("omega_done"), "omega_done flag never persisted");
  // terminal state is re-enterable: up exits, down at the last bead re-enters
  stage.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, bubbles: true, cancelable: true }));
  await sleep(400);
  expect(stage.dataset.omg !== "1", "wheel-up must exit the terminal state");
  stage.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true }));
  await sleep(400);
  expect(stage.dataset.omg === "1" && !$(".br-omread").hidden, "wheel-down past the last bead must re-enter");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(300);
  expect(stage.dataset.omg !== "1", "Escape must exit the terminal state");
});

/* ── run ──────────────────────────────────────────────────── */

(async () => {
  const results = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (err) {
      results.push({ name, pass: false, error: String(err.message ?? err) });
    }
    await settle();
  }
  window.__uiResults = results;
})();
