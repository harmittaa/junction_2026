import { describe, expect, it } from "vitest";
import { calculateJar, calculateUsualComparison, completeWeeklyCheckup, isoWeekStart, weeklyCheckup } from "@/domain/checkup";
import { percentageScenario } from "@/domain/spending";
import { jarSchema, transactionSchema, usualComparisonSchema, weeklyCheckupSchema, type Transaction } from "@/shared/contracts";
import raw from "../data/demo-transactions.json";

const rows = raw.transactions.map(row => transactionSchema.parse(row));
const input = { rows, customerId: raw.customerId, referenceDate: "2026-09-16", corrections: {},
  limit: { amountCents: 220000, activeSince: "2026-02" } };

function payment(id: string, date: string, cents: number, extra: Partial<Transaction> = {}): Transaction {
  return { id, sourceRow: 1, customerId: "C", accountId: "A", date, timestamp: date,
    category: "Groceries", amountCents: -cents, transactionType: "purchase", merchantId: "M", mcc: "5411", ...extra };
}

describe("source-backed jar and usual comparison", () => {
  it("reconciles closed months and the September 16 jar with independently supplied CSV targets", () => {
    const jar = calculateJar(input);
    expect(jarSchema.safeParse(jar).success).toBe(true);
    expect(jar).toMatchObject({ period: { start: "2026-09-01", end: "2026-09-16" }, limitCents: 220000,
      spentCents: 128771, leftCents: 91229, overCents: 0, elapsedDays: 16, daysLeft: 14,
      dailySpentCents: 8048, dailyRemainingCents: 6516, projectedCents: 241445, projectedOverCents: 21445,
      contributionPeriod: { start: "2026-09-10", end: "2026-09-16" } });
    expect(jar.months).toEqual([
      { month: "2026-02", spentCents: 145205, inside: true },
      { month: "2026-03", spentCents: 113723, inside: true },
      { month: "2026-04", spentCents: 292322, inside: false },
      { month: "2026-05", spentCents: 140290, inside: true },
      { month: "2026-06", spentCents: 240758, inside: false },
      { month: "2026-07", spentCents: 99581, inside: true },
      { month: "2026-08", spentCents: 333652, inside: false },
    ]);
    expect(jar.evidence.every((row, i, evidence) => !i || evidence[i - 1].date >= row.date)).toBe(true);
  });

  it("reconciles over-limit spending, contributing days, and an undoable correction without changing payments", () => {
    const at23 = { ...input, referenceDate: "2026-09-23" };
    const original = calculateJar(at23);
    expect(original).toMatchObject({ spentCents: 232720, leftCents: 0, overCents: 12720, dailyRemainingCents: 0 });
    expect(original.topDays).toEqual([
      { date: "2026-09-21", amountCents: 35915, count: 4 },
      { date: "2026-09-19", amountCents: 28004, count: 6 },
    ]);
    const corrected = calculateJar({ ...at23, corrections: { "row-2898396": "unexpected" } });
    expect(corrected).toMatchObject({ spentCents: 214924, leftCents: 5076, overCents: 0,
      unexpectedCents: original.unexpectedCents + 17796 });
    expect(corrected.evidence.find(row => row.sourceRow === 2898396)).toMatchObject({
      date: "2026-09-21", merchant: "MRC-HMT-0049", amountCents: 17796, basket: "unexpected" });
    expect(corrected.evidence.map(({ id, amountCents }) => ({ id, amountCents })))
      .toEqual(original.evidence.map(({ id, amountCents }) => ({ id, amountCents })));
    expect(rows.find(row => row.sourceRow === 2898396)?.amountCents).toBe(-17796);
    expect(calculateJar(at23)).toEqual(original);
  });

  it("floors six complete months and preserves current payment dates, counts and evidence", () => {
    const usual = calculateUsualComparison(input);
    expect(usualComparisonSchema.safeParse(usual).success).toBe(true);
    expect(usual).toMatchObject({ period: { start: "2026-09-01", end: "2026-09-16" },
      baseline: { start: "2026-03-01", end: "2026-08-31" }, monthCount: 6 });
    expect(usual.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "Home & Tech", currentCents: 28165, usualCents: 18677 }),
      expect.objectContaining({ category: "Restaurants", currentCents: 20370, usualCents: 18891, count: 7 }),
      expect.objectContaining({ category: "Groceries", currentCents: 30681, usualCents: 81813, count: 4 }),
    ]));
    expect(usual.rows.find(row => row.category === "Groceries")?.paymentDates)
      .toEqual(["2026-09-04", "2026-09-04", "2026-09-12", "2026-09-13"]);
    expect(percentageScenario(usual.rows.find(row => row.category === "Restaurants")!.usualCents, 20).reductionCents * 12).toBe(45336);
  });
});

