/**
 * Human rendering of a structured draft — never raw JSON. Shared by every
 * review surface: the practitioner modal, the braid session card, the woven
 * passage, and the mobile sheet.
 *
 * What the client reads at the end of a step is not a form: it is the page
 * about them. One column of cards, a person to a card, their own words as
 * chips and quoted lines, and the pattern under the names in its own sage
 * card. The traversal, the verbatim trichotomy and HIDDEN_KEYS are unchanged
 * from the field dump this replaces — the shape around them is not.
 *
 * The heading tells the client what belongs to whom. A tester lost an
 * afternoon to an earlier version where role models and guides both rendered
 * as titled blocks with no heading between them, and the artifact-wide traits
 * underneath looked like they belonged to whoever happened to be last.
 */

export const HIDDEN_KEYS = new Set([
  "_verbatim_warnings", "candidates",
  "named_order", "spoken_order", "first_mentioned_rank", "order",
]);

/* Any list of titled things — role models, media, stories, recollections,
 * portrait movements, plan directions — reads as one card per entity: big
 * serif name, then their material. Titles must never get lost in a field dump. */
const TITLE_KEYS = ["name", "title", "headline", "trait"];

/* Inside a person, their material in the order the interview gathered it:
 * who they were first, then how the client is like them, then unlike them. */
const ENTITY_SECTIONS = [
  ["similarities", "rm_similarities"],
  ["differences", "rm_differences"],
];

/** Two-tone section headings, per playbook and field. Anything unlisted falls
 *  back to the field's own name, in ink, with no trailing phrase. */
const SECTION_COPY = {
  role_models: { models: ["models_heading", "models_heading_soft"] },
};

/** The salience pass: artifact-wide, so it reads as its own section. */
const PATTERN_FIELDS = ["primacy_trait", "repeated_traits"];

/** Declared fields whose emptiness is worth saying out loud. */
const EMPTY_COPY = { guides: "empty_guides", shared_by_all: "empty_shared" };

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

/** Descriptor entries as plain strings, in the order they were spoken. */
function descriptorTexts(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((it, i) => (typeof it === "string"
      ? { text: it, at: i }
      : { text: it?.text, at: typeof it?.spoken_order === "number" ? it.spoken_order : i }))
    .filter((d) => typeof d.text === "string" && d.text.trim())
    .sort((a, b) => a.at - b.at)
    .map((d) => d.text);
}

/* The interview dumps — the reviews Sima read diagonally. Only these fold:
 * their long part is the client's OWN quotes, safe to tuck behind a level.
 * Derived prose steps never fold — there the composer's text IS the thing
 * that needs reading, and hiding it would let an unread paraphrase through. */
const FOLD_PLAYBOOKS = new Set(["role_models", "early_recollections", "favorite_media"]);

/**
 * The short of it: two or three lines a person can actually check — the
 * names, the pattern, and EVERY string the composer authored (paraphrase
 * flags), which must never sink below the fold. Returns null where the
 * two-level review doesn't apply; the caller then renders flat, as today.
 */
export function makeDigest(ctx) {
  const { esc, t } = ctx;
  return function digest(obj, quotes, warnings, opts = {}) {
    if (!FOLD_PLAYBOOKS.has(opts.playbook)) return null;
    const lines = [];
    for (const [key, value] of ordered(obj, opts.order)) {
      if (HIDDEN_KEYS.has(key) || PATTERN_FIELDS.includes(key)) continue;
      if (!isEntityList(value)) continue;
      const names = value.map((v) => v[entityTitle(v)]).filter(Boolean);
      if (names.length) {
        lines.push(`<div class="dg-line"><span class="dg-k">${esc(humanize(key))}</span>${
          names.map((n) => esc(n)).join(" <span class=\"dg-dot\">·</span> ")}</div>`);
      }
    }
    if (typeof obj.primacy_trait === "string" && obj.primacy_trait.trim()) {
      lines.push(`<div class="dg-line"><span class="dg-k">${esc(t("salience_first"))}</span>«${esc(obj.primacy_trait)}»</div>`);
    }
    const flaggedStrs = (warnings ?? []).filter((w) => typeof w === "string" && w.trim());
    let checkBlock = "";
    if (flaggedStrs.length) {
      checkBlock = `<div class="dg-check"><div class="dg-check-head">${esc(t("digest_check"))}</div>${
        flaggedStrs.map((w) => `<div class="dg-check-item">«${esc(w)}»<span class="assumed-tag">${esc(t("assumed_tag"))}</span></div>`).join("")}</div>`;
    }
    if (!lines.length && !checkBlock) return null;
    return `<div class="dr-digest">${lines.join("")}${checkBlock}</div>`;
  };
}

