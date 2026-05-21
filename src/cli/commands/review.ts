import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import yaml from "yaml";

export interface ReviewOptions {
  planId: string;
}

interface PlanChange {
  file: string;
  action: "create" | "modify" | "delete";
  description: string;
  diff?: string;
}

interface YamlPlan {
  plan: {
    id: string;
    created: string;
    task: string;
    status: string;
    intent: { summary: string; type: string; acceptance_criteria: string[] };
    changes: PlanChange[];
    risk: { level: string; reasons: string[]; affected_files: number; new_files: number };
  };
}

const RISK_COLORS: Record<string, string> = {
  low: "\x1b[32m",
  medium: "\x1b[33m",
  high: "\x1b[31m",
};

export async function runReview(opts: ReviewOptions): Promise<void> {
  const planPath = join(process.cwd(), ".alix", "plans", `${opts.planId}.yaml`);

  if (!existsSync(planPath)) {
    console.error(`Plan not found: ${opts.planId}`);
    process.exit(1);
  }

  const content = await readFile(planPath, "utf8");
  const plan: YamlPlan = yaml.parse(content);

  console.log(`\nPlan: ${plan.plan.task}`);
  console.log(`Status: ${plan.plan.status}`);

  const riskColor = RISK_COLORS[plan.plan.risk.level] ?? "";
  const reset = "\x1b[0m";
  console.log(`Risk: ${riskColor}${plan.plan.risk.level}${reset}`);

  console.log(`\nChanges (${plan.plan.changes.length} files):\n`);

  for (const change of plan.plan.changes) {
    const actionLabel = change.action.toUpperCase().padEnd(8);
    console.log(`  ${actionLabel} ${change.file}`);
    console.log(`           ${change.description}`);
    if (change.diff) {
      const lines = change.diff.split("\n").slice(0, 5);
      for (const line of lines) {
        console.log(`    ${line}`);
      }
      if (change.diff.split("\n").length > 5) {
        console.log("    ...");
      }
    }
    console.log();
  }

  if (plan.plan.risk.reasons?.length > 0) {
    console.log("Risk reasons:");
    for (const reason of plan.plan.risk.reasons) {
      console.log(`  - ${reason}`);
    }
    console.log();
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Approve, Reject, or Exit? [A/r/E]: ");
  rl.close();

  if (answer.toLowerCase() === "a") {
    plan.plan.status = "approved";
    await writeFile(planPath, yaml.stringify(plan));
    console.log(`\nPlan approved. Run \`alix apply ${opts.planId}\` to apply.`);
  } else if (answer.toLowerCase() === "r") {
    plan.plan.status = "rejected";
    await writeFile(planPath, yaml.stringify(plan));
    console.log("\nPlan rejected.");
  }
}