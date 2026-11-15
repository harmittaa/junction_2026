import { describe, expect, it } from "vitest";
import { calculateJar, calculateUsualComparison, overspendInsight, usualInsight, completeWeeklyCheckup, isoWeekStart, weeklyCheckup } from "@/domain/checkup";
import { euros, percentageScenario } from "@/domain/spending";
import { verifyReply, speechText } from "@/domain/replies";
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
      dailySpentCents: 8048, dailyRemainingCents: 6516, projectedCents: 241445, projectedOverCents: 21445 });
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
    expect(jar).toMatchObject({ spentCents: 717, unexpectedCents: 101 });
    expect(jar.evidence).toHaveLength(109);
    expect(jar.evidence.reduce((sum, row) => sum + row.amountCents, 0)).toBe(1125);
    const usual = calculateUsualComparison(fixtureInput);
    expect(usual.evidence).toHaveLength(107);
    expect(usual.rows).toEqual([
      { category: "Groceries", currentCents: 308, usualCents: 666, flag: "ahead", sharePercent: 46, paymentDates: Array(106).fill("2026-09-02"), count: 106 },
      { category: "Health", currentCents: 409, usualCents: 0, flag: null, sharePercent: null, paymentDates: ["2026-09-02"], count: 1 },
    ]);
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
      projectedCents: 0, months: [], evidence: [] });
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
    expect(result.rows).toEqual([{ category: "Groceries", currentCents: 503, usualCents: 51, flag: "ahead", sharePercent: 986, paymentDates: ["2027-01-01"], count: 1 }]);
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

describe("past-month jar and usual comparison", () => {
  it("calculates past months inside and over limit while keeping all closed months", () => {
    const july = calculateJar({ ...input, jarMonth: "2026-07" });
    expect(july).toMatchObject({
      period: { start: "2026-07-01", end: "2026-07-31" },
      limitCents: 220000,
      spentCents: 99581,
      leftCents: 120419,
      overCents: 0,
      elapsedDays: 31,
      daysLeft: 0,
      dailySpentCents: 3212,
      dailyRemainingCents: 0,
      projectedCents: 99581,
      projectedOverCents: 0,
    });
    expect(july.months).toEqual([
      { month: "2026-02", spentCents: 145205, inside: true },
      { month: "2026-03", spentCents: 113723, inside: true },
      { month: "2026-04", spentCents: 292322, inside: false },
      { month: "2026-05", spentCents: 140290, inside: true },
      { month: "2026-06", spentCents: 240758, inside: false },
      { month: "2026-07", spentCents: 99581, inside: true },
      { month: "2026-08", spentCents: 333652, inside: false },
    ]);

    const august = calculateJar({ ...input, jarMonth: "2026-08" });
    expect(august).toMatchObject({
      period: { start: "2026-08-01", end: "2026-08-31" },
      limitCents: 220000,
      spentCents: 333652,
      leftCents: 0,
      overCents: 113652,
      elapsedDays: 31,
      daysLeft: 0,
      dailySpentCents: 10762,
      dailyRemainingCents: 0,
      projectedCents: 333652,
      projectedOverCents: 113652,
    });
    expect(overspendInsight({ ...input, jarMonth: "2026-08" })).toMatchObject({ kind: "category",
      categories: [{ category: "Groceries" }, { category: "Lifestyle" }] });
    expect(august.months).toEqual(july.months);

    const usualAug = calculateUsualComparison({ ...input, jarMonth: "2026-08" });
    expect(usualAug).toMatchObject({
      period: { start: "2026-08-01", end: "2026-08-31" },
      baseline: { start: "2026-02-01", end: "2026-07-31" },
      monthCount: 6,
    });
    expect(usualAug.rows.length).toBeGreaterThan(0);

    const usualJul = calculateUsualComparison({ ...input, jarMonth: "2026-07" });
    expect(usualJul).toMatchObject({
      period: { start: "2026-07-01", end: "2026-07-31" },
      baseline: { start: "2026-01-01", end: "2026-06-30" },
      monthCount: 6,
    });
  });

  it("rejects invalid or out-of-range jar months", () => {
    expect(() => calculateJar({ ...input, jarMonth: "2026-01" })).toThrow();
    expect(() => calculateJar({ ...input, jarMonth: "2026-10" })).toThrow();
    expect(() => calculateJar({ ...input, jarMonth: "2026-13" })).toThrow();
    expect(() => calculateJar({ ...input, jarMonth: "not-a-month" })).toThrow();
    expect(() => calculateUsualComparison({ ...input, jarMonth: "2026-01" })).toThrow();
    expect(() => calculateUsualComparison({ ...input, jarMonth: "2026-10" })).toThrow();
  });
});

