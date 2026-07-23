import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { loadPlaybook } from "./playbook.ts";
import { aiAvailable, type LlmAdapter } from "./llm.ts";
import { createAdapter } from "./llm-node.ts";
import { runPlaybookSession, runReviewSession, loadUpstream, saveArtifact } from "./session.ts";
import { buildJourney, profilePrefix, type PlaybookSource } from "./journey.ts";
import { MAP_NODES } from "./map.ts";
import {
  compiledPrompts, runInduce, stageOpening,
  type ReviewAction, type SessionIO, type SessionLang,
} from "./engine.ts";
import {
  manualFormSchema, manualWarnings, verbatimSource, loadExchange, buildManualSession, reconstructManualAnswers,
} from "./manual.ts";
import { defaultStorage } from "./node-storage.ts";
import { scoped, type Storage } from "./storage.ts";
import type { Artifact, ExchangeEntry, Playbook } from "./types.ts";

const PORT = Number(process.env.PORT ?? 4780);
const PUBLIC_DIR = "public";
const ID_RE = /^[a-z_]+$/;
const SESSION_LANGS: Record<string, SessionLang | undefined> = {
  ru: { code: "ru", instruction: "Russian, addressing the user with the informal, warm “ты” (never the formal “вы”)" },
};

// AI is a capability, not a requirement: with no key the app still runs — the
// practitioner authors everything by hand and the generate buttons never show.
const AI_AVAILABLE = aiAvailable();
// Voice dictation is a separate capability: OpenAI live transcription.
const VOICE_AVAILABLE = Boolean(process.env.OPENAI_API_KEY);
let llmInstance: LlmAdapter | null = null;
function getLlm(): LlmAdapter {
  llmInstance ??= createAdapter();
  return llmInstance;
}

const rootStore = defaultStorage();

const silentIO: SessionIO = { say() {}, note() {}, ask: async () => "" };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {}); }
      catch { reject(new Error("bad json body")); }
    });
    req.on("error", reject);
  });
}

function playbookPath(id: string): string {
  return join("playbooks", `${id}.yaml`);
}

const tryPlaybook: PlaybookSource = (id) =>
  existsSync(playbookPath(id)) ? loadPlaybook(playbookPath(id)) : null;

/* ── profiles: one artifacts directory per client ─────── */

async function listProfiles(): Promise<{ id: string; name: string | null }[]> {
  const out: { id: string; name: string | null }[] = [{ id: "default", name: null }];
  for (const entry of await rootStore.list("profiles")) {
    const meta = await rootStore.read(`profiles/${entry}/profile.json`);
    if (meta === null) continue;
    let name: string | null = entry;
    try { name = (JSON.parse(meta) as { name?: string }).name ?? entry; } catch { /* keep slug */ }
    out.push({ id: entry, name });
  }
  return out;
}

async function createProfile(name: string): Promise<{ id: string; name: string }> {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32)
    || `client-${Date.now().toString(36)}`;
  let id = base;
  for (let n = 2; await rootStore.exists(`profiles/${id}/profile.json`); n++) id = `${base}-${n}`;
  await rootStore.write(`profiles/${id}/profile.json`, JSON.stringify({ name, created_at: new Date().toISOString() }, null, 2));
  return { id, name };
}

