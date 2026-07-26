/**
 * Editing a settled artifact by named operations instead of rewriting it.
 *
 * An amend is a small, specific change — split this line, drop that guide,
 * fix a name. Handing the whole object back to the composer to regenerate
 * asks it to redo the entire extraction and hope nothing else moves; in
 * practice it either changes nothing at all or quietly rewrites fields
 * nobody discussed. So the model names the edits and the CODE makes them.
 *
 * Paths are dotted, with numbers for array positions and a trailing `-` for
 * "append": `models.2.similarities`, `guides.0.name`, `models.1.differences.-`.
 * Every path is walked against the step's schema first, so an edit can only
 * reach a field the artifact is actually allowed to have.
 */

export type PatchOp = {
  op: "set" | "add" | "remove";
  path: string;
  value?: unknown;
};

export interface AppliedPatch {
  next: Record<string, unknown>;
  applied: PatchOp[];
  rejected: { op: PatchOp; reason: string }[];
}

export const PATCH_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    blocked: { type: "string" },
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["set", "add", "remove"] },
          path: { type: "string" },
          value: {},
        },
        required: ["op", "path"],
      },
    },
  },
  required: ["summary", "blocked", "ops"],
  additionalProperties: false,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A slot no operation may target — removed, waiting to be compacted away. */
const HOLE = Symbol("removed");

/**
 * The schema node a path leads to, or null when the artifact is not allowed
 * to have such a field. Array indices step into `items`; `-` means the
 * position after the last, which has the same shape as any other element.
 */
function schemaAt(schema: unknown, segments: string[]): unknown {
  let node: unknown = schema;
  for (const seg of segments) {
    if (!isRecord(node)) return null;
    if (node.type === "array") {
      if (!/^\d+$|^-$/.test(seg)) return null;
      node = node.items;
      continue;
    }
    if (!isRecord(node.properties) || !(seg in node.properties)) return null;
    node = node.properties[seg];
  }
  return node ?? null;
}

/** Whether a value could live in this schema slot — shape only, not content. */
function shapeFits(value: unknown, node: unknown): boolean {
  if (!isRecord(node) || node.type === undefined) return true;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  const actual = value === null ? "null"
    : Array.isArray(value) ? "array"
    : typeof value === "object" ? "object"
    : typeof value === "number" ? (Number.isInteger(value) ? "integer" : "number")
    : typeof value;
  if (actual === "integer" && types.includes("number")) return true;
  return types.includes(actual);
}

/**
 * Applies the model's edits to a copy of the artifact, one at a time, in the
 * order given. Anything that does not fit — an unknown field, a position past
 * the end of a list, a value of the wrong shape — is refused and reported
 * rather than forced, because a patch that half-lands is worse than one that
 * does not land at all.
 *
 * Removals leave a hole and the lists are compacted at the end, so every
 * index in the patch means what it meant in the object the model was shown.
 */
export function applyOps(
  prior: Record<string, unknown>,
  ops: PatchOp[],
  schema: Record<string, unknown>,
): AppliedPatch {
  const next = structuredClone(prior) as Record<string, unknown>;
  const applied: PatchOp[] = [];
  const rejected: { op: PatchOp; reason: string }[] = [];

  for (const op of ops) {
    const segments = String(op.path ?? "").split(".").filter((s) => s.length > 0);
    const reason = attempt(next, op, segments, schema);
    if (reason === null) applied.push(op);
    else rejected.push({ op, reason });
  }
  compact(next);
  return { next, applied, rejected };
}

