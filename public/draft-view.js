/**
 * Human rendering of a structured draft — never raw JSON. Shared by every
 * review surface: the practitioner modal, the braid session card, the woven
 * passage, and the mobile sheet.
 *
 * The shape the client reads has to say what belongs to whom. A tester lost
 * an afternoon to this: role models and guides both render as titled blocks,
 * so the same three names appeared twice with nothing between them, and the
 * artifact-wide traits underneath looked like they belonged to whichever
 * person happened to be last. Every top-level field is a titled section now,
 * and each person carries their own material inside their own block.
 */

export const HIDDEN_KEYS = new Set([
  "_verbatim_warnings", "candidates",
  "named_order", "spoken_order", "first_mentioned_rank", "order",
]);

/* Any list of titled things — role models, media, stories, recollections,
 * portrait movements, plan directions — reads as one block per entity: big
 * serif title, then its material. Titles must never get lost in a field dump. */
const TITLE_KEYS = ["name", "title", "headline", "trait"];

/* Inside a person, their material in the order the interview gathered it:
 * who they were first, then how the client is like them, then unlike them. */
const ENTITY_SECTIONS = [
  ["descriptors", "rm_descriptors"],
  ["similarities", "rm_similarities"],
  ["differences", "rm_differences"],
];

function entityTitle(v) {
  for (const k of TITLE_KEYS) {
    if (typeof v[k] === "string" && v[k].trim()) return k;
  }
  return null;
}

export function isEntityList(value) {
  return Array.isArray(value) && value.length > 0
    && value.every((v) => v && typeof v === "object" && !Array.isArray(v))
    && value.some((v) => entityTitle(v) !== null);
}

/** A field name as a person would say it, when the playbook has no label. */
const humanize = (key) => key.replaceAll("_", " ");

/**
 * The playbook's declared field order, when the review carries it. A composer
 * emits its JSON keys in whatever order it likes, and the client should not
 * meet the guides before the people the step is actually about.
 */
function ordered(obj, order) {
  const entries = Object.entries(obj);
  if (!Array.isArray(order) || order.length === 0) return entries;
  const rank = new Map(order.map((k, i) => [k, i]));
  const at = (k) => (rank.has(k) ? rank.get(k) : order.length);
  return entries
    .map((e, i) => [e, i])
    .sort((a, b) => at(a[0][0]) - at(b[0][0]) || a[1] - b[1])
    .map(([e]) => e);
}

export function makeRenderer(ctx) {
  const { esc, t, markVerbatim } = ctx;

  /* Verbatim trichotomy: <mark> = verified user words; "assumed" = a string
   * the composer offered as a quote that verification could not find in the
   * user's words or their authorized artifacts; plain = connective tissue. */
  function flagged(value, quotes, warnings) {
    const marked = markVerbatim(value, quotes);
    if (warnings?.includes(value)) {
      return `<span class="assumed">${marked}</span><span class="assumed-tag">${esc(t("assumed_tag"))}</span>`;
    }
    return marked;
  }

  const quoteList = (items, quotes, warnings) =>
    items.map((it) => `<div class="rm-item">«<span>${flagged(it, quotes, warnings)}</span>»</div>`).join("");

  function renderValue(value, quotes, warnings) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "string") return `<div class="field-value">${flagged(value, quotes, warnings)}</div>`;
    if (typeof value === "number" || typeof value === "boolean") {
      return `<div class="field-value">${esc(String(value))}</div>`;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return "";
      if (isEntityList(value)) return renderEntityBlocks(value, quotes, warnings);
      if (value.every((v) => typeof v === "string")) {
        return `<ul>${value.map((v) => `<li>${flagged(v, quotes, warnings)}</li>`).join("")}</ul>`;
      }
      return value.map((v) => `<div class="sub-card">${renderValue(v, quotes, warnings)}</div>`).join("");
    }
    if (typeof value === "object") return renderFields(value, quotes, warnings, 1);
    return "";
  }

  function renderEntityBlocks(list, quotes, warnings) {
    return list.map((m) => {
      const titleKey = entityTitle(m);
      let h = titleKey ? `<div class="rm-name">${flagged(m[titleKey], quotes, warnings)}</div>` : "";
      // Short scalar facts (a guide's relationship, a headline's verb) sit
      // under the title; long prose falls through to the body renderer below.
      // Nothing the user authorizes may vanish from the review.
      const rest = [];
      for (const [k, v] of Object.entries(m)) {
        if (k === titleKey || HIDDEN_KEYS.has(k)) continue;
        if (typeof v === "string" && v.trim() && v.length <= 90) {
          h += `<div class="rm-rel">${flagged(v, quotes, warnings)}</div>`;
        } else rest.push([k, v]);
      }
      for (const [field, key] of ENTITY_SECTIONS) {
        const items = (m[field] ?? [])
          .map((it) => (typeof it === "string" ? it : it?.text))
          .filter(Boolean);
        if (!items.length) continue;
        h += `<div class="rm-sec">${esc(t(key))}</div>${quoteList(items, quotes, warnings)}`;
      }
      for (const [k, v] of rest) {
        if (ENTITY_SECTIONS.some(([f]) => f === k)) continue;
        if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) {
          h += `<div class="rm-sec">${esc(humanize(k))}</div>${quoteList(v, quotes, warnings)}`;
          continue;
        }
        const rendered = renderValue(v, quotes, warnings);
        if (!rendered) continue;
        h += `<div class="rm-sec">${esc(humanize(k))}</div>${rendered}`;
      }
      // A trait is not a person: same block, lighter title, so the eye still
      // reads the people as the subject of the step.
      return `<div class="rm-block${titleKey === "trait" ? " rm-trait" : ""}">${h}</div>`;
    }).join("");
  }

  /**
   * At the top level every field becomes a titled section, entity lists
   * included — that heading is what tells the client these three names are
   * the models and those three are the guides, and it fences the traits
   * below off from the last person above. Nested objects stay plain, so a
   * draft does not turn into a stack of boxes inside boxes.
   */
  function renderFields(obj, quotes, warnings, depth = 0, order) {
    const parts = [];
    for (const [key, value] of ordered(obj, order)) {
      if (HIDDEN_KEYS.has(key)) continue;
      const body = isEntityList(value)
        ? renderEntityBlocks(value, quotes, warnings)
        : renderValue(value, quotes, warnings);
      if (!body) continue;
      const label = `<div class="field-label">${esc(humanize(key))}</div>`;
      parts.push(depth === 0 ? `<section class="dv-sec">${label}${body}</section>` : label + body);
    }
    return parts.join("");
  }

  return renderFields;
}