describe("usual insight", () => {
  const row = (category: string, currentCents: number, usualCents: number) => ({ category, currentCents, usualCents });
  const at = (rows: ReturnType<typeof row>[], referenceDate = "2026-09-16", start = "2026-09-01") =>
    usualInsight({ period: { start }, baseline: { start: "2026-03-01", end: "2026-08-31" }, rows }, referenceDate);
  const facts = (message: string) => ({ kind: "usual" as const, subject: "s", period: "", values: [], notes: [message], required: [message], fallback: message });
  const moneyCount = (text: string) => (text.match(/€/g) ?? []).length;

  it("flags real data for today in rank order", () => {
    const usual = calculateUsualComparison(input);
    const flagOf = (c: string) => usual.rows.find(r => r.category === c);
    expect(usual).toMatchObject({ elapsedDays: 16, daysInMonth: 30 });
    expect(flagOf("Home & Tech")).toMatchObject({ flag: "over", sharePercent: 150 });
    expect(flagOf("Restaurants")?.flag).toBe("over");
    expect(flagOf("Lifestyle")).toMatchObject({ flag: "ahead", sharePercent: 75 });
    expect(flagOf("Travel")?.flag).toBe("under");
    for (const c of ["Entertainment", "Groceries", "Transportation"]) expect(flagOf(c)?.flag).toBeNull();
    expect(usual.insight.kind).toBe("over");
    expect(usual.insight.headline).toBe(`Your Home & Tech spending is already ${euros(9488)} over a usual month, with 14 days to go.`);
    expect(usual.insight.supporting).toEqual(["Restaurants is over too.", "Lifestyle is at 75% with 53% of the month gone."]);
    expect(usualComparisonSchema.safeParse(usual).success).toBe(true);
  });

  it("applies exact thresholds", () => {
    expect(at([row("A", 10499, 10000)]).flags.A.flag).toBe("ahead");
    expect(at([row("A", 10500, 10000)]).flags.A.flag).toBe("over");
    expect(at([row("A", 500, 0)]).flags.A.flag).toBe("over");
    expect(at([row("A", 499, 0)]).flags.A.flag).toBeNull();
    // day 10 of 30: elapsedBp 3333; share 5333 is +2000 exactly
    expect(at([row("A", 5333, 10000)], "2026-09-10").flags.A.flag).toBe("ahead");
    expect(at([row("A", 5332, 10000)], "2026-09-10").flags.A.flag).toBeNull();
  });

  it("never marks a past month ahead, and names the month", () => {
    const result = at([row("A", 9000, 10000), row("B", 20000, 10000)], "2026-09-16", "2026-08-01");
    expect(result.flags.A.flag).toBeNull();
    expect(result.insight.headline).toContain("finished");
    expect(result.insight.headline).toContain("August 2026");
    expect(result.insight.message).not.toContain("Holding back");
  });

  it("picks the template and keeps one amount that passes verifyReply", () => {
    const over = at([row("A", 20000, 10000)]).insight;
    const ahead = at([row("A", 8000, 10000)]).insight;
    const none = at([row("A", 5000, 10000)]).insight;
    expect([over.kind, ahead.kind, none.kind]).toEqual(["over", "ahead", "none"]);
    expect(ahead.headline).toBe("Your A spending is already at 80% of a usual month, and 16 of 30 days have passed.");
    expect(none.headline).toBe("Every category is at or below its usual pace so far.");
    for (const { message } of [over, ahead, none]) {
      expect(message.length).toBeLessThan(480);
      expect(moneyCount(message)).toBeLessThanOrEqual(1);
      expect(verifyReply(message, facts(message))).toBe(true);
      expect(speechText(message)).not.toContain("€");
    }
  });
});

describe("why the jar went over", () => {
  const small = { ...input, customerId: "C", jarMonth: "2026-08", limit: { amountCents: 1000, activeSince: "2026-02" } };
  const old = [payment("o1", "2026-03-01", 100), payment("o2", "2026-03-02", 200), payment("o3", "2026-03-03", 300)];

  it("finds large payments, breaks ties by id and dates the crossing", () => {
    const insight = overspendInsight({ ...small, rows: [...old, payment("b", "2026-08-03", 400), payment("a", "2026-08-05", 400),
      payment("l", "2026-08-20", 300, { category: "Lifestyle" })] })!;
    expect(insight).toMatchObject({ kind: "large_payments", wentOverOn: "2026-08-20", daysLeftAfter: 11,
      payments: [{ date: "2026-08-05", amountCents: 400 }, { date: "2026-08-03", amountCents: 400 }] });
    expect(insight.message.startsWith(insight.headline)).toBe(true);
    expect(insight.message).not.toContain("over the rim");
  });

  it("ignores payments in a category with fewer than three baseline payments", () => {
    const insight = overspendInsight({ ...small, rows: [old[0], old[1], payment("big", "2026-08-03", 1500)] })!;
    expect(insight.payments).toEqual([]);
    expect(insight.kind).toBe("category");
  });

  it("reports a spread when nothing stands out, and null inside the limit", () => {
    const usual = Array.from({ length: 6 }, (_, i) => payment(`u${i}`, `2026-0${2 + i}-01`, 700));
    const rowsSpread = [...usual, ...Array.from({ length: 11 }, (_, i) => payment(`s${i}`, `2026-08-${10 + i}`, 100))];
    expect(overspendInsight({ ...small, rows: rowsSpread })).toMatchObject({ kind: "spread", payments: [], categories: [] });
    expect(overspendInsight({ ...small, rows: old })).toBeNull();
  });

  it("explains the real June and August jars", () => {
    const june = overspendInsight({ ...input, jarMonth: "2026-06" })!;
    expect(june).toMatchObject({ kind: "large_payments", wentOverOn: "2026-06-26", daysLeftAfter: 4 });
    expect(june.payments.reduce((sum, row) => sum + row.amountCents, 0)).toBe(21015);
    expect(june.message.match(/€/g)).toBeNull();
    expect(overspendInsight({ ...input, jarMonth: "2026-08" })!.categories[0].category).toBe("Groceries");
    expect(overspendInsight({ ...input, jarMonth: "2026-07" })).toBeNull();
  });
});
