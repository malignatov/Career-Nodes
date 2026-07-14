/**
 * The mobile shell: runs the whole app inside the WebView — no server.
 * Installs a fetch interceptor for /api/* and a WebSocket shim for /ws
 * (in-page SessionIO) and /ws/voice (direct OpenAI realtime), so the
 * existing UI in public/ runs completely unchanged.
 */
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import { PLAYBOOKS } from "./playbooks-data.ts";
import type { Artifact, ExchangeEntry } from "./types.ts";
import { scoped, type Storage } from "./storage.ts";
import { buildJourney, profilePrefix, type PlaybookSource } from "./journey.ts";
import { runPlaybookSession, runReviewSession, loadUpstream, saveArtifact } from "./session.ts";
import {
  manualFormSchema, manualWarnings, verbatimSource, loadExchange, buildManualSession, reconstructManualAnswers,
} from "./manual.ts";
import {
  compiledPrompts, runInduce, stageOpening, type ReviewAction, type SessionIO, type SessionLang,
} from "./engine.ts";
import { OpenAICompatAdapter, aiAvailable, type LlmAdapter } from "./llm.ts";
import { MAP_NODES } from "./map.ts";
import { cfg } from "./config.ts";

/* ── storage on the device filesystem ─────────────────── */

class CapStorage implements Storage {
  private p(path: string): string {
    return `cc/${path}`;
  }
  async read(path: string): Promise<string | null> {
    try {
      const r = await Filesystem.readFile({ path: this.p(path), directory: Directory.Data, encoding: Encoding.UTF8 });
      return typeof r.data === "string" ? r.data : null;
    } catch {
      return null;
    }
  }
  async write(path: string, data: string): Promise<void> {
    await Filesystem.writeFile({
      path: this.p(path), directory: Directory.Data, encoding: Encoding.UTF8, data, recursive: true,
    });
  }
  async remove(path: string): Promise<void> {
    try {
      await Filesystem.deleteFile({ path: this.p(path), directory: Directory.Data });
    } catch { /* deleting a missing file is fine */ }
  }
  async list(path: string): Promise<string[]> {
    try {
      const r = await Filesystem.readdir({ path: this.p(path), directory: Directory.Data });
      return r.files.map((f) => f.name);
    } catch {
      return [];
    }
  }
  async exists(path: string): Promise<boolean> {
    try {
      await Filesystem.stat({ path: this.p(path), directory: Directory.Data });
      return true;
    } catch {
      return false;
    }
  }
}

const rootStore: Storage = new CapStorage();
const playbooks: PlaybookSource = (id) => PLAYBOOKS[id] ?? null;

const SESSION_LANGS: Record<string, SessionLang | undefined> = {
  ru: { code: "ru", instruction: "Russian, addressing the user with the informal, warm “ты” (never the formal “вы”)" },
};

/* ── config from on-device settings ───────────────────── */

const SETTING_KEYS = [
  "LLM_API_KEY", "OPENAI_API_KEY", "LLM_SMALL_MODEL", "LLM_LARGE_MODEL", "VENDOR_URL",
] as const;

async function loadConfig(): Promise<void> {
  const config: Record<string, string | undefined> = {
    LLM_PROVIDER: "openrouter",
    LLM_IGNORE_PROVIDERS: "DeepSeek,StreamLake,Baidu,Alibaba,SiliconFlow",
  };
  for (const key of SETTING_KEYS) {
    const { value } = await Preferences.get({ key });
    if (value) config[key] = value;
  }
  (globalThis as { CC_CONFIG?: Record<string, string | undefined> }).CC_CONFIG = config;
}

const ready = loadConfig();

let llm: LlmAdapter | null = null;
function getLlm(): LlmAdapter {
  llm ??= new OpenAICompatAdapter("openrouter");
  return llm;
}

const silentIO: SessionIO = { say() {}, note() {}, ask: async () => "" };

/* ── /api/* served in-page ─────────────────────────────── */

const jsonRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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

