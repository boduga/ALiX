import { CommandDiscovery } from "./command-discovery.js";
import { CommandRunner } from "./command-runner.js";
import { VerificationReporter } from "./verification-reporter.js";

export interface PipelineResult {
  success: boolean;
  partial: boolean;
  discovered: string[];
  executed: { name: string; success: boolean }[];
  reporter: VerificationReporter;
  error?: string;
}

export interface VerificationPipelineOptions {
  cwd?: string;
  stopOnFailure?: boolean;
  timeout?: number;
  verbose?: boolean;
}

export class VerificationPipeline {
  private discovery: CommandDiscovery;
  private runner: CommandRunner;
  private options: Required<VerificationPipelineOptions>;

  constructor(options: VerificationPipelineOptions = {}) {
    this.options = {
      cwd: options.cwd ?? process.cwd(),
      stopOnFailure: options.stopOnFailure ?? false,
      timeout: options.timeout ?? 60000,
      verbose: options.verbose ?? false,
    };

    this.discovery = new CommandDiscovery(this.options.cwd);
    this.runner = new CommandRunner(this.options.timeout);
  }

  async run(): Promise<PipelineResult> {
    const reporter = new VerificationReporter();

    try {
      const commands = await this.discovery.findTestCommands();
      const discovered = commands.map(c => c.name);

      let stopOnFailure = false;
      const executed: { name: string; success: boolean }[] = [];

      for (const cmd of commands) {
        if (stopOnFailure) {
          reporter.addResult({
            name: cmd.name,
            result: { success: false, stdout: "", stderr: "", exitCode: -1, durationMs: 0, error: "skipped" },
          });
          executed.push({ name: cmd.name, success: false });
          continue;
        }

        if (this.options.verbose) {
          console.log(`Running: ${cmd.command}`);
        }

        const result = await this.runner.run(cmd.command, { timeout: this.options.timeout });

        reporter.addResult({
          name: cmd.name,
          result,
        });

        executed.push({ name: cmd.name, success: result.success });

        if (!result.success && this.options.stopOnFailure) {
          stopOnFailure = true;
        }
      }

      const summary = reporter.getSummary();

      return {
        success: summary.failed === 0,
        partial: summary.failed > 0 && summary.passed > 0,
        discovered,
        executed,
        reporter,
      };
    } catch (error: any) {
      return {
        success: false,
        partial: false,
        discovered: [],
        executed: [],
        reporter,
        error: error.message,
      };
    }
  }
}