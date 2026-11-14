import { describe, expect, it } from "vitest";
import { formatDay, formatRange } from "@/domain/dates";

describe("date display", () => {
  it("shows Finnish day.month. without the year", () => {
    expect(formatDay("2026-09-01")).toBe("1.9.");
    expect(formatDay("2026-12-31T23:00:00Z")).toBe("31.12.");
    expect(formatRange("2026-09-01", "2026-09-16")).toBe("1.9. – 16.9.");
  });
});