async function handleApi(url: URL, method: string, body: Record<string, unknown>): Promise<Response> {
  const path = url.pathname;
  const lang = SESSION_LANGS[url.searchParams.get("lang") ?? ""];
  const store = scoped(rootStore, profilePrefix(url.searchParams.get("profile")));
  const idOf = (prefix: string): string => path.slice(prefix.length);

  if (path === "/api/journey" || path === "/api/map") {
    return jsonRes(await buildJourney(store, playbooks, {
      ai: aiAvailable(),
      voice: Boolean(cfg("OPENAI_API_KEY")),
    }));
  }

  if (path === "/api/reset" && method === "POST") {
    const nodeParam = url.searchParams.get("node");
    const targets = nodeParam ? MAP_NODES.filter((n) => n.id === nodeParam) : MAP_NODES;
    if (nodeParam && targets.length === 0) return jsonRes({ error: "unknown node" }, 400);
    let removed = 0;
    for (const n of targets) {
      for (const suffix of [".json", ".session.json", ".draft.json", ".transcript.json"]) {
        if (await store.exists(`${n.id}${suffix}`)) {
          await store.remove(`${n.id}${suffix}`);
          removed++;
        }
      }
    }
    return jsonRes({ ok: true, removed });
  }

  if (path === "/api/profiles") {
    if (method === "POST") {
      const name = String(body.name ?? "").trim();
      if (!name) return jsonRes({ error: "name required" }, 400);
      return jsonRes(await createProfile(name));
    }
    return jsonRes({ profiles: await listProfiles() });
  }

  if (path.startsWith("/api/playbook/")) {
    const pb = playbooks(idOf("/api/playbook/"));
    if (!pb) return jsonRes({ planned: true }, 404);
    return jsonRes({
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
      const transcript = await store.read(`${id}.transcript.json`);
      if (transcript !== null) {
        const exchange = JSON.parse(transcript) as ExchangeEntry[];
        const answers = reconstructManualAnswers(playbooks(id), exchange);
        return jsonRes({ exchange, settled: true, ...(answers ? { manual_answers: answers } : {}) });
      }
      return jsonRes({ error: "no session" }, 404);
    }
    return new Response(session, { status: 200, headers: { "content-type": "application/json" } });
  }

  if (path.startsWith("/api/artifact/")) {
    const art = await store.read(`${idOf("/api/artifact/")}.json`);
    if (art === null) return jsonRes({ error: "no artifact" }, 404);
    return new Response(art, { status: 200, headers: { "content-type": "application/json" } });
  }

  if (path.startsWith("/api/upstream/")) {
    const pb = playbooks(idOf("/api/upstream/"));
    if (!pb) return jsonRes({ error: "no playbook" }, 404);
    return jsonRes({ upstream: await loadUpstream(pb, silentIO, store) });
  }

  if (path.startsWith("/api/draft/")) {
    const id = idOf("/api/draft/");
    const pb = playbooks(id);
    if (!pb) return jsonRes({ error: "no playbook" }, 404);
    const draftPath = `${id}.draft.json`;
    if (method === "PUT") {
      const content = (body.content ?? {}) as Record<string, unknown>;
      await store.write(draftPath, JSON.stringify(
        { content, origin: body.origin ?? null, saved_at: new Date().toISOString() }, null, 2,
      ));
      const source = await verbatimSource(pb, store, await loadUpstream(pb, silentIO, store));
      return jsonRes({ ok: true, warnings: manualWarnings(pb, content, source) });
    }
    if (method === "DELETE") {
      await store.remove(draftPath);
      return jsonRes({ ok: true });
    }
    const draft = await store.read(draftPath);
    if (draft === null) return jsonRes({ error: "no draft" }, 404);
    return new Response(draft, { status: 200, headers: { "content-type": "application/json" } });
  }

  if (path.startsWith("/api/authorize/") && method === "POST") {
    const id = idOf("/api/authorize/");
    const pb = playbooks(id);
    if (!pb) return jsonRes({ error: "no playbook" }, 404);
    const content = body.content as Record<string, unknown> | undefined;
    if (!content || typeof content !== "object") return jsonRes({ error: "content required" }, 400);
    const origin = ["manual", "generated", "mixed"].includes(String(body.origin))
      ? (body.origin as Artifact["origin"]) : "manual";
    const upstream = await loadUpstream(pb, silentIO, store);
    const warnings = manualWarnings(pb, content, await verbatimSource(pb, store, upstream));
    const exchange = await loadExchange(id, store);
    await saveArtifact(pb, content, exchange, store, origin);
    await store.remove(`${id}.draft.json`);
    await store.remove(`${id}.session.json`);
    return jsonRes({ ok: true, warnings });
  }

  if (path.startsWith("/api/compose/") && method === "POST") {
    const id = idOf("/api/compose/");
    const pb = playbooks(id);
    if (!pb) return jsonRes({ error: "no playbook" }, 404);
    if (!aiAvailable()) return jsonRes({ error: "no model configured — add a key in settings" }, 503);
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
    return jsonRes({ content, candidates: field ? candidates : [], warnings: _verbatim_warnings });
  }

  if (path.startsWith("/api/manual-session/") && method === "PUT") {
    const id = idOf("/api/manual-session/");
    const pb = playbooks(id);
    if (!pb?.elicit) return jsonRes({ error: "not a conversation playbook" }, 404);
    const answers = (body.answers ?? {}) as Record<string, string>;
    const sessPath = `${id}.session.json`;
    const existing = await store.read(sessPath);
    if (existing !== null) {
      const saved = JSON.parse(existing) as { manual_answers?: unknown };
      if (!saved.manual_answers) return jsonRes({ error: "an interviewer-led session exists for this step" }, 409);
    }
    const built = buildManualSession(pb, answers, lang);
    if (!built) {
      await store.remove(sessPath);
      return jsonRes({ ok: true, cleared: true });
    }
    await store.write(sessPath, JSON.stringify(built, null, 2));
    return jsonRes({ ok: true });
  }

  return jsonRes({ error: "not found" }, 404);
}

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!urlStr.startsWith("/api/")) return realFetch(input as RequestInfo, init);
  await ready;
  const url = new URL(urlStr, "http://app.local");
  const method = init?.method ?? "GET";
  let body: Record<string, unknown> = {};
  if (typeof init?.body === "string" && init.body) {
    try { body = JSON.parse(init.body) as Record<string, unknown>; } catch { return jsonRes({ error: "bad json body" }, 400); }
  }
  try {
    return await handleApi(url, method, body);
  } catch (err) {
    return jsonRes({ error: (err as Error).message }, 500);
  }
}) as typeof window.fetch;

