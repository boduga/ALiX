import { describe, it, expect } from "vitest";
import {
  validateScheduleSpec,
  nextRunAfter,
  describeSchedule,
  withinExpiryWindow,
  parseTime,
  MIN_INTERVAL_MIN,
  MAX_EXPIRY_DAYS,
} from "../../src/schedule/schedule-spec.js";

describe("validateScheduleSpec", () => {
  it("accepts daily, weekly, every", () => {
    expect(validateScheduleSpec({ kind: "daily", time: "02:30" })).toEqual({
      ok: true, spec: { kind: "daily", time: "02:30" },
    });
    expect(validateScheduleSpec({ kind: "weekly", days: ["Mon", "Wed"], time: "09:00" })).toEqual({
      ok: true, spec: { kind: "weekly", days: ["Mon", "Wed"], time: "09:00" },
    });
    expect(validateScheduleSpec({ kind: "every", minutes: 15 })).toEqual({
      ok: true, spec: { kind: "every", minutes: 15 },
    });
  });

  it("rejects malformed times, days, and intervals", () => {
    expect(validateScheduleSpec({ kind: "daily", time: "2:30" }).ok).toBe(false);
    expect(validateScheduleSpec({ kind: "daily", time: "24:00" }).ok).toBe(false);
    expect(validateScheduleSpec({ kind: "weekly", days: [], time: "09:00" }).ok).toBe(false);
    expect(validateScheduleSpec({ kind: "weekly", days: ["Funday"], time: "09:00" }).ok).toBe(false);
    expect(validateScheduleSpec({ kind: "weekly", days: ["Mon", "Mon"], time: "09:00" }).ok).toBe(false);
    expect(validateScheduleSpec({ kind: "every", minutes: MIN_INTERVAL_MIN - 1 }).ok).toBe(false);
    expect(validateScheduleSpec({ kind: "every", minutes: 15.5 }).ok).toBe(false);
    expect(validateScheduleSpec({ kind: "hourly" }).ok).toBe(false);
    expect(validateScheduleSpec(null).ok).toBe(false);
  });
});

describe("nextRunAfter", () => {
  it("daily picks today when the time is still ahead, else tomorrow", () => {
    const spec = { kind: "daily" as const, time: "10:00" };
    const before = new Date(2026, 8, 19, 9, 0, 0);
    const after = new Date(2026, 8, 19, 11, 0, 0);
    const today = nextRunAfter(spec, before);
    expect([today.getDate(), today.getHours(), today.getMinutes()]).toEqual([19, 10, 0]);
    const tomorrow = nextRunAfter(spec, after);
    expect([tomorrow.getDate(), tomorrow.getHours()]).toEqual([20, 10]);
  });

  it("weekly lands on the next allowed weekday", () => {
    // 2026-09-19 is a Saturday.
    const spec = { kind: "weekly" as const, days: ["Mon", "Wed"] as const, time: "09:00" };
    const sat = new Date(2026, 8, 19, 12, 0, 0);
    const next = nextRunAfter({ kind: "weekly", days: [...spec.days], time: spec.time }, sat);
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getDate()).toBe(21);
  });

  it("every adds the interval", () => {
    const base = new Date(2026, 8, 19, 9, 0, 0);
    const next = nextRunAfter({ kind: "every", minutes: 15 }, base);
    expect(next.getTime() - base.getTime()).toBe(15 * 60_000);
  });
});

describe("withinExpiryWindow", () => {
  it("accepts near future and rejects past/too far/malformed", () => {
    const now = new Date(2026, 8, 19, 12, 0, 0);
    expect(withinExpiryWindow("2026-09-20", now)).toBe(true);
    expect(withinExpiryWindow("2026-09-18", now)).toBe(false);
    const tooFar = new Date(now.getTime() + (MAX_EXPIRY_DAYS + 2) * 86_400_000);
    const y = tooFar.getFullYear(), m = String(tooFar.getMonth() + 1).padStart(2, "0"), d = String(tooFar.getDate()).padStart(2, "0");
    expect(withinExpiryWindow(`${y}-${m}-${d}`, now)).toBe(false);
    expect(withinExpiryWindow("nope", now)).toBe(false);
  });
});

describe("describeSchedule / parseTime", () => {
  it("renders and parses", () => {
    expect(describeSchedule({ kind: "daily", time: "02:30" })).toBe("daily at 02:30");
    expect(describeSchedule({ kind: "weekly", days: ["Mon", "Wed"], time: "09:00" })).toBe("Mon,Wed at 09:00");
    expect(describeSchedule({ kind: "every", minutes: 15 })).toBe("every 15 min");
    expect(parseTime("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseTime("24:00")).toBeNull();
  });
});
