import { describe, expect, it, vi } from "vitest";
import { parseDuration, parseSchedule } from "./parse-schedule";

describe("parseDuration", () => {
  it("parses m / h / d", () => {
    expect(parseDuration("30m")).toBe(30);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("1d")).toBe(1440);
    expect(parseDuration("90 m")).toBe(90);
  });

  it("rejects invalid durations", () => {
    expect(() => parseDuration("30")).toThrow();
    expect(() => parseDuration("abc")).toThrow();
    expect(() => parseDuration("0m")).toThrow();
  });
});

describe("parseSchedule", () => {
  it("parses duration as one-shot from now", () => {
    const before = Date.now();
    const schedule = parseSchedule("30m");
    const runAt = new Date(schedule.kind === "once" ? schedule.runAt : "").getTime();
    expect(schedule.kind).toBe("once");
    expect(runAt).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(runAt).toBeLessThanOrEqual(before + 30 * 60_000 + 2_000);
  });

  it("parses every X as interval in hours when whole hours", () => {
    expect(parseSchedule("every 2h")).toEqual({ kind: "interval", every: 2, unit: "hours" });
  });

  it("parses every X as interval in minutes otherwise", () => {
    expect(parseSchedule("every 30m")).toEqual({ kind: "interval", every: 30, unit: "minutes" });
    expect(parseSchedule("every 1d")).toEqual({ kind: "interval", every: 24, unit: "hours" });
  });

  it("rejects oversized non-whole-hour intervals", () => {
    expect(() => parseSchedule("every 1501m")).toThrow(/cron/);
  });

  it("parses 5-field cron expressions", () => {
    expect(parseSchedule("0 9 * * *")).toEqual({ kind: "cron", expr: "0 9 * * *" });
    expect(parseSchedule("*/15 9-18 * * 1-5")).toEqual({ kind: "cron", expr: "*/15 9-18 * * 1-5" });
  });

  it("rejects cron expressions with year field", () => {
    expect(() => parseSchedule("0 9 * * * 2027")).toThrow(/年字段/);
  });

  it("rejects invalid cron expressions", () => {
    expect(() => parseSchedule("99 99 * * *")).toThrow(/无效 cron/);
    expect(() => parseSchedule("0 9 * *")).toThrow(/无法识别/);
  });

  it("parses ISO timestamp as one-shot", () => {
    const schedule = parseSchedule("2026-09-06T09:00");
    expect(schedule.kind).toBe("once");
    if (schedule.kind === "once") {
      expect(new Date(schedule.runAt).getTime()).toBe(new Date(2026, 8, 6, 9, 0, 0).getTime());
    }
  });

  it("parses date-only as one-shot", () => {
    const schedule = parseSchedule("2026-09-06");
    expect(schedule.kind).toBe("once");
    if (schedule.kind === "once") {
      expect(new Date(schedule.runAt).getDate()).toBe(6);
    }
  });

  it("rejects empty or unrecognizable input", () => {
    expect(() => parseSchedule("")).toThrow(/不能为空/);
    expect(() => parseSchedule("明天早上")).toThrow(/无法识别/);
  });

  it("strips surrounding whitespace", () => {
    expect(parseSchedule("  every 1h  ")).toEqual({ kind: "interval", every: 1, unit: "hours" });
  });

  it("keeps Date.now stable for once-from-now tests", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-06T00:00:00.000Z").getTime());
    try {
      const schedule = parseSchedule("1d");
      expect(schedule.kind).toBe("once");
      if (schedule.kind === "once") expect(schedule.runAt).toBe("2026-09-07T00:00:00.000Z");
    } finally {
      spy.mockRestore();
    }
  });
});
