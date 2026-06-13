/**
 * cases/index.ts — Registry of all benchmark cases, keyed by name.
 */
import type { BenchmarkSuite } from "../benchmark-types.js";
import { runCliStartupBenchmark } from "./cli-startup.js";
import { runModelsDoctorBenchmark } from "./models-doctor.js";
import { runRuntimeIndexBenchmark } from "./runtime-index.js";
import { runDaemonSubmitBenchmark } from "./daemon-submit.js";
import { runContextCompileBenchmark } from "./context-compile.js";
import { runNoToolTaskBenchmark } from "./no-tool-task.js";

export type CaseDef = { suite: BenchmarkSuite; label: string; run: () => Promise<void> };

export const BENCHMARK_CASES = new Map<string, CaseDef>([
  ["cli-startup",       { suite: "quick"   as BenchmarkSuite, label: "CLI startup (--help)",           run: runCliStartupBenchmark }],
  ["models-doctor",     { suite: "quick"   as BenchmarkSuite, label: "Hardware + model doctor",        run: runModelsDoctorBenchmark }],
  ["runtime-index",     { suite: "runtime" as BenchmarkSuite, label: "RuntimeIndex build + query",     run: runRuntimeIndexBenchmark }],
  ["daemon-submit",     { suite: "daemon"  as BenchmarkSuite, label: "Daemon submit + ack",            run: runDaemonSubmitBenchmark }],
  ["context-compile",   { suite: "runtime" as BenchmarkSuite, label: "Context compilation (repo map)", run: runContextCompileBenchmark }],
  ["no-tool-task",      { suite: "quick"   as BenchmarkSuite, label: "End-to-end no-tool task (mock)", run: runNoToolTaskBenchmark }],
]);
