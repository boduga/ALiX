// Place this in tests/adaptation/operator-queue.vitest.ts (will be expanded in Task 3)
import { describe, it, expect } from "vitest";
import { OperatorQueue } from "../../src/adaptation/operator-queue.js";

describe("OperatorQueue", () => {
  it("exists and has a build method", () => {
    const q = new OperatorQueue();
    expect(typeof q.build).toBe("function");
  });
});
