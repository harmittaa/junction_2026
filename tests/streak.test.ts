import { describe, expect, it } from "vitest";
import { calculateJar } from "@/domain/checkup";
import { formatDueBy, formatLongDate, formatShortDate, longestRun } from "@/domain/streak";
import { transactionSchema } from "@/shared/contracts";
import raw from "../data/demo-transactions.json";

const rows = raw.transactions.map(row => transactionSchema.parse(row));
const input = {
  rows,
  customerId: raw.customerId,
  referenceDate: "2026-09-16",
  corrections: {},
  limit: { amountCents: 220000, activeSince: "2026-02" },
};

describe("longestRun", () => {
  it("returns zero for an empty list", () => {
    expect(longestRun([])).toBe(0);
  });

  it("returns one for a single week", () => {
    expect(longestRun(["2026-09-02"])).toBe(1);
  });

  it("counts multiple check-ups in the same week as one week", () => {
    expect(longestRun(["2026-09-02", "2026-09-04"])).toBe(1);
  });

  it("handles a gap between weeks", () => {
    expect(longestRun(["2026-08-10", "2026-08-24"])).toBe(1);
  });

  it("returns the longest run across gaps and runs", () => {
    expect(longestRun(["2026-08-03", "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"])).toBe(4);
  });
});

describe("streak date formatting", () => {
  it("formats due by date in English with no year", () => {
    expect(formatDueBy("2026-09-14")).toBe("Due by Sunday 20 September");
  });

  it("formats short and long jar dates in English", () => {
    expect(formatShortDate("2026-09-02")).toBe("2 Sep");
    expect(formatLongDate("2026-09-02")).toBe("2 September");
    expect(formatShortDate("2026-09-23")).toBe("23 Sep");
    expect(formatLongDate("2026-09-23")).toBe("23 September");
  });
});

describe("calculateJar target amounts for demo dataset", () => {
  it("calculates exactly 217,214 cents for 2026-09-02", () => {
    const jar = calculateJar({ ...input, referenceDate: "2026-09-02" });
    expect(jar.leftCents).toBe(217214);
  });

  it("calculates exactly 153,801 cents for 2026-09-09", () => {
    const jar = calculateJar({ ...input, referenceDate: "2026-09-09" });
    expect(jar.leftCents).toBe(153801);
  });
});
