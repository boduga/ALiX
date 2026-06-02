import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";

process.argv = ["node", "bench/startup.ts", "agent", "explorer", "test"];

const start = performance.now();
try {
  await import("../dist/src/cli.js");
} catch (e) {
  // CLI may exit with error, that's ok
}
const end = performance.now();
const elapsed = (end - start).toFixed(0);
writeFileSync("/tmp/bench_output.txt", `CLI load time: ${elapsed}ms\n`);
console.log(`CLI load time: ${elapsed}ms`);