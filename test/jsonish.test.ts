/**
 * JSON as models actually return it. The trailing-prose case is verbatim from
 * a tester's crash: valid JSON, then commentary, then a dead session.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson } from "../src/jsonish.ts";

test("clean JSON passes through", () => {
  assert.deepEqual(extractJson('{"ok":true}'), { ok: true });
  assert.deepEqual(extractJson('[1,2]'), [1, 2]);
});

test("fenced JSON is unwrapped", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

test("prose after the value is ignored — the crash from the field", () => {
  assert.deepEqual(
    extractJson('{"models":[{"name":"Слон"}]}\n\nI hope this structure works for you!'),
    { models: [{ name: "Слон" }] },
  );
});

test("prose before the value is ignored too", () => {
  assert.deepEqual(extractJson('Here is the JSON you asked for: {"a":1} — done.'), { a: 1 });
});

test("braces inside the client's own words never unbalance the scan", () => {
  assert.deepEqual(
    extractJson('{"quote":"he said {be brave} and left","n":1} trailing'),
    { quote: "he said {be brave} and left", n: 1 },
  );
});

test("escaped quotes inside strings are respected", () => {
  assert.deepEqual(extractJson('{"q":"a \\"quoted\\" word"} etc'), { q: 'a "quoted" word' });
});

test("a second object after the first is ignored, not merged", () => {
  assert.deepEqual(extractJson('{"first":1} {"second":2}'), { first: 1 });
});

test("no JSON at all still throws — silence must not become an empty object", () => {
  assert.throws(() => extractJson("I cannot answer that."), /no JSON value/);
  assert.throws(() => extractJson('{"never":"closed"'), /unterminated/);
});
