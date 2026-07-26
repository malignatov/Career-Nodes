/**
 * The verbatim discipline — the app's core guarantee: every string in an
 * x-verbatim field must be an exact (normalized) quote of the user's words.
 * Pure functions, no model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { borrowedAcrossEntities, gatherMarked, verbatimViolations, normalize } from "../src/verbatim.ts";

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

/**
 * Cross-attribution: the model lifted the comparison the client made about
 * their first role model and printed it under the third as well. Every word
 * is the client's, so verbatim sees nothing wrong — only the code can tell
 * that a sentence about one person was hung on another.
 */
const OWN_SCHEMA = {
  type: "object",
  properties: {
    models: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          similarities: { type: "array", "x-own": true, items: { type: "string", "x-verbatim": true } },
          descriptors: { type: "array", items: { type: "string", "x-verbatim": true } },
        },
      },
    },
  },
};

test("borrowedAcrossEntities catches a comparison hung on two models", () => {
  const draft = {
    models: [
      { name: "Elephant", similarities: ["I see what is possible"], descriptors: ["strong"] },
      { name: "Michael", similarities: ["I never stop"], descriptors: ["strong"] },
      { name: "Grandmother", similarities: ["I see what is possible"], descriptors: ["kind"] },
    ],
  };
  // Flagged under both models: the code cannot know which one the client
  // actually said it about, and it is the client who decides.
  assert.deepEqual(borrowedAcrossEntities(draft, OWN_SCHEMA), ["I see what is possible"]);
});

test("borrowedAcrossEntities leaves honest work, and un-owned fields, alone", () => {
  const distinct = {
    models: [
      { name: "Elephant", similarities: ["I see what is possible"], descriptors: ["strong"] },
      // "strong" repeats, but descriptors aren't x-own: two people may share a word.
      { name: "Michael", similarities: ["I never stop"], descriptors: ["strong"] },
      { name: "Grandmother", similarities: [], descriptors: ["kind"] },
    ],
  };
  assert.deepEqual(borrowedAcrossEntities(distinct, OWN_SCHEMA), []);
});

test("borrowedAcrossEntities compares the way verbatim does — case and quotes folded", () => {
  const draft = {
    models: [
      { name: "Elephant", similarities: ["I see what is possible"] },
      { name: "Michael", similarities: ["  i SEE what is   possible "] },
    ],
  };
  // Flagged in the draft's own wording, both spellings, so the review can
  // match each to the line it shows.
  assert.deepEqual(borrowedAcrossEntities(draft, OWN_SCHEMA), [
    "I see what is possible", "  i SEE what is   possible ",
  ]);
});
