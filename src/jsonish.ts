/**
 * JSON as models actually return it. The engine asks for "JSON only", and
 * mostly gets it — but a model under load pads the object with prose, wraps
 * it in fences, or appends a closing remark after the final brace. One such
 * suffix used to throw ("Unexpected non-whitespace character after JSON"),
 * and the throw tore down a live session mid-interview.
 *
 * This takes the FIRST complete JSON value and ignores everything around it.
 * String contents are respected (braces inside quotes don't count), so a
 * client's own words can never unbalance the scan.
 */
export function extractJson(raw: string): unknown {
  const s = String(raw ?? "").replace(/^```(?:json)?\s*|\s*```\s*$/g, "").trim();
  try {
    return JSON.parse(s);
  } catch { /* not clean — find the value inside the noise */ }

  const start = s.search(/[{[]/);
  if (start < 0) throw new Error(`no JSON value in model output: ${s.slice(0, 60)}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error("unterminated JSON value in model output");
}
