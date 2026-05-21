import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import yaml from "yaml";

export interface ApplyOptions {
  planId: string;
}

interface PlanChange {
  file: string;
  action: "create" | "modify" | "delete";
  content?: string;
  diff?: string;
}

interface YamlPlan {
  plan: {
    id: string;
    status: string;
    changes: PlanChange[];
  };
}

export async function runApply(opts: ApplyOptions): Promise<void> {
  const planPath = join(process.cwd(), ".alix", "plans", `${opts.planId}.yaml`);

  if (!existsSync(planPath)) {
    console.error(`Plan not found: ${opts.planId}`);
    process.exit(1);
  }

  const content = await readFile(planPath, "utf8");
  const plan: YamlPlan = yaml.parse(content);

  if (plan.plan.status === "applied") {
    console.error("Plan already applied.");
    process.exit(1);
  }

  console.log(`Applying plan ${opts.planId}...`);
  console.log(`  ${plan.plan.changes.length} changes\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const confirm = await rl.question("Proceed? [y/N]: ");
  rl.close();

  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled.");
    process.exit(0);
  }

  for (const change of plan.plan.changes) {
    switch (change.action) {
      case "create": {
        const fileDir = dirname(join(process.cwd(), change.file));
        await mkdir(fileDir, { recursive: true });
        await writeFile(join(process.cwd(), change.file), change.content ?? "");
        console.log(`  Created: ${change.file}`);
        break;
      }
      case "modify": {
        // Read existing file, apply diff
        const filePath = join(process.cwd(), change.file);
        if (!existsSync(filePath)) {
          console.log(`  Skipped (not found): ${change.file}`);
          continue;
        }
        let existingContent = await readFile(filePath, "utf8");
        if (change.diff) {
          // Apply + lines from diff
          for (const line of change.diff.split("\n")) {
            if (line.startsWith("+") && !line.startsWith("+++")) {
              existingContent += line.slice(1) + "\n";
            }
          }
        }
        await writeFile(filePath, existingContent);
        console.log(`  Modified: ${change.file}`);
        break;
      }
      case "delete": {
        if (existsSync(change.file)) {
          await rm(join(process.cwd(), change.file));
        }
        console.log(`  Deleted: ${change.file}`);
        break;
      }
    }
  }

  plan.plan.status = "applied";
  await writeFile(planPath, yaml.stringify(plan));

  console.log("\nPlan applied successfully.");
}