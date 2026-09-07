import { describe, expect, it } from "vitest";
import { taskRouter } from "../../src/runtime/task-router.js";

describe("generation + explicit file output routes to the agent", () => {
  it("routes a long report prompt that names response.md to agent (not direct)", async () => {
    const task =
      "You are an enterprise architecture reviewer. Produce a comprehensive 5-part analysis. " +
      "Write the complete response to response.md in this workspace. PART 1: requirements. " +
      "PART 2: FSM. PART 3: Rust code. PART 4: JSON schema. PART 5: test matrix.";
    const route = await taskRouter(task);
    expect(route.kind).toBe("agent");
  });

  it("routes 'save this report as report.md' to agent", async () => {
    const route = await taskRouter("Analyze this system deeply and save the report as report.md");
    expect(route.kind).toBe("agent");
  });

  it("keeps pure in-chat generation (no file target) off the agent route", async () => {
    const route = await taskRouter(
      "You are acting as an enterprise software architecture review committee. " +
        "Provide a critical assessment of exactly-once delivery under network partitions.",
    );
    expect(route.kind).not.toBe("agent");
  });

  it("does not treat an arbitrary .md mention without a write verb as a deliverable", async () => {
    const route = await taskRouter("What is the Rust crate ecosystem? See docs/notes.md for context.");
    expect(route.kind).not.toBe("agent");
  });
});