/* ── /ws as an in-page session, /ws/voice direct to OpenAI ── */

interface ShimSocket {
  readyState: number;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
}

function makeSessionWS(urlStr: string): ShimSocket {
  const url = new URL(urlStr.replace(/^ws/, "http"));
  const id = url.searchParams.get("playbook") ?? "";
  const pb = playbooks(id);
  let open = true;
  const pendingAsks: ((s: string) => void)[] = [];
  const pendingReviews: ((a: ReviewAction) => void)[] = [];

  const sock: ShimSocket = {
    readyState: 1,
    onmessage: null,
    onclose: null,
    send(data) {
      const msg = JSON.parse(String(data)) as { type: string; text?: string; action?: string; value?: string };
      if (msg.type === "answer") pendingAsks.shift()?.(msg.text ?? "");
      else if (msg.type === "review_action") {
        const act: ReviewAction =
          msg.action === "feedback"
            ? { action: "feedback", text: msg.text ?? "" }
            : msg.action === "reprocess"
              ? { action: "reprocess" }
              : { action: "authorize", value: msg.value };
        pendingReviews.shift()?.(act);
      }
    },
    close() {
      open = false;
      sock.readyState = 3;
    },
  };
  const emit = (payload: Record<string, unknown>): void => {
    if (open) sock.onmessage?.({ data: JSON.stringify(payload) });
  };
  const finish = (): void => {
    if (!open) return;
    sock.readyState = 3;
    open = false;
    sock.onclose?.();
  };

  setTimeout(() => {
    void (async () => {
      await ready;
      if (!pb) {
        emit({ type: "error", text: "unknown playbook" });
        return finish();
      }
      if (!aiAvailable()) {
        emit({ type: "error", text: "no model configured — add a key in settings, or use practitioner mode" });
        return finish();
      }
      const store = scoped(rootStore, profilePrefix(url.searchParams.get("profile")));
      const lang = SESSION_LANGS[url.searchParams.get("lang") ?? ""];
      const io: SessionIO = {
        say: (t) => emit({ type: "say", text: t }),
        sayAnchor: (t) => emit({ type: "say", text: t, anchor: true }),
        note: (t) => emit({ type: "note", text: t }),
        ask: (prompt) => new Promise((resolve) => {
          pendingAsks.push(resolve);
          emit({ type: "ask", text: prompt });
        }),
        review: (payload) => new Promise((resolve) => {
          pendingReviews.push(resolve);
          emit({ type: "review", payload });
        }),
      };
      try {
        const outcome = url.searchParams.get("mode") === "review"
          ? await runReviewSession(pb, getLlm(), io, { lang, store })
          : await runPlaybookSession(pb, getLlm(), io, {
              header: false, lang, store, autoResume: url.searchParams.get("resume") === "1",
            });
        emit({ type: "done", text: outcome });
      } catch (err) {
        emit({ type: "error", text: (err as Error).message });
      }
      finish();
    })();
  }, 0);
  return sock;
}

