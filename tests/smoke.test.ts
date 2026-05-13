import test from "node:test";
import assert from "node:assert/strict";
import { ALIX_VERSION } from "../src/index.js";

test("exports ALiX version", () => {
  assert.equal(ALIX_VERSION, "0.1.0");
});
