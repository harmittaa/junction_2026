import { describe, expect, it } from "vitest";
import { formatDaysToSunday } from "@/components/checkup-visuals";

describe("formatDaysToSunday", () => {
  it("formats 0 as Sunday today", () => {
    expect(formatDaysToSunday(0)).toBe("Sunday today");
  });

  it("formats negative numbers as Sunday today", () => {
    expect(formatDaysToSunday(-1)).toBe("Sunday today");
  });

  it("formats 1 day to Sunday", () => {
    expect(formatDaysToSunday(1)).toBe("1 day to Sunday");
  });

  it("formats multiple days to Sunday", () => {
    expect(formatDaysToSunday(4)).toBe("4 days to Sunday");
  });
});
