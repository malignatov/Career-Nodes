/**
 * The amend patch: the model names edits, the code makes them. Pure — the
 * point of this design is that nothing here depends on a model behaving.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { adoptPaths, applyOps } from "../src/patch.ts";

const SCHEMA = {
  type: "object",
  properties: {
    models: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          similarities: { type: "array", items: { type: "string" } },
          descriptors: {
            type: "array",
            items: { type: "object", properties: { text: { type: "string" } } },
          },
        },
      },
    },
    guides: { type: "array", items: { type: "object", properties: { name: { type: "string" } } } },
    headline: { type: "string" },
  },
};

const draft = () => ({
  models: [
    { name: "the elephant", similarities: ["I see what is possible"], descriptors: [{ text: "strong" }] },
    { name: "Michael", similarities: [], descriptors: [{ text: "unresting" }] },
  ],
  guides: [{ name: "my grandmother" }],
  headline: "Three who were watched",
});

test("set replaces one value and leaves the rest alone", () => {
  const { next, applied, rejected } = applyOps(draft(), [
    { op: "set", path: "models.1.name", value: "Michael Jordan" },
  ], SCHEMA);
  assert.equal(applied.length, 1);
  assert.deepEqual(rejected, []);
  assert.equal(next.models[1].name, "Michael Jordan");
  assert.deepEqual(next.models[0], draft().models[0]);
  assert.equal(next.headline, "Three who were watched");
});

test("a trailing dash appends; add on an occupied slot is refused", () => {
  const { next, rejected } = applyOps(draft(), [
    { op: "add", path: "models.1.similarities.-", value: "I never stop" },
    { op: "add", path: "models.0.similarities.0", value: "would shift every index" },
  ], SCHEMA);
  assert.deepEqual(next.models[1].similarities, ["I never stop"]);
  assert.deepEqual(next.models[0].similarities, ["I see what is possible"]);
  assert.match(rejected[0].reason, /append with "-"/);
});

test("removals hold their positions until the whole patch is applied", () => {
  // Both indices are read against the object the model was shown — the first
  // removal must not slide the second one onto the wrong element.
  const three = {
    models: [{ name: "a" }, { name: "b" }, { name: "c" }],
    guides: [], headline: "h",
  };
  const { next, applied } = applyOps(three, [
    { op: "remove", path: "models.0" },
    { op: "set", path: "models.2.name", value: "C" },
    { op: "remove", path: "models.1" },
  ], SCHEMA);
  assert.equal(applied.length, 3);
  assert.deepEqual(next.models, [{ name: "C" }]);
});

test("an edit can only reach a field the artifact is allowed to have", () => {
  const { next, applied, rejected } = applyOps(draft(), [
    { op: "add", path: "models.0.secret_score", value: 9 },
    { op: "set", path: "nonsense.0", value: "x" },
  ], SCHEMA);
  assert.deepEqual(applied, []);
  assert.equal(rejected.length, 2);
  for (const r of rejected) assert.match(r.reason, /no such field/);
  assert.deepEqual(next, draft());
});

test("a value of the wrong shape is refused, not coerced", () => {
  const { next, rejected } = applyOps(draft(), [
    { op: "set", path: "models.0.similarities", value: "not a list" },
    { op: "set", path: "headline", value: ["not a string"] },
  ], SCHEMA);
  assert.equal(rejected.length, 2);
  for (const r of rejected) assert.match(r.reason, /wrong kind of value/);
  assert.deepEqual(next, draft());
});

test("positions past the end are refused rather than invented", () => {
  const { next, rejected } = applyOps(draft(), [
    { op: "set", path: "models.7.name", value: "nobody" },
    { op: "remove", path: "guides.3" },
  ], SCHEMA);
  assert.equal(rejected.length, 2);
  assert.deepEqual(next, draft());
});

test("good edits land even when a bad one travels with them", () => {
  const { next, applied, rejected } = applyOps(draft(), [
    { op: "set", path: "models.0.descriptors.0.text", value: "very strong" },
    { op: "set", path: "models.4.name", value: "nobody" },
  ], SCHEMA);
  assert.equal(applied.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(next.models[0].descriptors[0].text, "very strong");
});

test("the prior draft is never mutated", () => {
  const before = draft();
  const subject = draft();
  applyOps(subject, [{ op: "remove", path: "models.0" }, { op: "set", path: "headline", value: "x" }], SCHEMA);
  assert.deepEqual(subject, before);
});

/* ── invalidate and recompute, fenced ──────────────────────────────────── */

const fresh = () => ({
  models: [
    { name: "the elephant", similarities: ["re-derived, and nobody asked"], descriptors: [{ text: "strong" }] },
    { name: "Michael", similarities: ["I never stop"], descriptors: [{ text: "unresting" }] },
  ],
  guides: [],
  headline: "A different headline nobody discussed",
});

test("only the named part of the recomposition is kept", () => {
  const { next, applied, rejected } = adoptPaths(draft(), fresh(), ["models.1"], SCHEMA);
  assert.equal(applied.length, 1);
  assert.deepEqual(rejected, []);
  assert.deepEqual(next.models[1].similarities, ["I never stop"]);
  // everything outside the fence is exactly what the client already approved
  assert.deepEqual(next.models[0], draft().models[0]);
  assert.deepEqual(next.guides, draft().guides);
  assert.equal(next.headline, draft().headline);
});

test("a whole field the change asked to empty may come back empty", () => {
  const { next, applied } = adoptPaths(draft(), fresh(), ["guides"], SCHEMA);
  assert.equal(applied.length, 1);
  assert.deepEqual(next.guides, []);
  assert.deepEqual(next.models, draft().models);
});

test("a field the recomposition dropped altogether is dropped here too", () => {
  const gone = { models: fresh().models, guides: [] }; // no headline at all
  const { next, applied } = adoptPaths(draft(), gone, ["headline"], SCHEMA);
  assert.equal(applied.length, 1);
  assert.ok(!("headline" in next));
});

test("a missing entity is refused rather than adopted as a hole", () => {
  const short = { models: [fresh().models[0]], guides: [], headline: "h" };
  const { next, applied, rejected } = adoptPaths(draft(), short, ["models.1"], SCHEMA);
  assert.deepEqual(applied, []);
  assert.match(rejected[0].reason, /no models\.1/);
  assert.deepEqual(next, draft());
});

test("the recomposition may bring one more of something than the artifact had", () => {
  const grown = {
    ...fresh(),
    models: [...fresh().models, { name: "my grandmother", similarities: [], descriptors: [] }],
  };
  const { next, applied } = adoptPaths(draft(), grown, ["models.2"], SCHEMA);
  assert.equal(applied.length, 1);
  assert.equal(next.models.length, 3);
  assert.equal(next.models[2].name, "my grandmother");
  assert.deepEqual(next.models[0], draft().models[0]);
});

test("a path the artifact cannot have is refused", () => {
  const { next, applied, rejected } = adoptPaths(draft(), fresh(), ["invented"], SCHEMA);
  assert.deepEqual(applied, []);
  assert.match(rejected[0].reason, /no such field/);
  assert.deepEqual(next, draft());
});
