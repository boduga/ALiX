import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type VerificationCheck = {
  command: string;
  reason: string;
};

export type VerificationResult = {
  status: "passed" | "failed" | "not_run";
  command?: string;
  output?: string;
};

export async function discoverVerification(root: string): Promise<VerificationCheck[]> {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return [];
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { scripts?: Record<string, string> };
  if (pkg.scripts?.test) return [{ command: "npm test", reason: "package.json defines test script" }];
  return [];
}

export async function runVerification(root: string, check: VerificationCheck): Promise<VerificationResult> {
  return new Promise((resolve) => {
    const child = spawn(check.command, { cwd: root, shell: true });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      resolve({ status: code === 0 ? "passed" : "failed", command: check.command, output });
    });
  });
}
