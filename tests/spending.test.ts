import { describe, expect, it } from "vitest";
import { calculateSpending, percentageScenario } from "@/domain/spending";
import { transactionSchema, requestSchema } from "@/shared/contracts";
import raw from "../data/demo-transactions.json";

const rows = raw.transactions.map(row => transactionSchema.parse(row));
const query = { category: "Groceries", start: "2024-10-01", end: "2024-10-31" };
describe("source-backed spending", () => {
  it("reconciles October category totals and preserves the amount after a correction", () => {
    const grocery = calculateSpending(rows, raw.customerId, query, {}, "2024-11-04");
    expect(grocery.totalCents).toBe(75275); // Independently reconciled from CSV with Decimal.
    expect(grocery.evidence.map(row => row.sourceRow)).toEqual([3, 5, 6, 7, 10, 12, 14, 15, 17, 18, 19]);
    const corrected = calculateSpending(rows, raw.customerId, query, { "row-3": "regular" }, "2024-11-04");
    expect(corrected.totalCents).toBe(75275);
    expect(corrected.baskets).toEqual({ regular: 3251, unexpected: 0, everyday: 72024 });
    expect(calculateSpending(rows, raw.customerId, { ...query, category: "Utilities" }, {}, "2024-11-04").totalCents).toBe(6828);
  });
  it("includes both date boundaries, but excludes income, refunds, transfers and other customers", () => {
    const base = rows[1];
    const fixture = [
      { ...base, id: "start", date: "2024-10-01", amountCents: -101 },
      { ...base, id: "end", date: "2024-10-31", amountCents: -202 },
      { ...base, id: "future", date: "2024-11-01", amountCents: -5000 },
      { ...base, id: "other", customerId: "OTHER", amountCents: -9000 },
      { ...base, id: "refund", amountCents: 81 },
      { ...base, id: "transfer", transactionType: "investment_deposit", amountCents: -6000 },
    ];
    expect(calculateSpending(fixture, raw.customerId, query, {}, "2024-11-04").totalCents).toBe(303);
    expect(() => calculateSpending(rows, raw.customerId, { ...query, end: "2024-11-30" }, {}, "2024-11-04")).toThrow();
    expect(calculateSpending(rows, raw.customerId, { ...query, start: "2024-11-05", end: "2024-11-05" }, {}, "2024-11-05").evidence).toEqual([]);
  });
  it("rounds percentage reductions once and never records them as savings", () => {
    expect(percentageScenario(101, 50)).toEqual({ percent: 50, baseCents: 101, reductionCents: 51, remainingCents: 50 });
    expect(percentageScenario(72024, 20).reductionCents).toBe(14405);
    expect(percentageScenario(0, 100).remainingCents).toBe(0);
    expect(() => percentageScenario(100, 101)).toThrow();
  });
  it("requires explicit mutation confirmation and rejects model-selected customers", () => {
    expect(requestSchema.safeParse({ action: "habit", revision: 0, habit: { category: "Groceries", action: "Review my spending", goal: "" } }).success).toBe(false);
    expect(requestSchema.safeParse({ action: "ask", revision: 0, text: "My spending", customerId: "OTHER" }).success).toBe(false);
  });
});
