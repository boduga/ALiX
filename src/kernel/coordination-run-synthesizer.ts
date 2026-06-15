/**
 * coordination-run-synthesizer.ts — Type definition for optional run synthesis.
 *
 * A RunSynthesizer can produce a human-readable final summary from aggregated
 * worker results. The implementation is provided by the synthesis service
 * (M0.77e.8).
 */

import type { WorkerResultSummary } from "./coordination-result-types.js";

export type SynthesizeInput = {
  runId: string;
  rootGoal: string;
  workerResults: WorkerResultSummary[];
};

export interface RunSynthesizer {
  synthesize(input: SynthesizeInput): Promise<string>;
}
