/**
 * A stage in the context compilation pipeline.
 * Each stage transforms input to output, optionally caching results.
 */
export interface ContextStage<Input, Output> {
  /** Human-readable name for logging/debugging */
  name: string;
  /** Process the input and produce output */
  process(input: Input): Promise<Output>;
}

/**
 * Context compilation pipeline.
 * Runs stages in order, passing each stage's output to the next.
 */
export class ContextPipeline {
  private stages: ContextStage<unknown, unknown>[] = [];

  constructor(stages: ContextStage<unknown, unknown>[] = []) {
    this.stages = stages;
  }

  /** Add a stage to the pipeline */
  addStage(stage: ContextStage<unknown, unknown>): this {
    this.stages.push(stage);
    return this;
  }

  /** Run all stages in sequence */
  async run(input: unknown): Promise<unknown> {
    let result = input;
    for (const stage of this.stages) {
      result = await stage.process(result);
    }
    return result;
  }

  /** Get stage names for debugging */
  get stageNames(): string[] {
    return this.stages.map(s => s.name);
  }
}