describe("calendar and spending boundaries", () => {
  it("isolates customer, gross-spending dates and corrected baskets, retaining all evidence", () => {
    const fixture = [payment("before", "2026-08-31", 4001), payment("first", "2026-09-01", 101),
      payment("today", "2026-09-02", 203), payment("future", "2026-09-03", 5003),
      payment("other", "2026-09-02", 6007, { customerId: "OTHER" }),
      payment("refund", "2026-09-02", -701), payment("transfer", "2026-09-02", 809, { transactionType: "investment_deposit" }),
      payment("regular", "2026-09-02", 307, { category: "Utilities", transactionType: "utilities_payment" }),
      payment("unexpected", "2026-09-02", 409, { category: "Health" }),
      ...Array.from({ length: 105 }, (_, i) => payment(`small-${i}`, "2026-09-02", 1))];
    const fixtureInput = { ...input, rows: fixture, customerId: "C", referenceDate: "2026-09-02",
      corrections: { first: "unexpected", unexpected: "everyday" } as const };
    const jar = calculateJar(fixtureInput);
    expect(jar).toMatchObject({ spentCents: 717, unexpectedCents: 101, contributionPeriod: { start: "2026-09-01", end: "2026-09-02" },
      topDays: [{ date: "2026-09-02", amountCents: 717, count: 107 }] });
    expect(jar.evidence).toHaveLength(109);
    expect(jar.evidence.reduce((sum, row) => sum + row.amountCents, 0)).toBe(1125);
    const usual = calculateUsualComparison(fixtureInput);
    expect(usual.evidence).toHaveLength(107);
    expect(usual.rows).toEqual([
      { category: "Groceries", currentCents: 308, usualCents: 666, paymentDates: Array(106).fill("2026-09-02"), count: 106 },
      { category: "Health", currentCents: 409, usualCents: 0, paymentDates: ["2026-09-02"], count: 1 },
    ]);
  });

  it("uses a rolling seven-day window, ranks summed days, and excludes earlier larger days", () => {
    const jar = calculateJar({ ...input, customerId: "C", rows: [payment("old", "2026-09-09", 9000),
      payment("boundary", "2026-09-10", 109), payment("a", "2026-09-15", 61), payment("b", "2026-09-15", 47),
      payment("today", "2026-09-16", 107), payment("health", "2026-09-16", 8000, { category: "Health" })] });
    expect(jar.topDays).toEqual([{ date: "2026-09-10", amountCents: 109, count: 1 }, { date: "2026-09-15", amountCents: 108, count: 2 }]);
  });

  it("handles leap-month end, a fully used limit, and zero closed months across a year boundary", () => {
    const leap = calculateJar({ ...input, customerId: "C", referenceDate: "2024-02-29", rows: [payment("leap", "2024-02-29", 101)],
      limit: { amountCents: 101, activeSince: "2023-12" } });
    expect(leap).toMatchObject({ elapsedDays: 29, daysLeft: 0, dailyRemainingCents: 0, dailySpentCents: 3,
      projectedCents: 101, leftCents: 0, overCents: 0,
      months: [{ month: "2023-12", spentCents: 0, inside: true }, { month: "2024-01", spentCents: 0, inside: true }] });
    expect(calculateJar({ ...input, customerId: "C", referenceDate: "2024-02-29",
      rows: [payment("leap", "2024-02-29", 101)] })).toMatchObject({ leftCents: 219899, daysLeft: 0, dailyRemainingCents: 0 });
    const january = calculateJar({ ...input, rows: [], referenceDate: "2027-01-01", limit: { amountCents: 220000, activeSince: "2027-01" } });
    expect(january).toMatchObject({ elapsedDays: 1, daysLeft: 30, dailySpentCents: 0, dailyRemainingCents: 7333,
      projectedCents: 0, months: [], evidence: [], topDays: [], contributionPeriod: { start: "2027-01-01", end: "2027-01-01" } });
    expect(calculateUsualComparison({ ...input, rows: [], referenceDate: "2027-01-31" })).toMatchObject({
      baseline: { start: "2026-07-01", end: "2026-12-31" }, monthCount: 6, rows: [], evidence: [] });
  });

  it("includes both baseline boundaries, floors rather than rounds, and applies historical corrections", () => {
    const fixture = [payment("old", "2026-06-30", 8001), payment("start", "2026-07-01", 101),
      payment("end", "2026-12-31", 208), payment("corrected", "2026-08-05", 701),
      payment("now", "2027-01-01", 503), payment("later", "2027-01-02", 9001),
      payment("baseline-other", "2026-10-01", 4001, { customerId: "OTHER" })];
    const result = calculateUsualComparison({ ...input, customerId: "C", rows: fixture, referenceDate: "2027-01-01",
      corrections: { corrected: "regular" } });
    expect(result.rows).toEqual([{ category: "Groceries", currentCents: 503, usualCents: 51, paymentDates: ["2027-01-01"], count: 1 }]);
    expect(result.evidence.map(row => row.id)).toEqual(["now"]);
  });
});

