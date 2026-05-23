import { runTask } from "../../run.js";
import { classifyTask, detectResearchDepth } from "../../task-classifier.js";

export async function research(args: string[]): Promise<void> {
  const query = args.join(" ").trim();
  if (!query) {
    console.error("Usage: alix research <query>");
    console.error("Example: alix research 'best practices for auth tokens'");
    process.exit(1);
  }

  const taskType = classifyTask(query);
  const depth = detectResearchDepth(query);

  console.log(`Research task: ${query}`);
  console.log(`Detected type: ${taskType}`);
  console.log(`Detected depth: ${depth}`);
  console.log();

  try {
    const result = await runTask(process.cwd(), query);
    if (!result.streamed) {
      console.log(result.summary);
    }
    console.log(`Session: ${result.sessionId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nError: ${msg}`);
    process.exit(1);
  }
}