/* ── request handling ─────────────────────────────────── */

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const lang = SESSION_LANGS[url.searchParams.get("lang") ?? ""];
  const store = scoped(rootStore, profilePrefix(url.searchParams.get("profile")));
  const idOf = (prefix: string): string => {
    const id = path.slice(prefix.length);
    if (!ID_RE.test(id)) throw new Error("bad id");
    return id;
  };

  if (path === "/api/journey" || path === "/api/map") {
    return json(res, 200, await buildJourney(store, tryPlaybook, { ai: AI_AVAILABLE, voice: VOICE_AVAILABLE }));
  }

  // Reset the whole journey, or a single node with ?node=<id>: the node's
  // files go (artifact, session, draft, transcript); the profile entry stays.
  // Surgical by construction — only known node ids and suffixes.
  // The app shell stops a REUSED server on quit through this (a spawned one
  // it kills directly). The custom header keeps cross-origin pages out: they
  // can't send it without a CORS preflight this server never approves.
  if (path === "/api/shutdown" && req.method === "POST") {
    if (req.headers["x-cc-shutdown"] !== "1") return json(res, 403, { error: "forbidden" });
    json(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 50);
    return;
  }

  if (path === "/api/reset" && req.method === "POST") {
    const nodeParam = url.searchParams.get("node");
    const targets = nodeParam ? MAP_NODES.filter((n) => n.id === nodeParam) : MAP_NODES;
    if (nodeParam && targets.length === 0) return json(res, 400, { error: "unknown node" });
    let removed = 0;
    for (const n of targets) {
      for (const suffix of [".json", ".session.json", ".draft.json", ".transcript.json"]) {
        if (await store.exists(`${n.id}${suffix}`)) {
          await store.remove(`${n.id}${suffix}`);
          removed++;
        }
      }
    }
    return json(res, 200, { ok: true, removed });
  }

  if (path === "/api/profiles") {
    if (req.method === "POST") {
      const body = await readBody(req);
      const name = String(body.name ?? "").trim();
      if (!name) return json(res, 400, { error: "name required" });
      return json(res, 200, await createProfile(name));
    }
    return json(res, 200, { profiles: await listProfiles() });
  }

  if (path.startsWith("/api/playbook/")) {
    const id = idOf("/api/playbook/");
    const pb = tryPlaybook(id);
    if (!pb) return json(res, 404, { planned: true });
    return json(res, 200, {
      id: pb.id,
      title: pb.title,
      kind: pb.kind,
      purpose: pb.purpose.trim(),
      consumes: pb.consumes,
      invalidates: pb.invalidates,
      stages: pb.elicit?.stages.map((s) => ({
        id: s.id,
        goal: s.goal,
        opening: stageOpening(s, lang),
        probes: s.probes ?? [],
        done_when: s.done_when,
      })) ?? [],
      form: manualFormSchema(pb),
      confirm_present: pb.confirm?.present ?? null,
      choice_field: pb.confirm?.choice_field ?? null,
      authorize_language: pb.confirm?.authorize_language.trim() ?? "",
      compiled: compiledPrompts(pb, lang),
    });
  }

  if (path.startsWith("/api/session/")) {
    const id = idOf("/api/session/");
    const session = await store.read(`${id}.session.json`);
    if (session === null) {
      // After authorization the live session is gone but the recorded
      // interview remains. Hand-recorded transcripts reconstruct their
      // per-stage answers, so the practitioner can keep editing them;
      // AI-led transcripts show read-only.
      const transcript = await store.read(`${id}.transcript.json`);
      if (transcript !== null) {
        const exchange = JSON.parse(transcript) as ExchangeEntry[];
        const answers = reconstructManualAnswers(tryPlaybook(id), exchange);
        return json(res, 200, { exchange, settled: true, ...(answers ? { manual_answers: answers } : {}) });
      }
      return json(res, 404, { error: "no session" });
    }
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(session);
  }

  if (path.startsWith("/api/artifact/")) {
    const id = idOf("/api/artifact/");
    const art = await store.read(`${id}.json`);
    if (art === null) return json(res, 404, { error: "no artifact" });
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(art);
  }

  if (path.startsWith("/api/upstream/")) {
    const id = idOf("/api/upstream/");
    const pb = tryPlaybook(id);
    if (!pb) return json(res, 404, { error: "no playbook" });
    return json(res, 200, { upstream: await loadUpstream(pb, silentIO, store) });
  }

  if (path.startsWith("/api/draft/")) {
    const id = idOf("/api/draft/");
    const pb = tryPlaybook(id);
    if (!pb) return json(res, 404, { error: "no playbook" });
    const draftPath = `${id}.draft.json`;
    if (req.method === "PUT") {
      const body = await readBody(req);
      const content = (body.content ?? {}) as Record<string, unknown>;
      await store.write(draftPath, JSON.stringify(
        { content, origin: body.origin ?? null, saved_at: new Date().toISOString() }, null, 2,
      ));
      const source = await verbatimSource(pb, store, await loadUpstream(pb, silentIO, store));
      return json(res, 200, { ok: true, warnings: manualWarnings(pb, content, source) });
    }
    if (req.method === "DELETE") {
      await store.remove(draftPath);
      return json(res, 200, { ok: true });
    }
    const draft = await store.read(draftPath);
    if (draft === null) return json(res, 404, { error: "no draft" });
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(draft);
  }

  // Manual authorization: the practitioner is the author; verbatim rules are
  // still checked in code and returned as warnings, never as blockers.
  if (path.startsWith("/api/authorize/") && req.method === "POST") {
    const id = idOf("/api/authorize/");
    const pb = tryPlaybook(id);
    if (!pb) return json(res, 404, { error: "no playbook" });
    const body = await readBody(req);
    const content = body.content as Record<string, unknown> | undefined;
    if (!content || typeof content !== "object") return json(res, 400, { error: "content required" });
    const origin = ["manual", "generated", "mixed"].includes(String(body.origin))
      ? (body.origin as Artifact["origin"]) : "manual";
    const upstream = await loadUpstream(pb, silentIO, store);
    const warnings = manualWarnings(pb, content, await verbatimSource(pb, store, upstream));
    const exchange = await loadExchange(id, store);
    await saveArtifact(pb, content, exchange, store, origin);
    await store.remove(`${id}.draft.json`);
    await store.remove(`${id}.session.json`);
    return json(res, 200, { ok: true, warnings });
  }

  // One-shot AI assist for the manual editor: generate a draft from the
  // recorded interview / sources, or amend the practitioner's current draft.
  if (path.startsWith("/api/compose/") && req.method === "POST") {
    const id = idOf("/api/compose/");
    const pb = tryPlaybook(id);
    if (!pb) return json(res, 404, { error: "no playbook" });
    if (!AI_AVAILABLE) return json(res, 503, { error: "no model configured" });
    const body = await readBody(req);
    const feedback = typeof body.feedback === "string" && body.feedback.trim() ? body.feedback.trim() : undefined;
    const prior = body.prior && typeof body.prior === "object" ? (body.prior as Record<string, unknown>) : undefined;
    const exchange = await loadExchange(id, store);
    const upstream = await loadUpstream(pb, silentIO, store);
    const draft = await runInduce(pb, getLlm(), exchange, upstream, silentIO, feedback, lang, prior);
    const { candidates = [], _verbatim_warnings = [], ...rest } = draft as {
      candidates?: string[]; _verbatim_warnings?: string[];
    } & Record<string, unknown>;
    const field = pb.confirm?.present === "candidates" ? pb.confirm.choice_field : undefined;
    const content = field ? { ...rest, [field]: candidates[0] ?? "" } : rest;
    return json(res, 200, { content, candidates: field ? candidates : [], warnings: _verbatim_warnings });
  }

  // Hand-recorded interview from the script view — same session format the AI
  // interviewer writes, so everything downstream is indistinguishable.
  if (path.startsWith("/api/manual-session/") && req.method === "PUT") {
    const id = idOf("/api/manual-session/");
    const pb = tryPlaybook(id);
    if (!pb?.elicit) return json(res, 404, { error: "not a conversation playbook" });
    const body = await readBody(req);
    const answers = (body.answers ?? {}) as Record<string, string>;
    const sessPath = `${id}.session.json`;
    const existing = await store.read(sessPath);
    if (existing !== null) {
      const saved = JSON.parse(existing) as { manual_answers?: unknown };
      if (!saved.manual_answers) return json(res, 409, { error: "an interviewer-led session exists for this step" });
    }
    const built = buildManualSession(pb, answers, lang);
    if (!built) {
      await store.remove(sessPath);
      return json(res, 200, { ok: true, cleared: true });
    }
    await store.write(sessPath, JSON.stringify(built, null, 2));
    return json(res, 200, { ok: true });
  }

  const filePath = normalize(join(PUBLIC_DIR, path === "/" ? "index.html" : path));
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    return void res.end("not found");
  }
  const ext = filePath.slice(filePath.lastIndexOf("."));
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
  res.end(readFileSync(filePath));
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: Error) => {
    const status = err.message === "bad id" || err.message.startsWith("bad profile") || err.message === "bad json body"
      ? 400 : 500;
    if (!res.headersSent) json(res, status, { error: err.message });
    else res.end();
  });
});

