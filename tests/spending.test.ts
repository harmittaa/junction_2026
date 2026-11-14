import { describe, expect, it } from "vitest";
import { calculateSpending, percentageScenario, queryLabel } from "@/domain/spending";
import { calculateAnalysis } from "@/domain/exploration";
import { merchantTypes } from "@/domain/merchant-types";
import { transactionSchema, requestSchema, type SpendingQuery } from "@/shared/contracts";
import raw from "../data/demo-transactions.json";

const rows = raw.transactions.map(row => transactionSchema.parse(row));
const query: SpendingQuery = { categories: ["Groceries"], baskets: [], merchantType: null, start: "2026-08-01", end: "2026-08-31" };
describe("source-backed spending", () => {
  it("reconciles August category totals and preserves the amount after a correction", () => {
    const grocery = calculateSpending(rows, raw.customerId, query, {}, "2026-09-01");
    expect(grocery.totalCents).toBe(111106); // Independently reconciled from CSV with Decimal.
    expect(grocery.evidence.map(row => row.sourceRow)).toEqual([2898292, 2898294, 2898295, 2898302, 2898308, 2898310, 2898311, 2898322, 2898326, 2898329, 2898330, 2898335, 2898340, 2898342, 2898348, 2898349]);
    const corrected = calculateSpending(rows, raw.customerId, query, { "row-2898292": "regular" }, "2026-09-01");
    expect(corrected.totalCents).toBe(111106);
    expect(corrected.baskets).toEqual({ regular: 7990, unexpected: 0, everyday: 103116 });
    expect(calculateSpending(rows, raw.customerId, { ...query, categories: ["Utilities"] }, {}, "2026-09-01").totalCents).toBe(10040);
    expect(calculateSpending(rows, raw.customerId, { ...query, categories: [] }, {}, "2026-09-01")).toMatchObject({ totalCents: 444878, evidenceCount: 59 });
    expect(calculateSpending(rows, raw.customerId, { ...query, categories: ["Restaurants"] }, {}, "2026-09-01")).toMatchObject({ totalCents: 17205, evidenceCount: 10 });
    expect(calculateSpending(rows, raw.customerId, { ...query, categories: ["Transportation"] }, {}, "2026-09-01")).toMatchObject({ totalCents: 38472, evidenceCount: 9 });
    // Reconciliation of the whole imported period only, not a query at the demo date.
    expect(rows.filter(row => row.mcc === "4121")).toHaveLength(12);
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
    expect(() => calculateSpending(rows, raw.customerId, { ...query, start: "2026-09-01" }, {}, "2026-09-01")).toThrow();
    expect(calculateSpending(rows, raw.customerId, { ...query, start: "2026-09-02", end: "2026-09-02" }, {}, "2026-09-02").evidence).toEqual([]);
  });
  it("intersects category, corrected basket and merchant filters without guessing missing MCCs", () => {
    const base = rows[0];
    const fixture = [
      { ...base, id: "taxi", category: "Transportation", transactionType: "purchase", date: "2026-08-01", amountCents: -101, mcc: "4121" },
      { ...base, id: "missing", category: "Transportation", transactionType: "purchase", date: "2026-08-01", amountCents: -203, mcc: null },
      { ...base, id: "fuel", category: "Transportation", transactionType: "purchase", date: "2026-08-01", amountCents: -307, mcc: "5542" },
      { ...base, id: "bill", category: "Housing", transactionType: "housing_payment", date: "2026-08-01", amountCents: -401, mcc: null },
    ];
    const filter: SpendingQuery = { ...query, categories: ["Transportation", "Housing"], baskets: ["regular"], merchantType: "taxi" };
    const corrections = { taxi: "regular", missing: "regular" } as const;
    const result = calculateSpending(fixture, raw.customerId, filter, corrections, "2026-09-01");
    expect(result).toMatchObject({ totalCents: 101, evidenceCount: 1, missingMccCount: 1 });
    expect(result.evidence.map(row => row.id)).toEqual(["taxi"]);
    expect(result.assumptions.join(" ")).toContain("merchant subtotal may be incomplete");
    expect(calculateSpending(fixture, raw.customerId, { ...filter, merchantType: null }, corrections, "2026-09-01").totalCents).toBe(705);
    expect(calculateSpending(fixture, raw.customerId, { ...filter, merchantType: null }, {}, "2026-09-01").missingMccCount).toBe(0);
    expect(queryLabel(filter)).toContain(merchantTypes.taxi.label);
    expect(queryLabel(filter)).toContain("Regular essentials");
    expect(queryLabel({ ...query, categories: [] })).toBe("All spending");
  });
  it("retains the full evidence rather than an arbitrary display cap", () => {
    const fullQuery = { ...query, categories: [], start: raw.period.start };
    const result = calculateSpending(rows, raw.customerId, fullQuery, {}, "2026-09-01");
    expect(result.evidenceCount).toBe(result.evidence.length);
    expect(result.evidenceCount).toBeGreaterThan(900);
    const analysis = calculateAnalysis(rows, raw.customerId, { kind: "breakdown", query: fullQuery,
      by: "category", top: 1, percent: null, comparePeriod: null }, {}, "2026-09-01");
    expect(analysis.evidenceCount).toBe(result.evidenceCount);
    expect(analysis.evidence).toEqual(result.evidence);
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