function attempt(
  root: Record<string, unknown>,
  op: PatchOp,
  segments: string[],
  schema: Record<string, unknown>,
): string | null {
  if (segments.length === 0) return "empty path";
  if (schemaAt(schema, segments) === null) return `no such field in this artifact: ${op.path}`;

  const last = segments[segments.length - 1];
  let parent: unknown = root;
  for (const seg of segments.slice(0, -1)) {
    if (Array.isArray(parent)) {
      const i = Number(seg);
      if (!Number.isInteger(i) || i < 0 || i >= parent.length) return `no position ${seg} in ${op.path}`;
      parent = parent[i];
    } else if (isRecord(parent)) {
      if (!(seg in parent)) return `nothing at ${seg} in ${op.path}`;
      parent = parent[seg];
    } else return `cannot reach ${op.path}`;
  }
  if (parent === HOLE) return `${op.path} was already removed`;

  const valueSchema = schemaAt(schema, segments);
  if (op.op !== "remove" && !shapeFits(op.value, valueSchema)) {
    return `wrong kind of value for ${op.path}`;
  }

  if (Array.isArray(parent)) {
    if (last === "-") {
      if (op.op === "remove") return "cannot remove past the end of a list";
      parent.push(op.value);
      return null;
    }
    const i = Number(last);
    if (!Number.isInteger(i) || i < 0 || i >= parent.length) return `no position ${last} in ${op.path}`;
    if (parent[i] === HOLE) return `${op.path} was already removed`;
    // `add` at an occupied position would shift every index the model named.
    if (op.op === "add") return `${op.path} is taken — append with "-" instead`;
    parent[i] = op.op === "remove" ? HOLE : op.value;
    return null;
  }

  if (!isRecord(parent)) return `cannot reach ${op.path}`;
  if (op.op === "add") {
    if (last in parent) return `${op.path} already exists — use set`;
    parent[last] = op.value;
    return null;
  }
  if (!(last in parent)) return `nothing at ${op.path}`;
  if (op.op === "remove") delete parent[last];
  else parent[last] = op.value;
  return null;
}

/** Drops the holes left by removals, deepest first. */
function compact(node: unknown): void {
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      if (node[i] === HOLE) node.splice(i, 1);
      else compact(node[i]);
    }
    return;
  }
  if (isRecord(node)) for (const v of Object.values(node)) compact(v);
}

/**
 * The other way to change a settled artifact: throw it away and compose it
 * again from the transcript, then keep only the parts the change was about.
 *
 * Recomposing is the honest instrument when the client has just SAID the new
 * material — their words are in the transcript now, and the composer reads
 * them the way it read the interview. What recomposing cannot promise is
 * restraint: asked to fix one model's differences it will happily re-derive
 * every other field too, and things nobody discussed drift or empty out.
 *
 * So the code fences it. Only the named paths are taken from the fresh
 * composition; everything else is the prior artifact, byte for byte.
 */
export function adoptPaths(
  prior: Record<string, unknown>,
  fresh: Record<string, unknown>,
  paths: string[],
  schema: Record<string, unknown>,
): AppliedPatch {
  const next = structuredClone(prior) as Record<string, unknown>;
  const applied: PatchOp[] = [];
  const rejected: { op: PatchOp; reason: string }[] = [];

  for (const path of paths) {
    const op: PatchOp = { op: "set", path };
    const segments = String(path).split(".").filter((s) => s.length > 0);
    if (segments.length === 0) { rejected.push({ op, reason: "empty path" }); continue; }
    if (schemaAt(schema, segments) === null) {
      rejected.push({ op, reason: `no such field in this artifact: ${path}` });
      continue;
    }
    const [value, found] = read(fresh, segments);
    if (!found) {
      // The recomposition has nothing there. For a whole field that is a real
      // answer — the change asked for it to go — but a missing entity would
      // mean adopting a hole, so only top-level fields may vanish this way.
      if (segments.length > 1) { rejected.push({ op, reason: `the recomposition has no ${path}` }); continue; }
      delete next[segments[0]];
      applied.push(op);
      continue;
    }
    // The recomposition may have one more of something than the artifact had
    // — a model the client only mentioned during the change conversation.
    const [parent] = read(next, segments.slice(0, -1));
    const grows = Array.isArray(parent) && Number(segments[segments.length - 1]) === parent.length;
    const edit: PatchOp = grows
      ? { op: "add", path: [...segments.slice(0, -1), "-"].join("."), value }
      : { op: "set", path, value };
    const reason = attempt(next, edit, edit.path.split("."), schema);
    if (reason === null) applied.push(edit);
    else rejected.push({ op, reason });
  }
  compact(next);
  return { next, applied, rejected };
}

/** The value at a path, and whether anything was actually there. */
function read(node: unknown, segments: string[]): [unknown, boolean] {
  let cur: unknown = node;
  for (const seg of segments) {
    if (Array.isArray(cur)) {
      const i = Number(seg);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return [undefined, false];
      cur = cur[i];
    } else if (isRecord(cur)) {
      if (!(seg in cur)) return [undefined, false];
      cur = cur[seg];
    } else return [undefined, false];
  }
  return [cur, true];
}
