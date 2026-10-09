import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitActivityOptions = {
  maxCommits?: number;
  runGitLog?: () => Promise<string>;
};

export async function readGitActivity(root: string, options: GitActivityOptions = {}): Promise<Map<string, number>> {
  const maxCommits = options.maxCommits ?? 50;
  let output: string;

  try {
    output = options.runGitLog
      ? await options.runGitLog()
      : (await execFileAsync("git", ["log", `--max-count=${maxCommits}`, "--name-only", "--pretty=format:"], { cwd: root })).stdout;
  } catch {
    return new Map();
  }

  const activity = new Map<string, number>();
  for (const line of output.split("\n")) {
    const path = line.trim();
    if (!path || path.includes("\t")) continue;
    activity.set(path, (activity.get(path) ?? 0) + 1);
  }
  return activity;
}