function makeVoiceWS(urlStr: string): ShimSocket {
  const key = cfg("OPENAI_API_KEY") ?? "";
  const langCode = new URL(urlStr.replace(/^ws/, "http")).searchParams.get("lang") ?? "";
  const sock: ShimSocket = {
    readyState: 0, onmessage: null, onclose: null,
    send() {}, close() {},
  };
  const emit = (payload: Record<string, unknown>): void => {
    sock.onmessage?.({ data: JSON.stringify(payload) });
  };
  if (!key) {
    setTimeout(() => {
      emit({ type: "error", text: "no OpenAI key configured — add it in settings" });
      sock.onclose?.();
    }, 0);
    return sock;
  }
  // Browser WebSockets cannot set headers; OpenAI accepts the key as a
  // subprotocol. It is the user's own on-device key talking straight to
  // OpenAI — no middleman.
  const upstream = new RealWebSocket(
    "wss://api.openai.com/v1/realtime?intent=transcription",
    ["realtime", `openai-insecure-api-key.${key}`],
  );
  let audioSent = false;
  upstream.onopen = () => {
    sock.readyState = 1;
    upstream.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: "gpt-realtime-whisper", ...(langCode ? { language: langCode } : {}) },
            turn_detection: null,
            noise_reduction: { type: "near_field" },
          },
        },
      },
    }));
  };
  upstream.onmessage = (ev) => {
    let msg: { type?: string; delta?: string; transcript?: string; item_id?: string; error?: { message?: string } };
    try { msg = JSON.parse(String(ev.data)) as typeof msg; } catch { return; }
    if (msg.type === "session.created") emit({ type: "ready" });
    else if (msg.type === "conversation.item.input_audio_transcription.delta") {
      emit({ type: "delta", item: msg.item_id, text: msg.delta ?? "" });
    } else if (msg.type === "conversation.item.input_audio_transcription.completed") {
      emit({ type: "final", item: msg.item_id, text: msg.transcript ?? "" });
      upstream.close();
    } else if (msg.type === "error") emit({ type: "error", text: msg.error?.message ?? "transcription error" });
  };
  upstream.onclose = () => {
    sock.readyState = 3;
    sock.onclose?.();
  };
  upstream.onerror = () => emit({ type: "error", text: "voice connection failed" });
  sock.send = (data) => {
    if (upstream.readyState !== RealWebSocket.OPEN) return;
    if (typeof data === "string") {
      try {
        const msg = JSON.parse(data) as { type?: string };
        if (msg.type === "stop") {
          if (audioSent) upstream.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          else upstream.close();
        }
      } catch { /* ignore */ }
      return;
    }
    audioSent = true;
    const bytes = new Uint8Array(data);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    upstream.send(JSON.stringify({ type: "input_audio_buffer.append", audio: btoa(bin) }));
  };
  sock.close = () => upstream.close();
  return sock;
}

const RealWebSocket = window.WebSocket;
const WSShim = function (this: unknown, url: string, protocols?: string | string[]) {
  if (url.includes("/ws/voice")) return makeVoiceWS(url);
  if (url.includes("/ws?")) return makeSessionWS(url);
  return new RealWebSocket(url, protocols);
} as unknown as typeof WebSocket;
(WSShim as unknown as Record<string, number>).CONNECTING = 0;
(WSShim as unknown as Record<string, number>).OPEN = 1;
(WSShim as unknown as Record<string, number>).CLOSING = 2;
(WSShim as unknown as Record<string, number>).CLOSED = 3;
window.WebSocket = WSShim;

