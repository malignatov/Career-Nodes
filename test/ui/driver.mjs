/**
 * Braid UI scenarios, run inside the real renderer (Electron/Chromium).
 * No network, no model: a fabricated journey enters through the ctx seam and
 * the test plays the counselor through the captured session surface.
 * Results land on window.__uiResults for the runner to collect.
 */
import { STR } from "../../public/i18n.js";

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
  { n: 1, label: "Phase 1 · Goal" },
  { n: 2, label: "Phase 2 · Interview" },
  { n: 3, label: "Phase 3 · Induction" },
  { n: 4, label: "Phase 4 · Portrait & intention" },
  { n: 5, label: "Phase 5 · Action" },
];
const DEFS = [
  ["counseling_goal", "Goal setting", 1, "conversation", 5],
  ["role_models", "Role models", 2, "conversation", 10],
  ["favorite_media", "Favorite media", 2, "conversation", 5],
  ["favorite_story", "Favorite story", 2, "conversation", 5],
  ["motto", "Motto", 2, "conversation", 2],
  ["early_recollections", "Early recollections", 2, "conversation", 10],
  ["perspective", "Perspective", 3, "derived", 2],
  ["character_sketch", "Character sketch", 3, "derived", 2],
  ["preferred_settings", "Preferred settings", 3, "derived", 2],
  ["script", "Script", 3, "derived", 2],
  ["advice_to_self", "Advice to self", 3, "derived", 2],
  ["life_portrait", "Life portrait", 4, "derived", 3],
  ["identity_statement", "Identity statement", 4, "derived", 2],
  ["action_recipe", "Action recipe", 5, "derived", 3],
  ["closing_check", "Closing check", 5, "conversation", 5],
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
  const spies = { reload: 0, flags: [], sent: [], exports: 0 };
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
    renderFields: () => "<div>draft body</div>", compiledHtml: (x) => esc(String(x)),
    exportPdf: async () => { spies.exports++; },
    setFlag: (name) => { spies.flags.push(name); journey.flags = { ...(journey.flags ?? {}), [name]: true }; },
    reload: () => { spies.reload++; },
    stopDictation: () => {}, voice: { enabled: () => false },
    actions: [],
  };
  return { ctx, spies };
}

const render = (ctx) => window.Braid.renderJourney(root, ctx);
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
  expect(core(2).__c === "wire2", `up-next core is ${core(2).__c}, want wire2`);
  expect(core(5).__c === "wlo", `planned core is ${core(5).__c}, want wlo`);
  expect($('.br-node[data-i="8"]').classList.contains("br-future"), "later-phase node lacks br-future");
  expect(!$('.br-node[data-i="4"]').classList.contains("br-future"), "current-phase node wrongly br-future");
  const conv = $('.br-label[data-i="3"]').textContent;
  expect(conv.includes(t("unlocks_after", "Favorite media")), `conversation sub wrong: ${conv}`);
  const der = $('.br-label[data-i="6"]').textContent;
  expect(der.includes(t("derived_sub")), `derived sub wrong: ${der}`);
  expect($('.br-label[data-i="0"]').textContent.trim() === "Goal setting", "done label should be title only");
  expect($(".br-count-phase").textContent === "Interview · 1 of 5", `counter: ${$(".br-count-phase").textContent}`);
  expect($(".br-count-total").textContent === t("braid_woven_of", 2, 15), `total: ${$(".br-count-total").textContent}`);
  expect($(".br-plaque-time").textContent === t("braid_minutes", 5), `plaque time: ${$(".br-plaque-time").textContent}`);
});

test("hover accelerates and brightens the waking sphere", async () => {
  const statuses = DEFS.map((_, i) => (i <= 1 ? "authorized" : i === 2 ? "available" : "planned"));
  const { ctx } = makeCtx(makeJourney(statuses, { overture_done: true }));
  render(ctx);
  await sleep(300);
  const stage = $(".br-stage");
  const nd = $('.br-node[data-i="2"]');
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(nd.style.transform);
  const sm = /,\s*([-\d.]+)px\)/.exec($(".br-strip").style.transform);
  const offX = (stage.clientWidth - 900) / 2;
  const x = offX + parseFloat(m[1]);
  const y = parseFloat(m[2]) + parseFloat(sm[1]);
  stage.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
  let ts = performance.now();
  for (let i = 0; i < 30; i++) { ts += 16; window.Braid._frame(ts); }
  const scale = parseFloat(/scale\(([\d.]+)\)/.exec(nd.style.transform)?.[1] ?? "1");
  expect(scale > 1.68, `hover scale ${scale}, want > 1.68 (1.6 base × grown hover)`);
  const wire = nd.querySelector("[data-wire]");
  expect((wire.parentElement.style.filter || "").includes("brightness"), "hover brightness filter missing");
  stage.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
  for (let i = 0; i < 40; i++) { ts += 16; window.Braid._frame(ts); }
  const back = parseFloat(/scale\(([\d.]+)\)/.exec(nd.style.transform)?.[1] ?? "1");
  expect(back < 1.63, `hover scale should decay, still ${back}`);
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
  const phrase = $(".br7-think-phrase");
  expect(phrase, "thinking row missing after send");
  const pool = t("braid_think_pool");
  expect(phrase.textContent === pool[1], `phrase starts at "${phrase.textContent}", want "${pool[1]}"`);
  expect($("[data-sat]"), "Saturn rings missing during the wait");
  await sleep(300);
  expect($("[data-sat]").style.opacity === "1", "rings never faded in");
  await sleep(2200);
  expect($(".br7-think-phrase").textContent === pool[2], `phrase should rotate, reads "${$(".br7-think-phrase").textContent}"`);
  surface.note("(inducing: extract…)");
  await sleep(150);
  expect($("[data-think]") && $("[data-sat]"), "induction note must keep the loader");
  surface.say("Here are the counselor's words.");
  await sleep(900);
  expect(!$("[data-think]"), "thinking row must clear when words arrive");
  expect(!$("[data-sat]"), "rings must clear when words arrive");
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

test("the α overture: withheld field, wake on invitation, dismissal on first weave", async () => {
  const statuses = DEFS.map((_, i) => (i === 0 ? "available" : "planned"));
  const { ctx, spies } = makeCtx(makeJourney(statuses, {}));
  render(ctx);
  await sleep(300);
  const alpha = $(".br-alpha");
  expect(alpha && !alpha.hidden, "overture layer should show on a virgin journey");
  expect($('[data-ao="lead"]').textContent === t("braid_alpha_lead"), "lead copy wrong");
  expect($(".br-plaque").style.opacity === "0", "plaque must be withheld pre-wake");
  expect($(".br-nimbus").style.opacity === "0", "nimbus must be withheld pre-wake");
  expect($("[data-ping]").style.display === "none", "ping must be withheld pre-wake");
  expect(parseFloat($('path[data-s="5"]').style.opacity) === 0.16, "planned threads must lift to .16");
  $('[data-ao="begin"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await sleep(300);
  expect($(".br-plaque").style.opacity !== "0", "invitation click must wake the plaque");
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
  await sleep(2600); // mid-travel (weave+0.85s)
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
  expect(core(3).__c === "wire2", `promoted bead must wear the waking material, core is ${core(3).__c}`);
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
