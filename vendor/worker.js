/**
 * Key vendor as a Cloudflare Worker — same contract as src/vendor.ts, hosted
 * free and always-on. Invite codes come from the INVITES var (comma-separated);
 * the ledger lives in KV, so each code redeems exactly once. No counseling
 * content ever passes through here — only invite codes and minted keys.
 *
 * Deploy (once, ~5 minutes):
 *   1. npx wrangler login
 *   2. npx wrangler kv namespace create LEDGER
 *      → paste the returned id into wrangler.toml
 *   3. npx wrangler secret put OPENROUTER_MANAGEMENT_KEY
 *      → paste the management key from OpenRouter → Settings → Provisioning
 *   4. Edit INVITES in wrangler.toml (your comma-separated codes)
 *   5. npx wrangler deploy
 *      → https://cc-key-vendor.<your-account>.workers.dev
 *   6. Rebuild the app with the endpoint baked in:
 *      VENDOR_URL=https://cc-key-vendor.<account>.workers.dev bash scripts/run-ios-sim.sh
 *
 * Update invites later: edit wrangler.toml and `npx wrangler deploy` again
 * (or change the var in the Cloudflare dashboard — no redeploy needed).
 */
export default {
  async fetch(req, env) {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const path = new URL(req.url).pathname;

    if (path === "/health") return json({ ok: true, cap_usd: Number(env.CAP_USD ?? 2) });

    if (path === "/redeem" && req.method === "POST") {
      // Naive per-IP throttle: 5 attempts per hour.
      const ip = req.headers.get("cf-connecting-ip") ?? "?";
      const attempts = Number((await env.LEDGER.get(`rl:${ip}`)) ?? 0);
      if (attempts >= 5) return json({ error: "too many attempts — try later" }, 429);
      await env.LEDGER.put(`rl:${ip}`, String(attempts + 1), { expirationTtl: 3600 });

      let code = "";
      try {
        code = String((await req.json()).code ?? "").trim();
      } catch {
        return json({ error: "bad json body" }, 400);
      }
      const invites = (env.INVITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!code || !invites.includes(code)) return json({ error: "unknown invite code" }, 404);
      if (await env.LEDGER.get(`code:${code}`)) return json({ error: "invite already redeemed" }, 409);

      const res = await fetch("https://openrouter.ai/api/v1/keys", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.OPENROUTER_MANAGEMENT_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: `cc-invite-${code}`, limit: Number(env.CAP_USD ?? 2) }),
      });
      const data = await res.json();
      if (!res.ok || !data.key) {
        return json({ error: data?.error?.message ?? `provisioning failed (${res.status})` }, 502);
      }
      await env.LEDGER.put(
        `code:${code}`,
        JSON.stringify({ key_hash: data.data?.hash ?? "unknown", minted_at: new Date().toISOString() }),
      );
      return json({ key: data.key });
    }

    return json({ error: "not found" }, 404);
  },
};