// Two WS endpoints share the HTTP server: /ws (sessions) and /ws/voice
// (dictation proxy). Routed manually — two path-bound servers would race on
// the same upgrade event.
const wss = new WebSocketServer({ noServer: true });
const wssVoice = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const target = pathname === "/ws" ? wss : pathname === "/ws/voice" ? wssVoice : null;
  if (!target) return socket.destroy();
  target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
});

/**
 * Voice dictation proxy: browser streams raw PCM16 (24kHz mono) frames here;
 * we forward them to OpenAI's realtime transcription session and relay the
 * live transcript deltas back. The API key never reaches the page.
 */
wssVoice.on("connection", (ws, req) => {
  if (!VOICE_AVAILABLE) {
    ws.send(JSON.stringify({ type: "error", text: "no OPENAI_API_KEY configured" }));
    return ws.close();
  }
  const url = new URL(req.url ?? "", `http://localhost:${PORT}`);
  const langCode = url.searchParams.get("lang") ?? "";
  const upstream = new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });
  const relay = (payload: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };

  upstream.on("open", () => {
    // GA realtime API shape — the beta transcription_session.* form is retired.
    // gpt-realtime-whisper streams deltas WHILE the user speaks (no VAD turns);
    // the client's mic-stop click sends {type:"stop"}, which we turn into the
    // buffer commit that produces the final transcript.
    upstream.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: {
              model: "gpt-realtime-whisper",
              ...(langCode ? { language: langCode } : {}),
            },
            turn_detection: null,
            noise_reduction: { type: "near_field" },
          },
        },
      },
    }));
  });
  upstream.on("message", (data) => {
    let msg: { type?: string; delta?: string; transcript?: string; item_id?: string; error?: { message?: string } };
    try { msg = JSON.parse(String(data)) as typeof msg; } catch { return; }
    if (msg.type === "session.created") relay({ type: "ready" });
    else if (msg.type === "conversation.item.input_audio_transcription.delta") {
      relay({ type: "delta", item: msg.item_id, text: msg.delta ?? "" });
    } else if (msg.type === "conversation.item.input_audio_transcription.completed") {
      relay({ type: "final", item: msg.item_id, text: msg.transcript ?? "" });
      if (ws.readyState === ws.OPEN) ws.close();
    } else if (msg.type === "error") relay({ type: "error", text: msg.error?.message ?? "transcription error" });
  });
  upstream.on("error", (err: Error) => relay({ type: "error", text: err.message }));
  upstream.on("close", () => { if (ws.readyState === ws.OPEN) ws.close(); });

  let audioReceived = false;
  ws.on("message", (data, isBinary) => {
    if (upstream.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      audioReceived = true;
      upstream.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: Buffer.from(data as Buffer).toString("base64"),
      }));
      return;
    }
    try {
      const msg = JSON.parse(String(data)) as { type?: string };
      if (msg.type === "stop") {
        // Committing an empty buffer errors — just end the session instead.
        if (audioReceived) upstream.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        else ws.close();
      }
    } catch { /* ignore malformed frames */ }
  });
  ws.on("close", () => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
  });
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", `http://localhost:${PORT}`);
  const id = url.searchParams.get("playbook") ?? "";
  const pb = ID_RE.test(id) ? tryPlaybook(id) : null;
  if (!pb) {
    ws.send(JSON.stringify({ type: "error", text: "unknown playbook" }));
    return ws.close();
  }
  if (!AI_AVAILABLE) {
    ws.send(JSON.stringify({ type: "error", text: "no model configured — use practitioner mode" }));
    return ws.close();
  }
  let store: Storage;
  try {
    store = scoped(rootStore, profilePrefix(url.searchParams.get("profile")));
  } catch {
    ws.send(JSON.stringify({ type: "error", text: "bad profile" }));
    return ws.close();
  }

  const pendingAsks: { resolve: (s: string) => void; reject: (e: Error) => void }[] = [];
  const pendingReviews: { resolve: (a: ReviewAction) => void; reject: (e: Error) => void }[] = [];
  let open = true;

  ws.on("message", (data) => {
    const msg = JSON.parse(String(data)) as {
      type: string; text?: string; action?: string; value?: string;
    };
    if (msg.type === "answer") pendingAsks.shift()?.resolve(msg.text ?? "");
    else if (msg.type === "review_action") {
      // Mid-amend-conversation the engine awaits an *answer*; a surface that
      // still sends its notes as feedback (the modal's amend box) must keep
      // working, so a pending ask absorbs feedback text.
      if (msg.action === "feedback" && pendingAsks.length > 0) {
        pendingAsks.shift()?.resolve(msg.text ?? "");
        return;
      }
      const act: ReviewAction =
        msg.action === "feedback"
          ? { action: "feedback", text: msg.text ?? "" }
          : msg.action === "reprocess"
            ? { action: "reprocess" }
            : { action: "authorize", value: msg.value };
      pendingReviews.shift()?.resolve(act);
    }
  });
  ws.on("close", () => {
    open = false;
    const err = new Error("client disconnected");
    while (pendingAsks.length) pendingAsks.shift()?.reject(err);
    while (pendingReviews.length) pendingReviews.shift()?.reject(err);
  });

  const send = (payload: Record<string, unknown>) => {
    if (open) ws.send(JSON.stringify(payload));
  };

  const io: SessionIO = {
    say: (t) => send({ type: "say", text: t }),
    sayAnchor: (t) => send({ type: "say", text: t, anchor: true }),
    note: (t) => send({ type: "note", text: t }),
    ask: (prompt) =>
      new Promise((resolve, reject) => {
        pendingAsks.push({ resolve, reject });
        send({ type: "ask", text: prompt });
      }),
    review: (payload) =>
      new Promise((resolve, reject) => {
        pendingReviews.push({ resolve, reject });
        send({ type: "review", payload });
      }),
  };

  const lang = SESSION_LANGS[url.searchParams.get("lang") ?? ""];
  const autoResume = url.searchParams.get("resume") === "1";
  const reviewMode = url.searchParams.get("mode") === "review";
  (reviewMode
    ? runReviewSession(pb, getLlm(), io, { lang, store })
    : runPlaybookSession(pb, getLlm(), io, { header: false, lang, autoResume, store }))
    .then((outcome) => {
      send({ type: "done", text: outcome });
      if (open) ws.close();
    })
    .catch((err: Error) => {
      if (err.message !== "client disconnected") {
        console.error(`session ${id} failed:`, err);
        send({ type: "error", text: err.message });
      }
      if (open) ws.close();
    });
});

server.listen(PORT, () => {
  const modelInfo = AI_AVAILABLE ? getLlm().describe() : "no model configured — manual authoring only";
  console.log(`Career Counseling: http://localhost:${PORT} (${modelInfo})`);
});