/* ── settings: keys live on the device, nowhere else ───── */

function injectSettings(): void {
  const gear = document.createElement("button");
  gear.id = "ccGear";
  gear.textContent = "⚙";
  gear.style.cssText =
    "position:fixed;bottom:14px;right:14px;z-index:70;width:40px;height:40px;border-radius:99px;" +
    "border:1px solid rgba(128,116,98,.4);background:rgba(255,255,255,.85);font-size:18px;cursor:pointer;";
  const panel = document.createElement("div");
  panel.id = "ccSettingsPanel";
  panel.hidden = true;
  panel.style.cssText =
    "position:fixed;bottom:62px;right:14px;z-index:70;width:min(320px,88vw);padding:14px;border-radius:14px;" +
    "border:1px solid rgba(128,116,98,.4);background:#fffdf9;box-shadow:0 8px 30px rgba(61,54,45,.25);" +
    "font:13px Karla,sans-serif;color:#3c352b;display:flex;flex-direction:column;gap:8px;";
  const field = (id: string, label: string, type = "password"): string =>
    `<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#8a7f6e">${label}` +
    `<input id="${id}" type="${type}" autocomplete="off" style="padding:8px;border:1px solid #d8d0c2;border-radius:8px;font-size:13px"/></label>`;
  panel.innerHTML =
    `<div style="font-weight:600">Keys stay on this device</div>` +
    field("ccKeyLlm", "OpenRouter API key (AI interviewer)") +
    field("ccKeyVoice", "OpenAI API key (voice dictation, optional)") +
    field("ccInvite", "Invite code (get a free key)", "text") +
    `<button id="ccRedeem" style="padding:8px;border-radius:8px;border:1px solid #d8d0c2;background:none;cursor:pointer">Redeem invite</button>` +
    `<button id="ccSave" style="padding:9px;border-radius:8px;border:none;background:#6f8265;color:#fff;font-weight:600;cursor:pointer">Save & reload</button>` +
    `<div id="ccSettingsNote" style="font-size:11px;color:#8a7f6e"></div>`;
  document.body.append(gear, panel);

  const $ = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
  gear.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      $("ccKeyLlm").value = cfg("LLM_API_KEY") ?? "";
      $("ccKeyVoice").value = cfg("OPENAI_API_KEY") ?? "";
    }
  });
  (document.getElementById("ccSave") as HTMLButtonElement).addEventListener("click", () => {
    void (async () => {
      await Preferences.set({ key: "LLM_API_KEY", value: $("ccKeyLlm").value.trim() });
      await Preferences.set({ key: "OPENAI_API_KEY", value: $("ccKeyVoice").value.trim() });
      location.reload();
    })();
  });
  (document.getElementById("ccRedeem") as HTMLButtonElement).addEventListener("click", () => {
    void (async () => {
      const note = document.getElementById("ccSettingsNote") as HTMLElement;
      const vendor = cfg("VENDOR_URL") ?? "";
      const code = $("ccInvite").value.trim();
      if (!vendor) { note.textContent = "No key service configured in this build."; return; }
      if (!code) { note.textContent = "Enter your invite code first."; return; }
      note.textContent = "Redeeming…";
      try {
        const res = await realFetch(`${vendor}/redeem`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = (await res.json()) as { key?: string; error?: string };
        if (!res.ok || !data.key) throw new Error(data.error ?? `${res.status}`);
        await Preferences.set({ key: "LLM_API_KEY", value: data.key });
        note.textContent = "Key installed — reloading…";
        setTimeout(() => location.reload(), 700);
      } catch (err) {
        note.textContent = `Could not redeem: ${(err as Error).message}`;
      }
    })();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  injectSettings();
  // No print dialogs inside native WebViews — hide the PDF export there.
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (capacitor?.isNativePlatform?.()) {
    const style = document.createElement("style");
    style.textContent = "#exportBtn { display: none; }";
    document.head.append(style);
  }
});
