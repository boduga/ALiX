/**
 * src/planning/plan-task.ts — Structured plan task model + parser.
 *
 * Task 5 (action-based routing): parses markdown plan content into structured
 * PlanTask records and renders a stable PlanTaskList sidecar.
 *
 * Pure functions — no I/O. Persistence happens in plan-phase.ts.
 *
 * The parser is SECTION-SCOPED: it only collects tasks from the
 * planner's `## Changes` block (one task per top-level bullet) and
 * creates a single verification task from the `## Verification` block.
 * All other sections (Summary, Risk Assessment, Primary Files, etc.)
 * are intentionally ignored. This avoids mistaking metadata bullets
 * (e.g. "**Risk level:** low") for actionable tasks.
 *
 * The parser tolerates three markdown task list shapes inside `## Changes`:
 *   1. `- First task title`
 *   2. `- [ ] First task title`
 *   3. `1. First task title`
 *
 * Each task's detail is any indented sub-bullet block that follows it
 * until the next sibling task or end of section.
 *
 * ID format: `${sessionId}:task:${index}` (1-based index).
 *
 * @module
 */

export type PlanTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "skipped";

export interface PlanTask {
  /** Stable ID: `${sessionId}:task:${index}` (1-based). */
  id: string;
  /** 1-based ordinal within the parsed task list. */
  index: number;
  /** First non-whitespace line of the task bullet (or "Verify: ..." for verification). */
  title: string;
  /** Optional indented sub-bullets body. */
  detail?: string;
  /** Initial state is always "pending". Callers update in-place. */
  status: PlanTaskStatus;
}

export interface PlanTaskList {
  schemaVersion: 1;
  sessionId: string;
  /** Free-text summary, currently empty string (plan summary is in the .md file). */
  summary: string;
  tasks: PlanTask[];
}

/**
 * Internal: a markdown section parsed from `## Heading` lines.
 */
interface Section {
  heading: string;
  body: string;
}

/**
 * Internal: split markdown into `## Heading` sections. Body is the
 * text between this heading and the next `## Heading` (or EOF).
 */
function parseSections(content: string): Section[] {
  const sections: Section[] = [];
  const lines = content.split(/\r?\n/);
  let current: Section | null = null;
  for (const line of lines) {
    const headingMatch = /^##\s+(.+?)\s*$/u.exec(line);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[1]!.trim(), body: "" };
    } else if (current) {
      current.body += current.body ? "\n" + line : line;
    }
  }
  if (current) sections.push(current);
  return sections;
}

/**
 * Internal: parse top-level bullets from a section body into PlanTask
 * records. Sub-bullets (greater indent) become `detail`.
 */
function parseBulletTasks(
  body: string,
  sessionId: string,
  startIndex: number,
): { tasks: PlanTask[]; nextIndex: number } {
  const lines = body.split(/\r?\n/);
  const tasks: PlanTask[] = [];
  let index = startIndex;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const bulletMatch = /^(\s*(?:[-*]|\d+\.)\s+)(\[[ xX]\]\s+)?(.+?)\s*$/u.exec(line);
    if (!bulletMatch) {
      i++;
      continue;
    }
    const indent = /^(\s*)/.exec(line)![1]!.length;
    if (indent > 0) {
      i++;
      continue;
    }
    const title = bulletMatch[3]!.trim();
    if (!title) {
      i++;
      continue;
    }
    index++;
    const task: PlanTask = {
      id: `${sessionId}:task:${index}`,
      index,
      title,
      status: "pending",
    };
    // Collect indented sub-bullets as detail until the next top-level
    // bullet or end of section.
    const detailLines: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const sub = lines[j]!;
      if (sub.trim() === "") break;
      const subIndent = /^(\s*)/.exec(sub)![1]!.length;
      if (subIndent <= indent) break;
      detailLines.push(sub);
      j++;
    }
    if (detailLines.length > 0) {
      task.detail = detailLines.join("\n");
    }
    tasks.push(task);
    i = j;
  }
  return { tasks, nextIndex: index };
}

/**
 * Parse markdown plan content into structured PlanTask records.
 *
 * Section-scoped: only collects tasks from `## Changes` (one task per
 * top-level bullet) and creates a single verification task from
 * `## Verification`. All other sections (Summary, Risk Assessment,
 * Primary Files, Related Tests, etc.) are ignored.
 *
 * Pure function — no I/O. Returns an empty list when no `## Changes`
 * or `## Verification` sections are present.
 */
export function parsePlanTasks(
  planContent: string,
  sessionId: string,
): PlanTask[] {
  const sections = parseSections(planContent);
  const tasks: PlanTask[] = [];
  let index = 0;

  for (const section of sections) {
    const headingLower = section.heading.toLowerCase();
    if (headingLower === "changes") {
      // Each top-level bullet in `## Changes` becomes a task.
      const { tasks: changeTasks, nextIndex } = parseBulletTasks(
        section.body,
        sessionId,
        index,
      );
      tasks.push(...changeTasks);
      index = nextIndex;
    } else if (headingLower === "verification") {
      // One synthetic task from the verification body.
      const body = section.body.trim();
      if (!body) continue;
      const firstLine = body.split(/\r?\n/)[0]!.trim();
      // Strip any leading bullet marker from the title source.
      const titleSource = firstLine.replace(/^[-*]\s+/u, "").trim();
      if (!titleSource) continue;
      index++;
      tasks.push({
        id: `${sessionId}:task:${index}`,
        index,
        title: `Verify: ${titleSource}`,
        detail: body,
        status: "pending",
      });
    }
    // All other sections (Summary, Risk Assessment, Primary Files, etc.)
    // are intentionally skipped.
  }

  return tasks;
}

/**
 * Build a PlanTaskList from parsed tasks. Pure helper that locks in
 * the schemaVersion and default summary.
 */
export function buildPlanTaskList(
  sessionId: string,
  tasks: readonly PlanTask[],
): PlanTaskList {
  return {
    schemaVersion: 1,
    sessionId,
    summary: "",
    tasks: [...tasks],
  };
}
