export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Walks an induced value alongside its schema and collects every string marked x-verbatim. */
export function gatherMarked(value: unknown, schema: Record<string, unknown>): string[] {
  const found: string[] = [];
  function walk(v: unknown, s: unknown): void {
    if (!isRecord(s)) return;
    if (s["x-verbatim"] === true && typeof v === "string") {
      found.push(v);
      return;
    }
    if (Array.isArray(v) && isRecord(s.items)) {
      for (const item of v) walk(item, s.items);
      return;
    }
    if (isRecord(v) && isRecord(s.properties)) {
      for (const [key, propSchema] of Object.entries(s.properties)) {
        if (key in v) walk(v[key], propSchema);
      }
    }
  }
  walk(value, schema);
  return found;
}

/**
 * Walks an induced value alongside its schema and returns every string that is
 * marked `x-verbatim: true` but does not appear (normalized) in the user's words.
 */
export function verbatimViolations(
  value: unknown,
  schema: Record<string, unknown>,
  userWords: string,
): string[] {
  const haystack = normalize(userWords);
  const violations: string[] = [];

  function walk(v: unknown, s: unknown): void {
    if (!isRecord(s)) return;
    if (s["x-verbatim"] === true && typeof v === "string") {
      if (!haystack.includes(normalize(v))) violations.push(v);
      return;
    }
    if (Array.isArray(v) && isRecord(s.items)) {
      for (const item of v) walk(item, s.items);
      return;
    }
    if (isRecord(v) && isRecord(s.properties)) {
      for (const [key, propSchema] of Object.entries(s.properties)) {
        if (key in v) walk(v[key], propSchema);
      }
    }
  }

  walk(value, schema);
  return violations;
}

/**
 * Words the client said about ONE thing must not be attributed to another.
 * A schema marks a field `x-own: true` inside a list of entities; every value
 * there belongs to the entity that holds it, and to no sibling.
 *
 * Verbatim checking cannot see this: a comparison lifted from the first role
 * model onto the third IS the client's own sentence, word for word — it is
 * simply about someone else. So the CODE compares siblings and reports what
 * was shared, the way it counts entities for the checker.
 */
export function borrowedAcrossEntities(value: unknown, schema: Record<string, unknown>): string[] {
  const shared = new Set<string>();
  function walk(v: unknown, s: unknown): void {
    if (!isRecord(s)) return;
    if (Array.isArray(v) && isRecord(s.items)) {
      // A list of entities: collect each sibling's own values, then compare.
      // Comparison folds case and quotes the way verbatim does; what comes
      // back is the draft's own wording, so the review can match it to the
      // line on screen. Every copy is flagged — the code cannot know which
      // entity the client actually said it about.
      const holders = new Map<string, string[]>();
      for (const item of v) {
        for (const raw of new Set(ownValues(item, s.items))) {
          const key = normalize(raw);
          const seen = holders.get(key) ?? [];
          seen.push(raw);
          holders.set(key, seen);
        }
      }
      for (const raws of holders.values()) {
        if (raws.length > 1) for (const raw of raws) shared.add(raw);
      }
      for (const item of v) walk(item, s.items);
      return;
    }
    if (isRecord(v) && isRecord(s.properties)) {
      for (const [key, propSchema] of Object.entries(s.properties)) {
        if (key in v) walk(v[key], propSchema);
      }
    }
  }
  walk(value, schema);
  return [...shared];
}

/** Every `x-own` string held by one entity (its own words, not a sibling's). */
function ownValues(entity: unknown, schema: unknown): string[] {
  const out: string[] = [];
  if (!isRecord(schema) || !isRecord(entity) || !isRecord(schema.properties)) return out;
  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (!isRecord(propSchema) || propSchema["x-own"] !== true) continue;
    const v = entity[key];
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const item of v) if (typeof item === "string") out.push(item);
  }
  return out;
}
