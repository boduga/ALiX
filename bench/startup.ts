import { performance } from "node:perf_hooks";

async function main() {
  // Measure CLI startup time by importing the compiled CLI
  const start = performance.now();
  await import("../dist/src/cli.js");
  const end = performance.now();
  console.log(`CLI load time: ${(end - start).toFixed(0)}ms`);
}

main().catch(console.error);