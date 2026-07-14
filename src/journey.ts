/**
 * Journey state, computed from storage: node lifecycle statuses, staleness,
 * card summaries. Pure core — runs against any Storage and any source of
 * playbooks (fs on desktop, a bundled JSON map on mobile).
 */
import { MAP_NODES, MAP_EDGES, MAP_SECTORS } from "./map.ts";
import type { Artifact, Playbook } from "./types.ts";
import type { Storage } from "./storage.ts";

/** Where playbooks come from is a host decision; lookups are cheap and sync. */
export type PlaybookSource = (id: string) => Playbook | null;

const PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/**
 * Each client profile is a subdirectory of the artifacts storage. The default
 * profile is the root itself, so journeys that predate profiles stay put.
 */
export function profilePrefix(profile?: string | null): string {
  if (!profile || profile === "default") return "";
  if (!PROFILE_RE.test(profile)) throw new Error(`bad profile id: ${profile}`);
  return `profiles/${profile}`;
}

export async function readArtifact(id: string, store: Storage): Promise<Artifact | null> {
  const raw = await store.read(`${id}.json`);
  return raw === null ? null : (JSON.parse(raw) as Artifact);
}

async function authorizedAt(id: string, store: Storage): Promise<number | null> {
  const art = await readArtifact(id, store);
  if (!art) return null;
  const ts = Date.parse(art.authorized_at);
  return Number.isNaN(ts) ? null : ts;
}

/**
 * Lifecycle status. "planned" covers both nodes without a playbook and nodes
 * whose dependencies aren't met yet: conversation nodes need every consumed
 * artifact; derived nodes need at least one (the engine tolerates partial
 * upstream, e.g. character sketch from role models alone).
 */
export async function nodeStatus(id: string, store: Storage, playbooks: PlaybookSource): Promise<string> {
  if (await store.exists(`${id}.json`)) {
    // Derived artifacts go stale when any source was authorized after them;
    // conversation artifacts never do — the user's recorded words stay valid.
    const pb = playbooks(id);
    if (pb?.kind === "derived") {
      const own = (await authorizedAt(id, store)) ?? 0;
      for (const dep of pb.consumes) {
        if (((await authorizedAt(dep, store)) ?? 0) > own) return "stale";
      }
    }
    return "authorized";
  }
  if (await store.exists(`${id}.session.json`)) return "in_progress";
  if (await store.exists(`${id}.draft.json`)) return "in_progress";
  const pb = playbooks(id);
  if (!pb) return "planned";
  if (pb.consumes.length > 0) {
    // The goal is context, not source material — it never gates derived nodes.
    const sources = pb.kind === "conversation" ? pb.consumes : pb.consumes.filter((d) => d !== "counseling_goal");
    const gate = pb.gate ?? (pb.kind === "conversation" ? "all" : "any");
    if (sources.length > 0) {
      let met = gate === "all";
      for (const s of sources) {
        const has = await store.exists(`${s}.json`);
        if (gate === "all" && !has) met = false;
        if (gate === "any" && has) met = true;
      }
      if (!met) return "planned";
    }
  }
  return "available";
}

function firstString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v;
  if (Array.isArray(v)) for (const item of v) { const s = firstString(item); if (s) return s; }
  if (typeof v === "object" && v !== null) {
    for (const val of Object.values(v)) { const s = firstString(val); if (s) return s; }
  }
  return null;
}

export interface DistilledPart {
  label: string | null;
  text: string;
}

/** Structured summary of an authorized artifact for its journey card — full text, no truncation. */
export function distill(id: string, content: Record<string, unknown>): DistilledPart[] {
  const one = (text: unknown, label: string | null = null): DistilledPart[] =>
    typeof text === "string" && text.trim() ? [{ label, text }] : [];

  switch (id) {
    case "counseling_goal": return one(content.restated_goal);
    case "motto": return one(content.motto ? `“${content.motto as string}”` : null);
    case "role_models": {
      const models = (content.models ?? []) as { name?: string }[];
      return one(models.map((m) => m.name).filter(Boolean).join(" · "));
    }
    case "favorite_story": return one(content.title);
    case "favorite_media": {
      const media = (content.media ?? []) as { title?: string }[];
      return one(media.map((m) => m.title).filter(Boolean).join(" · "));
    }
    case "early_recollections": {
      const recs = (content.recollections ?? []) as { headline?: string }[];
      return one(recs.map((r) => r.headline).filter(Boolean).map((h) => `“${h}”`).join(" · "));
    }
    case "character_sketch": return one(content.sketch);
    case "perspective": return one(content.perspective_statement);
    case "preferred_settings": return one(content.niche_statement);
    case "script": return one(content.script_statement);
    case "advice_to_self": return one(content.call_to_action);
    case "life_portrait": {
      const movements = (content.movements ?? []) as { title?: string; text?: string }[];
      const parts = movements
        .filter((m) => typeof m.text === "string" && m.text.trim())
        .map((m) => ({ label: m.title ?? null, text: m.text as string }));
      return parts.length > 0 ? parts : one(content.full_portrait);
    }
    case "identity_statement": return one(content.statement);
    case "action_recipe": {
      const week = (content.week_one ?? []) as string[];
      return one(week.map((w) => `• ${w}`).join("\n"));
    }
    case "closing_check": return one(((content.whats_different ?? []) as string[]).join(" · "));
    default: return one(firstString(content));
  }
}

export async function buildJourney(
  store: Storage,
  playbooks: PlaybookSource,
  caps: { ai: boolean; voice: boolean },
): Promise<unknown> {
  let authorized = 0;
  const nodes = [];
  for (const n of MAP_NODES) {
    const status = await nodeStatus(n.id, store, playbooks);
    // The playbook is the source of truth for the node kind — the map entry
    // is only a fallback for planned nodes without a playbook yet.
    const pb = playbooks(n.id);
    const kind = pb ? (pb.elicit ? "conversation" : "derived") : n.kind;
    if (status === "authorized") authorized++;
    let distilled: DistilledPart[] = [];
    let origin: string | null = null;
    if (status === "authorized" || status === "stale") {
      const art = await readArtifact(n.id, store);
      if (art) {
        distilled = distill(n.id, art.content);
        origin = art.origin ?? "generated";
      }
    }
    nodes.push({
      ...n,
      kind,
      status,
      distilled,
      origin,
      feeds: n.id === "counseling_goal" ? [] : MAP_EDGES.filter(([from]) => from === n.id).map(([, to]) => to),
      uses: n.id === "counseling_goal"
        ? []
        : MAP_EDGES.filter(([, to]) => to === n.id).map(([from]) => from).filter((f) => f !== "counseling_goal"),
    });
  }
  return { sectors: MAP_SECTORS, nodes, authorized, total: MAP_NODES.length, ai: caps.ai, voice: caps.voice };
}
