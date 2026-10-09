/**
 * schedule-spec.ts — the schedule vocabulary for agent-proposed jobs.
 *
 * Pure, side-effect-free: validation, description, and next-run computation.
 * Deliberately a STRUCTURED spec (not a raw cron/OnCalendar string) so the
 * minimum interval and the day set are enforceable before anything is stored.
 * All times are LOCAL, matching how a human reads a clock.
 */

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Day = (typeof DAYS)[number];

/** Hard floor on `every` so a proposal cannot busy-loop the daemon. */
export const MIN_INTERVAL_MIN = 5;
/** Every schedule must expire; this is the furthest allowed horizon. */
export const MAX_EXPIRY_DAYS = 30;
/** Cap on active scheduled jobs, so a compromised session cannot flood the queue. */
export const MAX_ACTIVE_JOBS = 20;

export type ScheduleSpec =
  | { kind: "daily"; time: string }
  | { kind: "weekly"; days: Day[]; time: string }
  | { kind: "every"; minutes: number };

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse "HH:MM" (24h, local) into hour/minute. Null when malformed. */
export function parseTime(time: string): { hour: number; minute: number } | null {
  const m = TIME_RE.exec(time);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function isDay(value: unknown): value is Day {
  return typeof value === "string" && (DAYS as readonly string[]).includes(value);
}

export type SpecValidation =
  | { ok: true; spec: ScheduleSpec }
  | { ok: false; error: string };

/** Validate an untrusted schedule value into a ScheduleSpec (or an error). */
export function validateScheduleSpec(input: unknown): SpecValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "schedule must be an object" };
  }
  const s = input as Record<string, unknown>;
  const kind = s.kind;
  if (kind === "daily") {
    if (typeof s.time !== "string" || !parseTime(s.time)) {
      return { ok: false, error: "daily schedule needs time as HH:MM (24h)" };
    }
    return { ok: true, spec: { kind: "daily", time: s.time } };
  }
  if (kind === "weekly") {
    if (typeof s.time !== "string" || !parseTime(s.time)) {
      return { ok: false, error: "weekly schedule needs time as HH:MM (24h)" };
    }
    if (!Array.isArray(s.days) || s.days.length < 1 || s.days.length > 7) {
      return { ok: false, error: "weekly schedule needs 1..7 days" };
    }
    const days = s.days.filter(isDay);
    if (days.length !== s.days.length) {
      return { ok: false, error: `days must be one of ${DAYS.join(", ")}` };
    }
    if (new Set(days).size !== days.length) {
      return { ok: false, error: "days must not repeat" };
    }
    return { ok: true, spec: { kind: "weekly", days, time: s.time } };
  }
  if (kind === "every") {
    const minutes = s.minutes;
    if (typeof minutes !== "number" || !Number.isInteger(minutes)) {
      return { ok: false, error: "every schedule needs integer minutes" };
    }
    if (minutes < MIN_INTERVAL_MIN || minutes > 1440) {
      return { ok: false, error: `minutes must be ${MIN_INTERVAL_MIN}..1440` };
    }
    return { ok: true, spec: { kind: "every", minutes } };
  }
  return { ok: false, error: 'schedule kind must be "daily", "weekly", or "every"' };
}

/** Human-readable description, e.g. "daily at 02:30" / "Mon,Wed at 09:00" / "every 15 min". */
export function describeSchedule(spec: ScheduleSpec): string {
  switch (spec.kind) {
    case "daily":
      return `daily at ${spec.time}`;
    case "weekly":
      return `${spec.days.join(",")} at ${spec.time}`;
    case "every":
      return `every ${spec.minutes} min`;
  }
}

const JS_DAY_TO_NAME: Day[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Next occurrence strictly after `after`. Local time. */
export function nextRunAfter(spec: ScheduleSpec, after: Date): Date {
  if (spec.kind === "every") {
    return new Date(after.getTime() + spec.minutes * 60_000);
  }
  const { hour, minute } = parseTime(spec.time)!;
  if (spec.kind === "daily") {
    const candidate = new Date(after);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() <= after.getTime()) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }
  // weekly: scan the next 8 days for the first allowed weekday at the target time.
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(after);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() <= after.getTime()) continue;
    if (spec.days.includes(JS_DAY_TO_NAME[candidate.getDay()])) return candidate;
  }
  // Unreachable for a validated spec (days is non-empty), but fail safe.
  const fallback = new Date(after);
  fallback.setDate(fallback.getDate() + 7);
  fallback.setHours(hour, minute, 0, 0);
  return fallback;
}

/**
 * True when `dateStr` (YYYY-MM-DD) is in the future and within the horizon.
 * `now` is injectable for deterministic tests.
 */
export function withinExpiryWindow(dateStr: string, now: Date = new Date()): boolean {
  if (!DATE_RE.test(dateStr)) return false;
  const end = Date.parse(`${dateStr}T23:59:59`);
  if (!Number.isFinite(end)) return false;
  return end > now.getTime() && end <= now.getTime() + MAX_EXPIRY_DAYS * 86_400_000;
}

/**
 * The next run after `now`, preserving phase for `every` schedules.
 *
 * For `daily`/`weekly` this is just `nextRunAfter(spec, now)`. For `every`,
 * stepping from the PREVIOUS scheduled time keeps the interval aligned; if
 * the daemon was down past several windows, it skips the missed ones rather
 * than bursting (no catch-up storm), landing on the first future slot.
 */
export function advanceNextRun(spec: ScheduleSpec, previous: Date, now: Date): Date {
  if (spec.kind !== "every") return nextRunAfter(spec, now);
  const step = spec.minutes * 60_000;
  let t = previous.getTime() + step;
  if (t <= now.getTime()) {
    const missed = Math.floor((now.getTime() - t) / step) + 1;
    t += missed * step;
  }
  return new Date(t);
}
