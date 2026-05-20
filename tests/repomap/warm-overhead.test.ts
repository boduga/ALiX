import { describe, it } from "node:test";
import assert from "node:assert";
import { ContextCompiler } from "../../src/repomap/context-compiler.js";

describe("ContextCompiler.warm() overhead", () => {
  it("measures warm() and compile() timing", async () => {
    const projectRoot = process.cwd();
    const compiler = new ContextCompiler({ root: projectRoot });

    // Warm up: time the initial warm() call
    const warmStart = performance.now();
    await compiler.warm();
    const warmEnd = performance.now();
    const warmMs = warmEnd - warmStart;

    // First compile call (uses cached repoMap)
    const compile1Start = performance.now();
    await compiler.compileContext("test task", "feature", []);
    const compile1End = performance.now();
    const compile1Ms = compile1End - compile1Start;

    // Second compile call (should be similar timing)
    const compile2Start = performance.now();
    await compiler.compileContext("another task", "bugfix", []);
    const compile2End = performance.now();
    const compile2Ms = compile2End - compile2Start;

    // Report results
    console.log("\n=== ContextCompiler Timing Results ===");
    console.log(`warm() duration:        ${warmMs.toFixed(2)} ms`);
    console.log(`compile() #1 duration: ${compile1Ms.toFixed(2)} ms`);
    console.log(`compile() #2 duration: ${compile2Ms.toFixed(2)} ms`);
    console.log(`Average compile():      ${((compile1Ms + compile2Ms) / 2).toFixed(2)} ms`);
    console.log(`Warm overhead ratio:    ${(warmMs / ((compile1Ms + compile2Ms) / 2)).toFixed(1)}x compile()`);
    console.log("======================================\n");

    // Assertions
    assert(warmMs > 0, "warm() should take measurable time");
    assert(compile1Ms >= 0, "compile() should complete");
    assert(compile2Ms >= 0, "compile() should complete");
  });
});
