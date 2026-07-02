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