describe("weekly check-up credit", () => {
  it("preserves actual seed dates, counts once per week, and completes the third week independently of spending", () => {
    const dates = ["2026-09-09", "2026-09-02", "2026-09-03", "2026-09-09"];
    expect(weeklyCheckup(dates, "2026-09-16")).toEqual({ weekStart: "2026-09-14", completed: false, due: true,
      streak: 2, completedDates: ["2026-09-02", "2026-09-09"] });
    const completed = completeWeeklyCheckup(dates, "2026-09-16");
    expect(completed).toEqual({ weekStart: "2026-09-14", completed: true, due: false, streak: 3,
      completedDates: ["2026-09-02", "2026-09-09", "2026-09-16"] });
    expect(completeWeeklyCheckup(completed.completedDates, "2026-09-20")).toEqual(completed);
    expect(weeklyCheckup(completed.completedDates, "2026-09-16")).toEqual(completed);
    expect(weeklyCheckupSchema.safeParse(completed).success).toBe(true);
    expect(dates).toEqual(["2026-09-09", "2026-09-02", "2026-09-03", "2026-09-09"]);
  });

  it("handles ISO year boundaries, Sunday/Monday rollover, gaps and future dates without credit", () => {
    expect(isoWeekStart("2021-01-01")).toBe("2020-12-28");
    expect(isoWeekStart("2021-01-03")).toBe("2020-12-28");
    expect(isoWeekStart("2021-01-04")).toBe("2021-01-04");
    const dates = ["2020-12-23", "2020-12-31", "2021-01-01", "2021-01-04", "2021-01-18"];
    expect(weeklyCheckup(dates, "2021-01-03")).toMatchObject({ completed: true, due: false, streak: 2,
      completedDates: ["2020-12-23", "2020-12-31"] });
    expect(weeklyCheckup(["2021-01-05"], "2021-01-04")).toMatchObject({ completed: false, due: true, streak: 0, completedDates: [] });
    expect(weeklyCheckup(["2020-12-23", "2020-12-31"], "2021-01-04").streak).toBe(2);
    expect(weeklyCheckup(["2020-12-23", "2020-12-31"], "2021-01-11").streak).toBe(0);
    expect(weeklyCheckup(dates, "2021-01-18").streak).toBe(1);
    expect(completeWeeklyCheckup(["2021-01-05", "2021-01-18"], "2021-01-04")).toMatchObject({
      completed: true, due: false, streak: 1, completedDates: ["2021-01-04"] });
    expect(weeklyCheckup([], "2024-02-29")).toMatchObject({ weekStart: "2024-02-26", completed: false, due: true, streak: 0 });
  });

  it("rejects invalid calendar dates rather than allowing JavaScript date rollover", () => {
    expect(() => isoWeekStart("2026-02-29")).toThrow();
    expect(() => weeklyCheckup(["2026-09-31"], "2026-09-16")).toThrow();
    expect(() => calculateJar({ ...input, referenceDate: "2026-02-30" })).toThrow();
    expect(() => calculateUsualComparison({ ...input, referenceDate: "2026-13-01" })).toThrow();
    expect(() => calculateJar({ ...input, limit: { amountCents: 220000, activeSince: "2026-13" } })).toThrow();
  });
});
