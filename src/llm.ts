import Anthropic from "@anthropic-ai/sdk";
import type { ChatTurn, Tier } from "./types.js";

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

export function createAdapter(): LlmAdapter {
  return process.env.LLM_PROVIDER === "ollama" ? new OllamaAdapter() : new AnthropicAdapter();
}
