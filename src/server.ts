import { createServer, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { loadPlaybook } from "./playbook.ts";
import { createAdapter } from "./llm.ts";
import { runPlaybookSession, ARTIFACTS_DIR } from "./session.ts";
import { MAP_NODES, MAP_EDGES, MAP_SECTORS } from "./map.ts";
import { compiledPrompts, type ReviewAction, type SessionIO } from "./engine.ts";
import type { Artifact, Playbook } from "./types.ts";

const PORT = Number(process.env.PORT ?? 4780);
const PUBLIC_DIR = "public";
const ID_RE = /^[a-z_]+$/;
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
    if (pb.kind === "conversation") {
      if (!pb.consumes.every(isAuthorized)) return "planned";
    } else {
      // The goal is context, not source material — a derived node unlocks only
      // when at least one of its non-goal sources is authorized.
      const sources = pb.consumes.filter((d) => d !== "counseling_goal");
      if (sources.length > 0 && !sources.some(isAuthorized)) return "planned";
    }
  }
  return "available";
}

function titleOf(id: string): string {
  return MAP_NODES.find((n) => n.id === id)?.title ?? id;
}

function firstString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (Array.isArray(v)) for (const item of v) { const s = firstString(item); if (s) return s; }
  if (typeof v === "object" && v !== null) {
    for (const val of Object.values(v)) { const s = firstString(val); if (s) return s; }
  }
  return null;
}

/** One-line summary of an authorized artifact for its journey card. */
function distill(id: string, content: Record<string, unknown>): string {
  let text: string | null = null;
  if (id === "counseling_goal") text = (content.restated_goal as string) ?? null;
  else if (id === "motto") text = content.motto ? `“${content.motto as string}”` : null;
  else if (id === "role_models") {
    const models = (content.models ?? []) as { name?: string }[];
    text = models.map((m) => m.name).filter(Boolean).join(" · ") || null;
  } else if (id === "favorite_story") text = (content.title as string) ?? null;
  else if (id === "favorite_media") {
    const media = (content.media ?? []) as { title?: string }[];
    text = media.map((m) => m.title).filter(Boolean).join(" · ") || null;
  } else if (id === "early_recollections") {
    const recs = (content.recollections ?? []) as { headline?: string }[];
    text = recs.map((r) => r.headline).filter(Boolean).map((h) => `“${h}”`).join(" · ") || null;
  } else if (id === "character_sketch") text = (content.sketch as string) ?? null;
  text ??= firstString(content);
  if (!text) return "";
  return text.length > 150 ? `${text.slice(0, 147)}…` : text;
}

function buildJourney(): unknown {
  let authorized = 0;
  const nodes = MAP_NODES.map((n) => {
    const status = nodeStatus(n.id);
    if (status === "authorized") authorized++;
    let distilled = "";
    if (status === "authorized") {
      const art = JSON.parse(readFileSync(join(ARTIFACTS_DIR, `${n.id}.json`), "utf8")) as Artifact;
      distilled = distill(n.id, art.content);
    }
    return {
      ...n,
      status,
      distilled,
      feeds: MAP_EDGES.filter(([from, to]) => from === n.id && to !== n.id && n.id !== "counseling_goal")
        .map(([, to]) => titleOf(to)),
      uses: MAP_EDGES.filter(([, to]) => to === n.id && n.id !== "counseling_goal")
        .map(([from]) => titleOf(from))
        .filter((t) => t !== "Goal setting"),
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
    return json(res, 200, {
      id: pb.id,
      title: pb.title,
      kind: pb.kind,
      purpose: pb.purpose.trim(),
      consumes: pb.consumes,
      invalidates: pb.invalidates,
      stages: pb.elicit?.stages.map((s) => s.id) ?? [],
      compiled: compiledPrompts(pb),
    });
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
  runPlaybookSession(pb, llm, io, { header: false })
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
