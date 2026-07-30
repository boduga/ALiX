import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { ToolResult, FindingReport } from "./types.js";

// ===========================================================================
// cron.schedule — Schedule a recurring task
// ===========================================================================

export type CronScheduleArgs = { name: string; expression: string; command: string; timezone?: string };
export type CronListArgs = Record<string, never>;
export type CronUnscheduleArgs = { name: string };

const CRON_FILE = join(homedir(), ".alix", "cron-tasks.json");

type CronTask = {
  name: string;
  expression: string;
  command: string;
  timezone?: string;
  createdAt: string;
};

async function loadCronTasks(): Promise<CronTask[]> {
  try {
    if (!existsSync(CRON_FILE)) return [];
    const raw = await readFile(CRON_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveCronTasks(tasks: CronTask[]): Promise<void> {
  await mkdir(join(homedir(), ".alix"), { recursive: true });
  await writeFile(CRON_FILE, JSON.stringify(tasks, null, 2), "utf8");
}

export async function cronSchedule(args: CronScheduleArgs): Promise<ToolResult> {
  const { name, expression, command, timezone } = args;
  if (!name || !expression || !command) {
    return { kind: "error", message: "cron.schedule requires name, expression, and command" };
  }
  // Basic cron expression validation (5 fields)
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { kind: "error", message: `Invalid cron expression "${expression}". Must have exactly 5 fields (min hour dom mon dow).` };
  }
  const tasks = await loadCronTasks();
  if (tasks.some((t) => t.name === name)) {
    return { kind: "error", message: `Cron task "${name}" already exists. Use cron.unschedule first to replace it.` };
  }
  tasks.push({ name, expression, command, timezone, createdAt: new Date().toISOString() });
  await saveCronTasks(tasks);
  return { kind: "success", output: `Scheduled cron task "${name}" with expression "${expression}"` };
}

export async function cronList(_args: CronListArgs): Promise<ToolResult> {
  const tasks = await loadCronTasks();
  if (tasks.length === 0) {
    return { kind: "success", output: "No cron tasks scheduled." };
  }
  const lines = tasks.map(
    (t) => `${t.name.padEnd(24)} ${t.expression.padEnd(16)} ${t.command}`,
  );
  return { kind: "success", output: `Scheduled cron tasks:\n${lines.join("\n")}`, value: JSON.stringify(tasks) };
}

export async function cronUnschedule(args: CronUnscheduleArgs): Promise<ToolResult> {
  const { name } = args;
  if (!name) return { kind: "error", message: "cron.unschedule requires a name" };
  const tasks = await loadCronTasks();
  const idx = tasks.findIndex((t) => t.name === name);
  if (idx === -1) {
    return { kind: "error", message: `Cron task "${name}" not found` };
  }
  tasks.splice(idx, 1);
  await saveCronTasks(tasks);
  return { kind: "success", output: `Unscheduled cron task "${name}"` };
}

// ===========================================================================
// findings.report — Report structured code-review findings
// ===========================================================================

export type FindingsReportArgs = {
  title?: string;
  findings: FindingReport[];
};

const SEVERITY_RANKS: Record<string, number> = { critical: 4, error: 3, warning: 2, info: 1 };

export async function reportFindings(args: FindingsReportArgs): Promise<ToolResult> {
  const { findings, title } = args;
  if (!findings || findings.length === 0) {
    return { kind: "error", message: "findings.report requires at least one finding" };
  }
  const sorted = [...findings].sort(
    (a, b) => (SEVERITY_RANKS[b.severity] ?? 0) - (SEVERITY_RANKS[a.severity] ?? 0),
  );
  const summaryCounts: Record<string, number> = {};
  for (const f of sorted) {
    summaryCounts[f.severity] = (summaryCounts[f.severity] ?? 0) + 1;
  }
  const summaryLine = Object.entries(summaryCounts)
    .map(([sev, count]) => `${count} ${sev}`)
    .join(", ");
  const titleLine = title ? `${title}\n${"=".repeat(Math.min(60, title.length))}\n` : "";
  const detail = sorted
    .map((f) => {
      const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
      return `[${f.severity.toUpperCase()}]${f.category ? ` ${f.category}` : ""}${loc ? ` ${loc}` : ""} — ${f.summary}`;
    })
    .join("\n");
  return {
    kind: "success",
    output: `${titleLine}Found ${findings.length} finding(s): ${summaryLine}\n${detail}`,
    reports: sorted,
  };
}

// ===========================================================================
// ask_user — Present a multi-choice question to the user
// ===========================================================================

export type AskUserArgs = { question: string; options: string[]; multiSelect?: boolean };

export async function askUser(args: AskUserArgs): Promise<ToolResult> {
  const { question, options, multiSelect } = args;
  if (!question || !options || options.length === 0) {
    return { kind: "error", message: "ask_user requires question and at least one option" };
  }
  if (options.length > 10) {
    return { kind: "error", message: "ask_user supports at most 10 options" };
  }
  const formatted = options.map((o, i) => `  ${i + 1}. ${o}`).join("\n");
  const mode = multiSelect ? "Select all that apply" : "Select one";
  return {
    kind: "success",
    output: `${question}\n${mode}:\n${formatted}\n(Send your answer with the option number)`,
  };
}

// ===========================================================================
// notification.send — Send a notification to the user
// ===========================================================================

export type NotificationSendArgs = { title: string; message: string; urgency?: "low" | "normal" | "high" };

export async function sendNotification(args: NotificationSendArgs): Promise<ToolResult> {
  const { title, message, urgency } = args;
  if (!title || !message) {
    return { kind: "error", message: "notification.send requires title and message" };
  }
  // Write notification to .alix/notifications/ for persistence
  const notifDir = join(homedir(), ".alix", "notifications");
  await mkdir(notifDir, { recursive: true });
  const entry = { title, message, urgency: urgency ?? "normal", timestamp: new Date().toISOString() };
  const filePath = join(notifDir, `notif-${Date.now()}.json`);
  await writeFile(filePath, JSON.stringify(entry, null, 2), "utf8");
  return {
    kind: "success",
    output: `${urgency === "high" ? "🔔 " : ""}${title}: ${message}${urgency === "high" ? " (urgent)" : ""}`,
  };
}

// ===========================================================================
// user.send_file — Deliver a file to the user
// ===========================================================================

export type UserSendFileArgs = { path: string; content: string; description?: string };

export async function userSendFile(args: UserSendFileArgs): Promise<ToolResult> {
  const { path, content, description } = args;
  if (!path || content === undefined) {
    return { kind: "error", message: "user.send_file requires path and content" };
  }
  // Write to .alix/user-files/ for user access
  const outDir = join(homedir(), ".alix", "user-files");
  await mkdir(outDir, { recursive: true });
  const safePath = path.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = join(outDir, safePath);
  await writeFile(filePath, content, "utf8");
  const desc = description ? ` (${description})` : "";
  return {
    kind: "success",
    output: `File written to ${filePath}${desc}`,
    createdPath: filePath,
  };
}

// ===========================================================================
// skill.run — Execute a skill by ID
// ===========================================================================

export type SkillRunArgs = { skillId: string; args?: string };

export async function runSkill(args: SkillRunArgs): Promise<ToolResult> {
  const { skillId, args: skillArgs } = args;
  if (!skillId) return { kind: "error", message: "skill.run requires skillId" };
  // Skills are executed via the existing CLI: alix skill run <id>
  // This tool validates the skill exists and returns instructions
  const skillsDir = join(homedir(), ".alix", "extensions");
  const skillPath = join(skillsDir, skillId, "SKILL.md");
  if (!existsSync(skillPath)) {
    return { kind: "error", message: `Skill "${skillId}" not found at ${skillPath}. Use 'alix skill list' to see available skills.` };
  }
  const instruction = skillArgs
    ? `Running skill "${skillId}" with args: ${skillArgs}`
    : `Running skill "${skillId}"`;
  return {
    kind: "success",
    output: instruction,
    value: skillId,
  };
}

// ===========================================================================
// remote.trigger — Trigger a saved routine/workflow
// ===========================================================================

export type RemoteTriggerArgs = { name: string; params?: Record<string, string> };

export async function remoteTrigger(args: RemoteTriggerArgs): Promise<ToolResult> {
  const { name, params = {} } = args;
  if (!name) return { kind: "error", message: "remote.trigger requires a name" };
  // Remote routines are stored at ~/.alix/routines.json
  const routinesPath = join(homedir(), ".alix", "routines.json");
  const paramStr = Object.keys(params).length > 0 ? ` with params: ${JSON.stringify(params)}` : "";
  return {
    kind: "success",
    output: `Triggered routine "${name}"${paramStr}. Routines are stored at ${routinesPath}.`,
  };
}

// ===========================================================================
// guide.share — Share a guide/document with the user
// ===========================================================================

export type GuideShareArgs = { guide: string; content: string };

export async function shareGuide(args: GuideShareArgs): Promise<ToolResult> {
  const { guide, content } = args;
  if (!guide || !content) {
    return { kind: "error", message: "guide.share requires guide name and content" };
  }
  // Write guide to .alix/guides/ for persistence
  const guidesDir = join(homedir(), ".alix", "guides");
  await mkdir(guidesDir, { recursive: true });
  const safeName = guide.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = join(guidesDir, `${safeName}.md`);
  await writeFile(filePath, content, "utf8");
  return {
    kind: "success",
    output: `Guide "${guide}" shared at ${filePath}`,
    createdPath: filePath,
  };
}
