import { createServer, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { loadPlaybook } from "./playbook.ts";
import { createAdapter } from "./llm.ts";
import { runPlaybookSession, ARTIFACTS_DIR } from "./session.ts";
import { MAP_NODES, MAP_EDGES, MAP_SECTORS } from "./map.ts";
import { compiledPrompts, type ReviewAction, type SessionIO, type SessionLang } from "./engine.ts";
import type { Artifact, Playbook } from "./types.ts";

const PORT = Number(process.env.PORT ?? 4780);
const PUBLIC_DIR = "public";
const ID_RE = /^[a-z_]+$/;
const SESSION_LANGS: Record<string, SessionLang | undefined> = {
  ru: { code: "ru", instruction: "Russian, addressing the user with the informal, warm “ты” (never the formal “вы”)" },
};
const llm = createAdapter();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function playbookPath(id: string): string {
  return join("playbooks", `${id}.yaml`);
}

function tryPlaybook(id: string): Playbook | null {
  return existsSync(playbookPath(id)) ? loadPlaybook(playbookPath(id)) : null;
}

function isAuthorized(id: string): boolean {
  return existsSync(join(ARTIFACTS_DIR, `${id}.json`));
}

/**
 * Lifecycle status. "planned" covers both nodes without a playbook and nodes
 * whose dependencies aren't met yet: conversation nodes need every consumed
 * artifact; derived nodes need at least one (the engine tolerates partial
 * upstream, e.g. character sketch from role models alone).
 */
function nodeStatus(id: string): string {
  if (isAuthorized(id)) return "authorized";
  if (existsSync(join(ARTIFACTS_DIR, `${id}.session.json`))) return "in_progress";
  const pb = tryPlaybook(id);
  if (!pb) return "planned";
  if (pb.consumes.length > 0) {
    // The goal is context, not source material — it never gates derived nodes.
    const sources = pb.kind === "conversation" ? pb.consumes : pb.consumes.filter((d) => d !== "counseling_goal");
    const gate = pb.gate ?? (pb.kind === "conversation" ? "all" : "any");
    if (sources.length > 0) {
      const met = gate === "all" ? sources.every(isAuthorized) : sources.some(isAuthorized);
      if (!met) return "planned";
    }
  }
  return "available";
}

function firstString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (Array.isArray(v)) for (const item of v) { const s = firstString(item); if (s) return s; }
  if (typeof v === "object" && v !== null) {
    for (const val of Object.values(v)) { const s = firstString(val); if (s) return s; }
  }
  return null;
}

interface DistilledPart {
  label: string | null;
  text: string;
}

/** Structured summary of an authorized artifact for its journey card — full text, no truncation. */
function distill(id: string, content: Record<string, unknown>): DistilledPart[] {
  const one = (text: unknown, label: string | null = null): DistilledPart[] =>
    typeof text === "string" && text.trim() ? [{ label, text }] : [];

  switch (id) {
    case "counseling_goal": return one(content.restated_goal);
    case "motto": return one(content.motto ? `“${content.motto as string}”` : null);
    case "role_models": {
      const models = (content.models ?? []) as { name?: string }[];
      return one(models.map((m) => m.name).filter(Boolean).join(" · "));
    }
    case "favorite_story": return one(content.title);
    case "favorite_media": {
      const media = (content.media ?? []) as { title?: string }[];
      return one(media.map((m) => m.title).filter(Boolean).join(" · "));
    }
    case "early_recollections": {
      const recs = (content.recollections ?? []) as { headline?: string }[];
      return one(recs.map((r) => r.headline).filter(Boolean).map((h) => `“${h}”`).join(" · "));
    }
    case "character_sketch": return one(content.sketch);
    case "perspective": return one(content.perspective_statement);
    case "preferred_settings": return one(content.niche_statement);
    case "script": return one(content.script_statement);
    case "advice_to_self": return one(content.call_to_action);
    case "life_portrait": {
      const movements = (content.movements ?? []) as { title?: string; text?: string }[];
      const parts = movements
        .filter((m) => typeof m.text === "string" && m.text.trim())
        .map((m) => ({ label: m.title ?? null, text: m.text as string }));
      return parts.length > 0 ? parts : one(content.full_portrait);
    }
    case "identity_statement": return one(content.statement);
    case "action_recipe": {
      const week = (content.week_one ?? []) as string[];
      return one(week.map((w) => `• ${w}`).join("\n"));
    }
    case "closing_check": return one(((content.whats_different ?? []) as string[]).join(" · "));
    default: return one(firstString(content));
  }
}

