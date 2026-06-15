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

/**
 * Model-powered run synthesizer that produces a human-readable final summary.
 * Default implementation concatenates results into a summary block;
 * a future integration with an LLM service will provide richer synthesis.
 */
export class ModelRunSynthesizer implements RunSynthesizer {
  async synthesize(input: SynthesizeInput): Promise<string> {
    const lines: string[] = [];
    lines.push(`# Synthesis: ${input.rootGoal}`);
    lines.push(`Run: ${input.runId}`);
    lines.push(`Workers: ${input.workerResults.length}`);
    for (const wr of input.workerResults) {
      lines.push(`\n## ${wr.taskLabel} (${wr.workerId})`);
      lines.push(`Status: ${wr.status}`);
      if (wr.summary) lines.push(wr.summary);
      if (wr.error) lines.push(`Error: ${wr.error}`);
    }
    return lines.join("\n");
  }
}
