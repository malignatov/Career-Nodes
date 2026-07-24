import type { ChatTurn, Tier } from "./types.ts";
import { cfg } from "./config.ts";

export interface CompleteOptions {
  system: string;
  messages: ChatTurn[];
  tier: Tier;
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmAdapter {
  complete(opts: CompleteOptions): Promise<string>;
  describe(): string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Structured-output endpoints reject x-* extension keys and some constraints.
 * The full schema (with x-verbatim, minItems, …) is still enforced by the
 * engine in code; this strips it down to what the API accepts.
 */
export function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const dropped = new Set([
    "minItems", "maxItems", "minLength", "maxLength",
    "minimum", "maximum", "multipleOf",
  ]);

  function walk(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(walk);
    if (!isRecord(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("x-") || dropped.has(key)) continue;
      out[key] = walk(value);
    }
    if (out.type === "object" && isRecord(out.properties)) {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties);
    }
    return out;
  }

  return walk(schema) as Record<string, unknown>;
}

export class OllamaAdapter implements LlmAdapter {
  private baseUrl = cfg("OLLAMA_BASE_URL") ?? "http://localhost:11434";
  private models: Record<Tier, string> = {
    small: cfg("LLM_SMALL_MODEL") ?? "llama3.1:8b",
    large: cfg("LLM_LARGE_MODEL") ?? "llama3.1:8b",
  };

