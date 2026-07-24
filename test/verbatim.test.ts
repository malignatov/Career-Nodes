/**
 * The verbatim discipline — the app's core guarantee: every string in an
 * x-verbatim field must be an exact (normalized) quote of the user's words.
 * Pure functions, no model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gatherMarked, verbatimViolations, normalize } from "../src/verbatim.ts";

const SCHEMA = {
  type: "object",
  properties: {
    motto: { type: "string", "x-verbatim": true },
    origin: { type: "string" },
    models: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          descriptors: {
            type: "array",
            items: {
              type: "object",
              properties: { text: { type: "string", "x-verbatim": true } },
            },
          },
          similarities: { type: "array", items: { type: "string", "x-verbatim": true } },
        },
      },
    },
  },
};

test("normalize folds case, curly quotes, and whitespace", () => {
  assert.equal(normalize("  “Let’s   Engineer\nLife”  "), '"let\'s engineer life"');
});

test("gatherMarked collects only x-verbatim strings, at any depth", () => {
  const draft = {
    motto: "Let's engineer life",
    origin: "from myself",
    models: [
      { name: "Elephant", descriptors: [{ text: "strong" }], similarities: ["I see what is possible"] },
      { name: "Michael", descriptors: [{ text: "unresting" }], similarities: [] },
    ],
  };
  assert.deepEqual(gatherMarked(draft, SCHEMA), [
    "Let's engineer life", "strong", "I see what is possible", "unresting",
  ]);
});

test("verbatimViolations passes exact quotes and flags paraphrases", () => {
  const userWords = "Let's engineer life. The elephant was strong and kind. I see what is possible.";
  const clean = {
    motto: "Let's engineer life",
    models: [{ name: "Elephant", descriptors: [{ text: "strong" }], similarities: ["I see what is possible"] }],
  };
  assert.deepEqual(verbatimViolations(clean, SCHEMA, userWords), []);

  const paraphrased = {
    motto: "Let us construct our existence", // not the user's words
    models: [{ name: "Elephant", descriptors: [{ text: "strong" }], similarities: [] }],
  };
  assert.deepEqual(verbatimViolations(paraphrased, SCHEMA, userWords), ["Let us construct our existence"]);
});

test("verbatimViolations is case/quote/whitespace tolerant, substring-based", () => {
  const userWords = "He said “I can give up   but never SURRENDER” yesterday";
  const draft = { motto: "i can give up but never surrender", models: [] };
  assert.deepEqual(verbatimViolations(draft, SCHEMA, userWords), []);
});

test("non-verbatim fields are never flagged", () => {
  const draft = { motto: "quoted words", origin: "entirely invented by the composer", models: [] };
  assert.deepEqual(verbatimViolations(draft, SCHEMA, "quoted words"), []);
});
