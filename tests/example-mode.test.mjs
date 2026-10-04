import assert from "node:assert/strict";
import test from "node:test";

import { maskExampleAnswer, splitInlineExample } from "../app/lume-example.ts";

test("masks the solution inside an example before reveal", () => {
  assert.equal(
    maskExampleAnswer("Martina prepared a short pitch for a new website feature.", "pitch"),
    "Martina prepared a short * for a new website feature.",
  );
});

test("masks whole words without changing similar words", () => {
  assert.equal(maskExampleAnswer("The pitcher refined the pitch.", "pitch"), "The pitcher refined the *.");
});

test("keeps rich-text markup while masking the answer", () => {
  assert.equal(maskExampleAnswer("A short <strong>pitch</strong> can help.", "pitch"), "A short <strong>*</strong> can help.");
});

test("reads legacy inline Example fields as the third side", () => {
  assert.deepEqual(
    splitInlineExample("A persuasive presentation of an idea. Example: Martina prepared a short pitch."),
    {
      back: "A persuasive presentation of an idea.",
      example: "Martina prepared a short pitch.",
    },
  );
});