function buildJourney(): unknown {
  let authorized = 0;
  const nodes = MAP_NODES.map((n) => {
    const status = nodeStatus(n.id);
    if (status === "authorized") authorized++;
    let distilled: DistilledPart[] = [];
    if (status === "authorized") {
      const art = JSON.parse(readFileSync(join(ARTIFACTS_DIR, `${n.id}.json`), "utf8")) as Artifact;
      distilled = distill(n.id, art.content);
    }
    return {
      ...n,
      status,
      distilled,
      feeds: n.id === "counseling_goal" ? [] : MAP_EDGES.filter(([from]) => from === n.id).map(([, to]) => to),
      uses: n.id === "counseling_goal"
        ? []
        : MAP_EDGES.filter(([, to]) => to === n.id).map(([from]) => from).filter((f) => f !== "counseling_goal"),
    };
  });
  return { sectors: MAP_SECTORS, nodes, authorized, total: MAP_NODES.length };
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === "/api/journey" || path === "/api/map") return json(res, 200, buildJourney());

  if (path.startsWith("/api/playbook/")) {
    const id = path.slice("/api/playbook/".length);
    if (!ID_RE.test(id)) return json(res, 400, { error: "bad id" });
    const pb = tryPlaybook(id);
    if (!pb) return json(res, 404, { planned: true });
    const lang = SESSION_LANGS[url.searchParams.get("lang") ?? ""];
    return json(res, 200, {
      id: pb.id,
      title: pb.title,
      kind: pb.kind,
      purpose: pb.purpose.trim(),
      consumes: pb.consumes,
      invalidates: pb.invalidates,
      stages: pb.elicit?.stages.map((s) => s.id) ?? [],
      compiled: compiledPrompts(pb, lang),
    });
  }

  if (path.startsWith("/api/session/")) {
    const id = path.slice("/api/session/".length);
    if (!ID_RE.test(id)) return json(res, 400, { error: "bad id" });
    const sessPath = join(ARTIFACTS_DIR, `${id}.session.json`);
    if (!existsSync(sessPath)) return json(res, 404, { error: "no session" });
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(readFileSync(sessPath));
  }

  if (path.startsWith("/api/artifact/")) {
    const id = path.slice("/api/artifact/".length);
    if (!ID_RE.test(id)) return json(res, 400, { error: "bad id" });
    const artPath = join(ARTIFACTS_DIR, `${id}.json`);
    if (!existsSync(artPath)) return json(res, 404, { error: "no artifact" });
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(readFileSync(artPath));
  }

  const filePath = normalize(join(PUBLIC_DIR, path === "/" ? "index.html" : path));
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    return res.end("not found");
  }
  const ext = filePath.slice(filePath.lastIndexOf("."));
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
  res.end(readFileSync(filePath));
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", `http://localhost:${PORT}`);
  const id = url.searchParams.get("playbook") ?? "";
  if (!ID_RE.test(id) || !existsSync(playbookPath(id))) {
    ws.send(JSON.stringify({ type: "error", text: "unknown playbook" }));
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
      const act: ReviewAction =
        msg.action === "feedback"
          ? { action: "feedback", text: msg.text ?? "" }
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

  const pb = loadPlaybook(playbookPath(id));
  const lang = SESSION_LANGS[url.searchParams.get("lang") ?? ""];
  const autoResume = url.searchParams.get("resume") === "1";
  runPlaybookSession(pb, llm, io, { header: false, lang, autoResume })
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
  console.log(`Career Counseling: http://localhost:${PORT} (${llm.describe()})`);
});
