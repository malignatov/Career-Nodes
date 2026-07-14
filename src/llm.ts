import Anthropic from "@anthropic-ai/sdk";
import type { ChatTurn, Tier } from "./types.ts";

export interface CompleteOptions {
  system: string;
  messages: ChatTurn[];
  tier: Tier;
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
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

export class AnthropicAdapter implements LlmAdapter {
  private client = new Anthropic();
  private models: Record<Tier, string> = {
    small: process.env.LLM_SMALL_MODEL ?? "claude-haiku-4-5",
    large: process.env.LLM_LARGE_MODEL ?? "claude-opus-4-8",
  };

  describe(): string {
    return `anthropic (small=${this.models.small}, large=${this.models.large})`;
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const response = await this.client.messages.create({
      model: this.models[opts.tier],
      max_tokens: opts.maxTokens ?? (opts.jsonSchema ? 4096 : 1024),
      system: opts.system,
      messages: opts.messages,
      ...(opts.jsonSchema
        ? {
            output_config: {
              format: {
                type: "json_schema" as const,
                schema: sanitizeSchema(opts.jsonSchema),
              },
            },
          }
        : {}),
    });
    const text = response.content.find((b) => b.type === "text");
    return text?.text ?? "";
  }
}

export class OllamaAdapter implements LlmAdapter {
  private baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  private models: Record<Tier, string> = {
    small: process.env.LLM_SMALL_MODEL ?? "llama3.1:8b",
    large: process.env.LLM_LARGE_MODEL ?? "llama3.1:8b",
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
    return this.provider === "openrouter" && process.env.LLM_ZDR !== "0";
  }

  private tier(t: Tier): TierEndpoint {
    const U = t === "small" ? "SMALL" : "LARGE";
    const defaults: Record<Tier, string> = {
      small: this.provider === "openrouter" ? "deepseek/deepseek-v4-flash" : "",
      large: this.provider === "openrouter" ? "deepseek/deepseek-v4-pro" : "",
    };
    const baseUrl =
      process.env[`LLM_${U}_BASE_URL`] ?? process.env.LLM_BASE_URL ??
      (this.provider === "openrouter" ? OPENROUTER_BASE : "");
    const apiKey = process.env[`LLM_${U}_API_KEY`] ?? process.env.LLM_API_KEY ?? "";
    const model = process.env[`LLM_${U}_MODEL`] ?? defaults[t];
    if (!baseUrl || !model) throw new Error(`LLM ${t} tier is not configured (base url / model)`);
    return { baseUrl, apiKey, model };
  }

  describe(): string {
    const s = this.tier("small");
    const l = this.tier("large");
    const zdr = this.zdr ? ", zdr=on" : "";
    return `${this.provider} (small=${s.model}, large=${l.model}${zdr})`;
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const cfg = this.tier(opts.tier);
    const body: Record<string, unknown> = {
      model: cfg.model,
      max_tokens: opts.maxTokens ?? (opts.jsonSchema ? 4096 : 1024),
      messages: [{ role: "system", content: opts.system }, ...opts.messages],
    };
    if (opts.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "artifact", strict: true, schema: sanitizeSchema(opts.jsonSchema) },
      };
    }
    if (cfg.baseUrl.startsWith(OPENROUTER_BASE)) {
      if (this.zdr) body.zdr = true;
      // Cheapest endpoint that satisfies the constraints wins.
      const provider: Record<string, unknown> = { sort: "price" };
      if (this.zdr) provider.data_collection = "deny";
      // Only route to endpoints that actually honor response_format.
      if (opts.jsonSchema) provider.require_parameters = true;
      // ZDR says "won't store"; jurisdiction is a separate axis — hosts the
      // user won't send client words to, regardless of retention contracts.
      const ignore = (process.env.LLM_IGNORE_PROVIDERS ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      if (ignore.length > 0) provider.ignore = ignore;
      body.provider = provider;
    }
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
        "x-title": "Career Counseling",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }
}

export function createAdapter(): LlmAdapter {
  const p = process.env.LLM_PROVIDER ?? "anthropic";
  if (p === "ollama") return new OllamaAdapter();
  if (p === "openrouter" || p === "openai") return new OpenAICompatAdapter(p);
  return new AnthropicAdapter();
}

/** Whether the configured provider has what it needs to serve calls. */
export function aiAvailable(): boolean {
  const p = process.env.LLM_PROVIDER ?? "anthropic";
  if (p === "ollama") return true;
  if (p === "openrouter" || p === "openai") {
    return Boolean(process.env.LLM_API_KEY || process.env.LLM_SMALL_API_KEY || process.env.LLM_LARGE_API_KEY);
  }
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
