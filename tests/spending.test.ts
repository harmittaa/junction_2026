import { describe, expect, it } from "vitest";
import { calculateSpending, percentageScenario } from "@/domain/spending";
import { transactionSchema, requestSchema } from "@/shared/contracts";
import raw from "../data/demo-transactions.json";

const rows = raw.transactions.map(row => transactionSchema.parse(row));
const query = { category: "Groceries", start: "2026-08-01", end: "2026-08-31" };
describe("source-backed spending", () => {
  it("reconciles August category totals and preserves the amount after a correction", () => {
    const grocery = calculateSpending(rows, raw.customerId, query, {}, "2026-09-01");
    expect(grocery.totalCents).toBe(111106); // Independently reconciled from CSV with Decimal.
    expect(grocery.evidence.map(row => row.sourceRow)).toEqual([2898292, 2898294, 2898295, 2898302, 2898308, 2898310, 2898311, 2898322, 2898326, 2898329, 2898330, 2898335, 2898340, 2898342, 2898348, 2898349]);
    const corrected = calculateSpending(rows, raw.customerId, query, { "row-2898292": "regular" }, "2026-09-01");
    expect(corrected.totalCents).toBe(111106);
    expect(corrected.baskets).toEqual({ regular: 7990, unexpected: 0, everyday: 103116 });
    expect(calculateSpending(rows, raw.customerId, { ...query, category: "Utilities" }, {}, "2026-09-01").totalCents).toBe(10040);
  });
  it("includes both date boundaries, but excludes income, refunds, transfers and other customers", () => {
    const base = rows.find(row => row.category === "Groceries" && row.amountCents < 0)!;
    const fixture = [
      { ...base, id: "start", date: "2026-08-01", amountCents: -101 },
      { ...base, id: "end", date: "2026-08-31", amountCents: -202 },
      { ...base, id: "future", date: "2026-09-01", amountCents: -5000 },
      { ...base, id: "other", customerId: "OTHER", amountCents: -9000 },
      { ...base, id: "refund", amountCents: 81 },
      { ...base, id: "transfer", transactionType: "investment_deposit", amountCents: -6000 },
    ];
    expect(calculateSpending(fixture, raw.customerId, query, {}, "2026-09-01").totalCents).toBe(303);
    expect(() => calculateSpending(rows, raw.customerId, { ...query, end: "2026-09-30" }, {}, "2026-09-01")).toThrow();
    expect(calculateSpending(rows, raw.customerId, { ...query, start: "2026-09-02", end: "2026-09-02" }, {}, "2026-09-02").evidence).toEqual([]);
  });
  it("rounds percentage reductions once and never records them as savings", () => {
    expect(percentageScenario(101, 50)).toEqual({ percent: 50, baseCents: 101, reductionCents: 51, remainingCents: 50 });
    expect(percentageScenario(103116, 20).reductionCents).toBe(20623);
    expect(percentageScenario(0, 100).remainingCents).toBe(0);
    expect(() => percentageScenario(100, 101)).toThrow();
  });
  it("requires explicit mutation confirmation and rejects model-selected customers", () => {
    expect(requestSchema.safeParse({ action: "habit", revision: 0, habit: { category: "Groceries", action: "Review my spending", goal: "" } }).success).toBe(false);
    expect(requestSchema.safeParse({ action: "ask", revision: 0, text: "My spending", customerId: "OTHER" }).success).toBe(false);
  });
});
