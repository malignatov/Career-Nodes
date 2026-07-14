/**
 * Key vendor: turns invite codes into capped OpenRouter sub-keys via the
 * Provisioning API, so the app can be offered free without exposing a master
 * key — and without any counseling content ever touching this server. The
 * only thing it sees is "invite X asked for a key."
 *
 *   OPENROUTER_MANAGEMENT_KEY=...   # dashboard → Settings → Provisioning keys
 *   VENDOR_CAP_USD=2                # credit limit per minted key
 *   VENDOR_PORT=4790
 *   VENDOR_DATA=vendor-data         # invites.json + ledger.json live here
 *   VENDOR_MOCK=1                   # mint fake keys (testing without the API)
 *
 * Invites: vendor-data/invites.json is a JSON array of code strings you hand
 * out. One key per code, forever; the ledger records what was minted.
 *
 *   npm run vendor
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.VENDOR_PORT ?? 4790);
const CAP_USD = Number(process.env.VENDOR_CAP_USD ?? 2);
const DATA_DIR = process.env.VENDOR_DATA ?? "vendor-data";
const MOCK = process.env.VENDOR_MOCK === "1";
const MGMT_KEY = process.env.OPENROUTER_MANAGEMENT_KEY ?? "";

if (!MOCK && !MGMT_KEY) {
  console.error("Set OPENROUTER_MANAGEMENT_KEY (or VENDOR_MOCK=1 for testing).");
  process.exit(1);
}

mkdirSync(DATA_DIR, { recursive: true });
const invitesPath = join(DATA_DIR, "invites.json");
const ledgerPath = join(DATA_DIR, "ledger.json");
if (!existsSync(invitesPath)) writeFileSync(invitesPath, "[]\n");
if (!existsSync(ledgerPath)) writeFileSync(ledgerPath, "[]\n");

interface LedgerEntry {
  code: string;
  key_hash: string;
  minted_at: string;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** Naive per-IP throttle: at most 5 attempts per hour. */
const attempts = new Map<string, number[]>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 3600_000);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > 5;
}

async function mintKey(code: string): Promise<{ key: string; hash: string }> {
  if (MOCK) return { key: `sk-or-mock-${code}-${Date.now().toString(36)}`, hash: `mock-${code}` };
  const res = await fetch("https://openrouter.ai/api/v1/keys", {
    method: "POST",
    headers: { authorization: `Bearer ${MGMT_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ name: `cc-invite-${code}`, limit: CAP_USD }),
  });
  const data = (await res.json()) as { key?: string; data?: { hash?: string }; error?: { message?: string } };
  if (!res.ok || !data.key) throw new Error(data.error?.message ?? `provisioning failed (${res.status})`);
  return { key: data.key, hash: data.data?.hash ?? "unknown" };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      try { resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {}); }
      catch { reject(new Error("bad json body")); }
    });
    req.on("error", reject);
  });
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === "OPTIONS") return json(res, 204, {});
    const path = new URL(req.url ?? "/", `http://localhost:${PORT}`).pathname;

    if (path === "/health") return json(res, 200, { ok: true, mock: MOCK, cap_usd: CAP_USD });

    if (path === "/redeem" && req.method === "POST") {
      const ip = req.socket.remoteAddress ?? "?";
      if (throttled(ip)) return json(res, 429, { error: "too many attempts — try later" });
      const body = await readBody(req);
      const code = String(body.code ?? "").trim();
      // Fresh reads on every request: invites are hand-edited while running.
      const invites = readJson<string[]>(invitesPath);
      const ledger = readJson<LedgerEntry[]>(ledgerPath);
      if (!code || !invites.includes(code)) return json(res, 404, { error: "unknown invite code" });
      if (ledger.some((e) => e.code === code)) return json(res, 409, { error: "invite already redeemed" });
      const minted = await mintKey(code);
      ledger.push({ code, key_hash: minted.hash, minted_at: new Date().toISOString() });
      writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
      console.log(`minted key for invite "${code}" (cap $${CAP_USD})`);
      return json(res, 200, { key: minted.key });
    }

    json(res, 404, { error: "not found" });
  })().catch((err: Error) => json(res, err.message === "bad json body" ? 400 : 500, { error: err.message }));
});

server.listen(PORT, () => {
  console.log(`key vendor on :${PORT} (${MOCK ? "MOCK" : "live"}, cap $${CAP_USD}/key, data in ${DATA_DIR}/)`);
});
