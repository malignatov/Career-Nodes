import Anthropic from "@anthropic-ai/sdk";
import type { ChatTurn, Tier } from "./types.ts";
import {
  OllamaAdapter, OpenAICompatAdapter, sanitizeSchema, type CompleteOptions, type LlmAdapter,
} from "./llm.ts";

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
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
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


export function createAdapter(): LlmAdapter {
  const p = process.env.LLM_PROVIDER ?? "anthropic";
  if (p === "ollama") return new OllamaAdapter();
  if (p === "openrouter" || p === "openai") return new OpenAICompatAdapter(p);
  return new AnthropicAdapter();
}
