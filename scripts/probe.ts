/**
 * OpenRouter privacy probe: for each configured tier model, prints every
 * endpoint's price, quantization, and data policy, then fires one live
 * ZDR-enforced completion per tier and reports which provider actually served
 * it. Run after putting LLM_PROVIDER=openrouter + LLM_API_KEY in .env:
 *   npm run probe
 */
const BASE = "https://openrouter.ai/api/v1";
const KEY = process.env.LLM_API_KEY ?? "";
if (!KEY) {
  console.error("Set LLM_API_KEY (your OpenRouter key) in .env first.");
  process.exit(1);
}

const MODELS: Record<string, string> = {
  small: process.env.LLM_SMALL_MODEL ?? "deepseek/deepseek-v4-flash",
  large: process.env.LLM_LARGE_MODEL ?? "deepseek/deepseek-v4-pro",
};

const perM = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `$${(n * 1e6).toFixed(2)}/M` : "?";
};

interface Endpoint {
  provider_name?: string;
  name?: string;
  quantization?: string | null;
  pricing?: { prompt?: string; completion?: string };
  data_policy?: Record<string, unknown>;
}

async function listEndpoints(model: string): Promise<void> {
  const res = await fetch(`${BASE}/models/${model}/endpoints`, {
    headers: { authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) {
    console.log(`  endpoints query failed: ${res.status}`);
    return;
  }
  const data = (await res.json()) as { data?: { endpoints?: Endpoint[] } };
  for (const ep of data.data?.endpoints ?? []) {
    const dp = ep.data_policy ?? {};
    const flags = Object.entries(dp)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ");
    console.log(
      `  ${(ep.provider_name ?? ep.name ?? "?").padEnd(16)} in ${perM(ep.pricing?.prompt).padEnd(9)} out ${perM(ep.pricing?.completion).padEnd(9)} quant ${String(ep.quantization ?? "?").padEnd(8)} ${flags}`,
    );
  }
}

async function liveZdrCall(tier: string, model: string): Promise<void> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      zdr: true,
      provider: { data_collection: "deny" },
      max_tokens: 200,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
    }),
  });
  const data = (await res.json()) as {
    provider?: string;
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok || data.error) {
    console.log(`  ${tier}: ZDR call FAILED — ${data.error?.message ?? res.status}`);
    return;
  }
  console.log(`  ${tier}: served by ${data.provider ?? "?"} → "${data.choices?.[0]?.message?.content?.trim()}"`);
}

async function schemaCall(model: string): Promise<void> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      zdr: true,
      provider: { data_collection: "deny", require_parameters: true },
      max_tokens: 300,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "artifact",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["motto", "mood"],
            properties: { motto: { type: "string" }, mood: { type: "string" } },
          },
        },
      },
      messages: [{ role: "user", content: 'The user said: "Slow is smooth and smooth is fast. Feeling calm." Extract their motto and mood.' }],
    }),
  });
  const data = (await res.json()) as {
    provider?: string;
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok || data.error) {
    console.log(`  structured output: FAILED — ${data.error?.message ?? res.status}`);
    return;
  }
  const raw = data.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(raw.replace(/^```(json)?\n?|\n?```$/g, "")) as Record<string, unknown>;
    console.log(`  structured output: OK via ${data.provider ?? "?"} → ${JSON.stringify(parsed)}`);
  } catch {
    console.log(`  structured output: NOT valid JSON via ${data.provider ?? "?"} → ${raw.slice(0, 120)}`);
  }
}

for (const [tier, model] of Object.entries(MODELS)) {
  console.log(`\n━━━ ${tier}: ${model} — endpoint policies ━━━`);
  await listEndpoints(model);
}
console.log("\n━━━ live ZDR-enforced calls ━━━");
for (const [tier, model] of Object.entries(MODELS)) await liveZdrCall(tier, model);
console.log("\n━━━ structured output under ZDR (small tier) ━━━");
await schemaCall(MODELS.small);