  describe(): string {
    return `ollama at ${this.baseUrl} (small=${this.models.small}, large=${this.models.large})`;
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.models[opts.tier],
        stream: false,
        messages: [{ role: "system", content: opts.system }, ...opts.messages],
        ...(opts.jsonSchema ? { format: sanitizeSchema(opts.jsonSchema) } : {}),
        ...(opts.temperature !== undefined ? { options: { temperature: opts.temperature } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? "";
  }
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

interface TierEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Any OpenAI-compatible Chat Completions endpoint. Each tier can point at its
 * own base URL / key / model (e.g. fast tier direct at DeepInfra, smart tier
 * via OpenRouter), falling back to the shared LLM_BASE_URL / LLM_API_KEY.
 *
 * With LLM_PROVIDER=openrouter, requests are pinned to zero-data-retention
 * endpoints (`zdr: true` + data_collection "deny") unless LLM_ZDR=0 — the
 * privacy stance is on by default, opting out is the explicit act.
 */
export class OpenAICompatAdapter implements LlmAdapter {
  private provider: "openrouter" | "openai";

  constructor(provider: "openrouter" | "openai") {
    this.provider = provider;
  }

  private get zdr(): boolean {
    return this.provider === "openrouter" && cfg("LLM_ZDR") !== "0";
  }

  private tier(t: Tier): TierEndpoint {
    const U = t === "small" ? "SMALL" : "LARGE";
    const defaults: Record<Tier, string> = {
      small: this.provider === "openrouter" ? "deepseek/deepseek-v4-pro" : "",
      large: this.provider === "openrouter" ? "deepseek/deepseek-v4-pro" : "",
    };
    const baseUrl =
      cfg(`LLM_${U}_BASE_URL`) ?? cfg("LLM_BASE_URL") ??
      (this.provider === "openrouter" ? OPENROUTER_BASE : "");
    const apiKey = cfg(`LLM_${U}_API_KEY`) ?? cfg("LLM_API_KEY") ?? "";
    const model = cfg(`LLM_${U}_MODEL`) ?? defaults[t];
    if (!baseUrl || !model) throw new Error(`LLM ${t} tier is not configured (base url / model)`);
    return { baseUrl, apiKey, model };
  }

  /**
   * Reasoning effort per tier. OFF by default: the golden benchmark showed
   * reasoning does not help the compositions and mildly hurts verbatim
   * fidelity (off ≥ high ≥ max), at extra cost and latency — see
   * golden/report-claude-judge-reasoning-2026-07-18.md. Opt in per tier with
   * LLM_{SMALL,LARGE}_REASONING = low|medium|high|xhigh|max for experiments.
   */
  private reasoning(t: Tier): string | undefined {
    const U = t === "small" ? "SMALL" : "LARGE";
    const raw = (cfg(`LLM_${U}_REASONING`) ?? "").trim().toLowerCase();
    if (!raw || raw === "off" || raw === "none" || raw === "0") return undefined;
    return raw;
  }

  describe(): string {
    const s = this.tier("small");
    const l = this.tier("large");
    const zdr = this.zdr ? ", zdr=on" : "";
    const lr = this.reasoning("large");
    const reason = lr ? `, large-reasoning=${lr}` : "";
    return `${this.provider} (small=${s.model}, large=${l.model}${zdr}${reason})`;
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const ep = this.tier(opts.tier);
    const body: Record<string, unknown> = {
      model: ep.model,
      max_tokens: opts.maxTokens ?? (opts.jsonSchema ? 4096 : 1024),
      messages: [{ role: "system", content: opts.system }, ...opts.messages],
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    const effort = this.reasoning(opts.tier);
    if (effort) body.reasoning_effort = effort;
    if (opts.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "artifact", strict: true, schema: sanitizeSchema(opts.jsonSchema) },
      };
    }
    if (ep.baseUrl.startsWith(OPENROUTER_BASE)) {
      if (this.zdr) body.zdr = true;
      // Cache-aware affinity: a stable user id makes OpenRouter route repeat
      // traffic to the provider already holding the prefix cache (growing
      // interview transcripts re-send the whole prefix every turn). Opaque
      // constant, not PII; single-user desktop app, so one id covers all.
      body.user = cfg("LLM_STICKY_USER") ?? "career-counseling";
      // Reasoning-off must be EXPLICIT: providers default differently, and a
      // host that reasons by default (AtlasCloud, Jul '26) burns ~1k hidden
      // tokens per call — 20s turns — while the visible answer stays tiny.
      if (!effort) body.reasoning = { enabled: false };
      // Fastest endpoint that satisfies the constraints wins. Price sort is a
      // trap here: it ignores prompt-cache discounts and routes to whoever
      // undercuts the pool, even at single-digit tok/s (DigitalOcean, Jul '26).
      // Within the vetted allowlist the price spread is cents per Mtok, so
      // throughput is the better default; LLM_SORT=price restores the old
      // behavior if cost ever dominates.
      const provider: Record<string, unknown> = { sort: cfg("LLM_SORT") ?? "throughput" };
      if (this.zdr) provider.data_collection = "deny";
      // Only route to endpoints that actually honor response_format.
      if (opts.jsonSchema) provider.require_parameters = true;
      // ZDR says "won't store"; jurisdiction is a separate axis — hosts the
      // user won't send client words to, regardless of retention contracts.
      // The allowlist fails CLOSED: providers added to the pool later get no
      // traffic until explicitly vetted. The ignore-list remains as a
      // secondary tool when no allowlist is set.
      const allow = (cfg("LLM_ALLOW_PROVIDERS") ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      if (allow.length > 0) {
        provider.only = allow;
      } else {
        const ignore = (cfg("LLM_IGNORE_PROVIDERS") ?? "")
          .split(",").map((s) => s.trim()).filter(Boolean);
        if (ignore.length > 0) provider.ignore = ignore;
      }
      body.provider = provider;
    }
    const res = await fetch(`${ep.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ep.apiKey}`,
        "x-title": "Career Counseling",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }
}


/** Whether the configured provider has what it needs to serve calls. */
export function aiAvailable(): boolean {
  const p = cfg("LLM_PROVIDER") ?? "anthropic";
  if (p === "ollama") return true;
  if (p === "openrouter" || p === "openai") {
    return Boolean(cfg("LLM_API_KEY") || cfg("LLM_SMALL_API_KEY") || cfg("LLM_LARGE_API_KEY"));
  }
  return Boolean(cfg("ANTHROPIC_API_KEY"));
}