export function makeRenderer(ctx) {
  const { esc, t, markVerbatim } = ctx;

  /* Verbatim trichotomy: verified user words are the DEFAULT look — <mark>
   * survives for tooling but carries no highlight. A string the composer
   * offered as a quote that verification could not find in the user's words
   * wears the paraphrase tag, and nothing else. */
  function flagged(value, quotes, warnings) {
    const marked = markVerbatim(value, quotes);
    if (warnings?.includes(value)) {
      return `<span class="assumed">${marked}</span><span class="assumed-tag">${esc(t("assumed_tag"))}</span>`;
    }
    return marked;
  }

  const assumedTag = () => `<span class="assumed-tag">${esc(t("assumed_tag"))}</span>`;

  /**
   * The client's own words, in guillemets. The chrome is the marks alone —
   * what sits between them is the artifact string, character for character —
   * so the paraphrase tag hangs OUTSIDE the closing mark, never inside the
   * quote it is commenting on.
   */
  function quotedText(text, quotes, warnings) {
    const inner = markVerbatim(text, quotes);
    const assumed = warnings?.includes(text);
    return `<span class="dr-gm">«</span><span class="${assumed ? "assumed" : ""}">${inner}</span>`
      + `<span class="dr-gm">»</span>${assumed ? assumedTag() : ""}`;
  }

  const quoted = (text, quotes, warnings, cls = "rm-item") =>
    `<div class="${cls}">${quotedText(text, quotes, warnings)}</div>`;

  function renderValue(value, quotes, warnings) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "string") return `<div class="field-value">${flagged(value, quotes, warnings)}</div>`;
    if (typeof value === "number" || typeof value === "boolean") {
      return `<div class="field-value">${esc(String(value))}</div>`;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return "";
      if (isEntityList(value)) return renderEntityBlocks(value, quotes, warnings, {});
      if (value.every((v) => typeof v === "string")) {
        return `<ul>${value.map((v) => `<li>${flagged(v, quotes, warnings)}</li>`).join("")}</ul>`;
      }
      return value.map((v) => `<div class="sub-card">${renderValue(v, quotes, warnings)}</div>`).join("");
    }
    if (typeof value === "object") return renderNested(value, quotes, warnings);
    return "";
  }

  /** Nested objects stay plain — a draft must not become boxes inside boxes. */
  function renderNested(obj, quotes, warnings) {
    const parts = [];
    for (const [key, value] of Object.entries(obj)) {
      if (HIDDEN_KEYS.has(key)) continue;
      const body = renderValue(value, quotes, warnings);
      if (body) parts.push(`<div class="field-label">${esc(humanize(key))}</div>${body}`);
    }
    return parts.join("");
  }

  /**
   * One card per person: who they are, the words used about them as chips,
   * then how the client is like and unlike them.
   *
   * `field` and `primacy` are what make the card specific — the eyebrow can
   * only say "Model 2" where the playbook is actually listing models, and the
   * primacy chip is found by matching the trait STRING on the first-named
   * model, never by position.
   */
  function renderEntityBlocks(list, quotes, warnings, { field, primacy } = {}) {
    return list.map((m) => {
      const titleKey = entityTitle(m);
      const isTrait = titleKey === "trait";
      const parts = [];

      const eyebrow = entityEyebrow(m, field);
      if (eyebrow) parts.push(`<div class="dr-eyebrow">${eyebrow}</div>`);
      if (titleKey) parts.push(`<div class="rm-name">${flagged(m[titleKey], quotes, warnings)}</div>`);

      // Short scalar facts that the eyebrow did not already take (a headline's
      // verb, say) sit under the name; long prose falls through below.
      const rest = [];
      for (const [k, v] of Object.entries(m)) {
        if (k === titleKey || HIDDEN_KEYS.has(k) || (k === "relationship" && eyebrow)) continue;
        if (typeof v === "string" && v.trim() && v.length <= 90) {
          parts.push(`<div class="rm-rel">${flagged(v, quotes, warnings)}</div>`);
        } else rest.push([k, v]);
      }

      const chips = descriptorTexts(m.descriptors);
      if (chips.length > 0) {
        const first = m.named_order === 1 && typeof primacy === "string" && primacy.trim();
        parts.push(`<div class="rm-chips">${chips.map((text) => {
          // The primacy chip is found by its TEXT on the first-named model —
          // never by position, which drifts the moment an amend reorders them.
          const sage = first && text === primacy ? " is-primacy" : "";
          return `<span class="rm-chip${sage}">${quotedText(text, quotes, warnings)}</span>`;
        }).join("")}</div>`);
      }

      const duo = [];
      for (const [key, label] of ENTITY_SECTIONS) {
        const items = descriptorTexts(m[key]);
        if (!items.length) continue;
        duo.push(`<div class="dr-rowlab">${esc(t(label))}</div><div class="dr-rowval">${
          items.map((it) => quoted(it, quotes, warnings, "dr-line")).join("")}</div>`);
      }
      if (duo.length > 0) parts.push(`<div class="dr-rule"></div><div class="rm-duo">${duo.join("")}</div>`);

      for (const [k, v] of rest) {
        if (k === "descriptors" || ENTITY_SECTIONS.some(([f]) => f === k)) continue;
        if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) {
          parts.push(`<div class="rm-sec">${esc(humanize(k))}</div>${
            v.map((it) => quoted(it, quotes, warnings)).join("")}`);
          continue;
        }
        const rendered = renderValue(v, quotes, warnings);
        if (rendered) parts.push(`<div class="rm-sec">${esc(humanize(k))}</div>${rendered}`);
      }
      return `<div class="rm-block dr-card${isTrait ? " rm-trait" : ""}">${parts.join("")}</div>`;
    }).join("");
  }

  /** "Model 2 · Named first", or a guide with the relationship the client gave. */
  function entityEyebrow(m, field) {
    if (typeof m.relationship === "string" && m.relationship.trim()) {
      return `${esc(t("entity_guide"))} · ${esc(m.relationship)}`;
    }
    if (field !== "models" || typeof m.named_order !== "number") return "";
    return esc(t("entity_model", m.named_order)) + (m.named_order === 1 ? ` · ${esc(t("named_first"))}` : "");
  }

  /** The salience pass, in its own voice: what was said first, what repeated. */
  function renderPattern(content, quotes, warnings) {
    const cards = [];
    const first = content.primacy_trait;
    if (typeof first === "string" && first.trim()) {
      cards.push(`<div class="dr-card dr-sage">`
        + `<div class="dr-eyebrow">${esc(t("salience_first"))}</div>`
        + `<div class="dr-first">${quotedText(first, quotes, warnings)}</div>`
        + `<div class="dr-first-note">${esc(t("salience_first_note"))}</div></div>`);
    }
    for (const item of content.repeated_traits ?? []) {
      if (!item || typeof item !== "object") continue;
      const echoes = descriptorTexts(item.echoes);
      if (!echoes.length && !item.trait) continue;
      // The trait name is the composer's phrasing, so it wears no guillemets;
      // every echo beneath it is the client's, so every echo does.
      cards.push(`<div class="dr-card dr-repeat">`
        + (item.trait ? `<div class="dr-trait">${esc(item.trait)}</div>` : "")
        + echoes.map((e) => quoted(e, quotes, warnings, "dr-echo")).join("")
        + `</div>`);
    }
    if (cards.length === 0) return "";
    return section(["pattern_heading", "pattern_heading_soft"], null, cards.join(""));
  }

  /** A two-tone headline over its cards: the statement, then the quiet half. */
  function section(copy, fallbackKey, body) {
    const head = copy
      ? `${esc(t(copy[0]))} <span class="dr-soft">${esc(t(copy[1]))}</span>`
      : esc(humanize(fallbackKey));
    return `<section class="dv-sec"><h3 class="field-label">${head}</h3>${body}</section>`;
  }

  /** Fields the playbook declares but the client never filled — said plainly
   *  rather than silently dropped, so nothing looks like it went missing. */
  function emptyNote(content, order) {
    if (!Array.isArray(order)) return "";
    const notes = [];
    for (const key of order) {
      if (!(key in EMPTY_COPY)) continue;
      const v = content[key];
      const empty = v === null || v === undefined || v === ""
        || (Array.isArray(v) && v.length === 0);
      if (empty) notes.push(esc(t(EMPTY_COPY[key])));
    }
    return notes.length ? `<div class="dr-empty">${notes.join(" · ")}</div>` : "";
  }

  /**
   * The readout. Every top-level field becomes a titled section of cards; the
   * salience fields are gathered into the pattern section after the people,
   * because they are about all of them and about none of them in particular.
   */
  function renderFields(obj, quotes, warnings, opts = {}) {
    const { order, playbook } = opts;
    const copyFor = SECTION_COPY[playbook] ?? {};
    const parts = [];
    let hasPattern = false;

    for (const [key, value] of ordered(obj, order)) {
      if (HIDDEN_KEYS.has(key)) continue;
      if (PATTERN_FIELDS.includes(key)) { hasPattern = true; continue; }
      const body = isEntityList(value)
        ? renderEntityBlocks(value, quotes, warnings, { field: key, primacy: obj.primacy_trait })
        : wrapCard(renderValue(value, quotes, warnings));
      if (!body) continue;
      parts.push(section(copyFor[key], key, body));
    }
    if (hasPattern) parts.push(renderPattern(obj, quotes, warnings));
    parts.push(emptyNote(obj, order));
    return parts.join("");
  }

  /** Loose values still read as a card — the column has one material. */
  const wrapCard = (body) => (body ? `<div class="dr-card">${body}</div>` : "");

  return renderFields;
}
