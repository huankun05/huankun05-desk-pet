import { describe, expect, it } from "vitest";
import { isInSilentWindow, parseTimeOfDay } from "./silent-window";

describe("parseTimeOfDay", () => {
  it("parses valid HH:mm into minutes since midnight", () => {
    expect(parseTimeOfDay("00:00")).toBe(0);
    expect(parseTimeOfDay("08:30")).toBe(510);
    expect(parseTimeOfDay("23:59")).toBe(1439);
  });

  it("returns null for invalid input", () => {
    expect(parseTimeOfDay("")).toBeNull();
    expect(parseTimeOfDay("   ")).toBeNull();
    expect(parseTimeOfDay("8:30")).toBeNull();
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("08:60")).toBeNull();
    expect(parseTimeOfDay("abc")).toBeNull();
  });
});

describe("isInSilentWindow", () => {
  const at = (hhmm: string): Date => {
    const [hours, minutes] = hhmm.split(":").map(Number);
    return new Date(2026, 5, 22, hours, minutes);
  };

  it("returns false when either bound is unset or invalid", () => {
    expect(isInSilentWindow({ start: "", end: "06:00" }, at("03:00"))).toBe(false);
    expect(isInSilentWindow({ start: "23:00", end: "" }, at("03:00"))).toBe(false);
    expect(isInSilentWindow({ start: "bad", end: "06:00" }, at("03:00"))).toBe(false);
  });

  it("returns false for an empty window (start === end)", () => {
    expect(isInSilentWindow({ start: "08:00", end: "08:00" }, at("08:00"))).toBe(false);
  });

  it("matches within a same-day window", () => {
    const window = { start: "22:00", end: "23:30" };
    expect(isInSilentWindow(window, at("21:59"))).toBe(false);
    expect(isInSilentWindow(window, at("22:00"))).toBe(true);
    expect(isInSilentWindow(window, at("23:29"))).toBe(true);
    expect(isInSilentWindow(window, at("23:30"))).toBe(false);
  });

  it("matches across midnight", () => {
    const window = { start: "23:00", end: "06:00" };
    expect(isInSilentWindow(window, at("22:59"))).toBe(false);
    expect(isInSilentWindow(window, at("23:00"))).toBe(true);
    expect(isInSilentWindow(window, at("00:01"))).toBe(true);
    expect(isInSilentWindow(window, at("05:59"))).toBe(true);
    expect(isInSilentWindow(window, at("06:00"))).toBe(false);
    expect(isInSilentWindow(window, at("12:00"))).toBe(false);
  });
});
