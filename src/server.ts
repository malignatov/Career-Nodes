import { createServer, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { loadPlaybook } from "./playbook.ts";
import { createAdapter } from "./llm.ts";
import { runPlaybookSession, ARTIFACTS_DIR } from "./session.ts";
import { MAP_NODES, MAP_EDGES, MAP_SECTORS } from "./map.ts";
import { compiledPrompts, type SessionIO } from "./engine.ts";

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

function nodeStatus(id: string): string {
  if (existsSync(join(ARTIFACTS_DIR, `${id}.json`))) return "authorized";
  if (existsSync(join(ARTIFACTS_DIR, `${id}.session.json`))) return "in_progress";
  if (existsSync(join("playbooks", `${id}.yaml`))) return "available";
  return "planned";
}

function buildMap(): unknown {
  return {
    sectors: MAP_SECTORS,
    nodes: MAP_NODES.map((n) => ({ ...n, status: nodeStatus(n.id) })),
    edges: MAP_EDGES,
  };
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === "/api/map") return json(res, 200, buildMap());

  if (path.startsWith("/api/playbook/")) {
    const id = path.slice("/api/playbook/".length);
    if (!ID_RE.test(id)) return json(res, 400, { error: "bad id" });
    const pbPath = join("playbooks", `${id}.yaml`);
    if (!existsSync(pbPath)) return json(res, 404, { planned: true });
    const pb = loadPlaybook(pbPath);
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
  if (!ID_RE.test(id) || !existsSync(join("playbooks", `${id}.yaml`))) {
    ws.send(JSON.stringify({ type: "error", text: "unknown playbook" }));
    return ws.close();
  }

  const pending: { resolve: (s: string) => void; reject: (e: Error) => void }[] = [];
  let open = true;

  ws.on("message", (data) => {
    const msg = JSON.parse(String(data)) as { type: string; text?: string };
    if (msg.type === "answer") pending.shift()?.resolve(msg.text ?? "");
  });
  ws.on("close", () => {
    open = false;
    while (pending.length) pending.shift()?.reject(new Error("client disconnected"));
  });

  const send = (type: string, text: string) => {
    if (open) ws.send(JSON.stringify({ type, text }));
  };

  const io: SessionIO = {
    say: (t) => send("say", t),
    note: (t) => send("note", t),
    ask: (prompt) =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        send("ask", prompt);
      }),
  };

  const pb = loadPlaybook(join("playbooks", `${id}.yaml`));
  runPlaybookSession(pb, llm, io)
    .then((outcome) => {
      send("done", outcome);
      if (open) ws.close();
    })
    .catch((err: Error) => {
      if (err.message !== "client disconnected") {
        console.error(`session ${id} failed:`, err);
        send("error", err.message);
      }
      if (open) ws.close();
    });
});

server.listen(PORT, () => {
  console.log(`Career Counseling map: http://localhost:${PORT} (${llm.describe()})`);
});
