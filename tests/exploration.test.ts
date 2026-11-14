import { describe, expect, it } from "vitest";
import raw from "../data/demo-transactions.json";
import { calculateAnalysis, recentCompleteQuery, seasonFacts, whatIfFacts, whatIfInsight, winterQuery } from "@/domain/exploration";
import { merchantTypes } from "@/domain/merchant-types";
import type { Analysis, AnalysisOperation, SpendingQuery, Transaction } from "@/shared/contracts";

const query: SpendingQuery = { start: "2026-06-01", end: "2026-08-31", categories: [], baskets: [], merchantType: null };
const referenceDate = "2026-09-10";
function transaction(id: string, date: string, amountCents: number, category = "Groceries", extra: Partial<Transaction> = {}): Transaction {
  return { id, sourceRow: Number(id.replace(/\D/g, "")) + 1, customerId: "C", accountId: "A", date,
    timestamp: date, category, amountCents, transactionType: "purchase", merchantId: "M", mcc: "5411", ...extra };
}
const fixture = [
  transaction("a1", "2026-06-10", -101),
  transaction("a2", "2026-08-01", -202),
  transaction("a3", "2026-06-03", -53, "Health", { mcc: "5912" }),
  transaction("a4", "2026-08-02", -47, "Health", { mcc: null }),
  transaction("a5", "2026-08-03", -139, "Transportation", { mcc: "4121" }),
  transaction("a6", "2026-08-04", -67, "Transportation", { mcc: "5541" }),
  transaction("a7", "2026-08-05", -31, "Transportation", { mcc: null }),
  transaction("a8", "2026-08-01", -400, "Housing", { transactionType: "housing_payment", mcc: null }),
  transaction("a9", "2026-09-10", -1000),
  transaction("a10", "2026-08-01", -9000, "Groceries", { customerId: "OTHER" }),
  transaction("a11", "2026-09-11", -8000),
  transaction("a12", "2026-08-01", 12345, "Salary", { transactionType: "salary", mcc: null }),
];
function operation(kind: AnalysisOperation["kind"], changes: Partial<AnalysisOperation> = {}): AnalysisOperation {
  return { kind, query, by: null, comparePeriod: null, percent: null, top: null, ...changes };
}
function analyze(kind: AnalysisOperation["kind"], changes: Partial<AnalysisOperation> = {}, rows = fixture) {
  return calculateAnalysis(rows, "C", operation(kind, changes), {}, referenceDate, "2026-06-01");
}
function value(result: Analysis, label: string) {
  const row = result.sections.flatMap(section => section.rows).find(row => row.label === label);
  expect(row, `Missing calculated row: ${label}`).toBeDefined();
  return row!;
}

describe("complete historical periods", () => {
  it("uses the previous three calendar months even on month end, with year and leap boundaries", () => {
    expect(recentCompleteQuery("2026-09-30", "2024-10-01")).toEqual(query);
    expect(recentCompleteQuery("2027-01-01", "2024-10-01")).toMatchObject({ start: "2026-10-01", end: "2026-12-31" });
    expect(recentCompleteQuery("2024-03-01", "2024-02-01")).toMatchObject({ start: "2024-02-01", end: "2024-02-29" });
    expect(recentCompleteQuery("2026-09-10", "2026-07-15")).toMatchObject({ start: "2026-08-01", end: "2026-08-31" });
    expect(() => recentCompleteQuery("2026-09-10", "2026-09-01")).toThrow("No complete");
    expect(() => recentCompleteQuery(referenceDate, "2026-06-01", 25)).toThrow();
  });
});

describe("spending breakdowns", () => {
  it("ranks categories, calculates shares, and retains an Other remainder and all evidence", () => {
    const result = analyze("breakdown", { by: "category", top: 2 });
    expect(result.sections[0].rows).toEqual([
      { label: "Housing", amountCents: 400, count: 1, sharePercent: 38.5 },
      { label: "Groceries", amountCents: 303, count: 2, sharePercent: 29.1 },
      { label: "Other", amountCents: 337, count: 5, sharePercent: 32.4 },
    ]);
    expect(value(result, "Total spending").amountCents).toBe(1040);
    expect(result.evidenceCount).toBe(8);
    expect(result.evidence).toHaveLength(8);
  });
  it("uses basket corrections in filters and grouping without changing money", () => {
    const corrected = calculateAnalysis(fixture, "C", operation("breakdown", { by: "basket" }), { a5: "regular" }, referenceDate);
    expect(value(corrected, "Regular essentials").amountCents).toBe(539);
    expect(value(corrected, "Unexpected necessities").amountCents).toBe(100);
    expect(value(corrected, "Everyday spending").amountCents).toBe(401);
    expect(value(corrected, "Total spending").amountCents).toBe(1040);
    const filtered = calculateAnalysis(fixture, "C", operation("breakdown", { by: "category", query: { ...query, baskets: ["regular"] } }), { a5: "regular" }, referenceDate);
    expect(value(filtered, "Total spending").amountCents).toBe(539);
  });
  it("never assigns missing MCCs to a merchant and keeps unclassified rows outside top N", () => {
    const result = analyze("breakdown", { by: "merchantType", top: 1 });
    expect(result.sections[0].rows).toEqual([
      { label: merchantTypes.taxi.label, amountCents: 139, count: 1, sharePercent: 13.4 },
      { label: "Other", amountCents: 120, count: 2, sharePercent: 11.5 },
      { label: "Not merchant-classified (bills)", amountCents: 400, count: 1, sharePercent: 38.5 },
      { label: "Unmapped MCC (other merchant types)", amountCents: 303, count: 2, sharePercent: 29.1 },
      { label: "Missing MCC (unclassified purchases)", amountCents: 78, count: 2, sharePercent: 7.5 },
    ]);
    expect(result.assumptions.join(" ")).toContain("subtotals may be incomplete");
    const filtered = analyze("breakdown", { by: "merchantType", query: { ...query, merchantType: "fuel" } });
    expect(value(filtered, "Total spending").amountCents).toBe(67);
    expect(filtered.assumptions.join(" ")).toContain("do not prove fuel was bought");
  });
  it("includes zero months in a month breakdown and returns no invented empty categories", () => {
    expect(analyze("breakdown", { by: "month" }).sections[0].rows.map(row => [row.label, row.amountCents])).toEqual([
      ["2026-08", 886], ["2026-06", 154], ["2026-07", 0],
    ]);
    expect(analyze("breakdown", { by: "category" }, []).sections[0].rows).toEqual([]);
  });
  it("rounds exactly-half shares up to one decimal", () => {
    const result = analyze("breakdown", { by: "category" }, [transaction("a1", "2026-06-01", -1), transaction("a2", "2026-06-01", -15, "Health")]);
    expect(value(result, "Groceries").sharePercent).toBe(6.3);
  });
});

describe("period comparisons", () => {
  it("compares the same filters and produces a signed difference with full evidence", () => {
    const result = analyze("comparison", { query: { ...query, start: "2026-08-01", categories: ["Groceries"] }, comparePeriod: { start: "2026-06-01", end: "2026-06-30" } });
    expect(result.sections[0].rows.map(row => row.amountCents)).toEqual([202, 101, 101]);
    expect(result.sections[0].rows[2].label).toContain("Difference");
    expect(result.evidenceCount).toBe(2);
    const decreasing = analyze("comparison", { query: { ...query, end: "2026-06-30", categories: ["Groceries"] }, comparePeriod: { start: "2026-08-01", end: "2026-08-31" } });
    expect(decreasing.sections[0].rows[2].amountCents).toBe(-101);
  });
  it("does not invent percentage growth from zero or duplicate overlapping evidence", () => {
    const result = analyze("comparison", { comparePeriod: { start: "2026-07-01", end: "2026-07-31" } });
    expect(result.sections[0].rows.map(row => row.amountCents)).toEqual([1040, 0, 1040]);
    expect(result.assumptions.join(" ")).toContain("undefined");
    const overlapping = analyze("comparison", { comparePeriod: { start: query.start, end: query.end } });
    expect(overlapping.evidenceCount).toBe(8);
    expect(overlapping.sections[0].rows[2].amountCents).toBe(0);
    expect(analyze("comparison", { comparePeriod: { start: query.start, end: query.end } }, []).sections[0].rows.map(row => row.amountCents)).toEqual([0, 0, 0]);
  });
});

describe("monthly trend", () => {
  it("includes zero months and excludes both partial boundary months from the rounded average", () => {
    const result = analyze("trend", { query: { ...query, start: "2026-06-02", end: "2026-09-10" } });
    expect(result.sections[0].rows.map(row => [row.label, row.amountCents])).toEqual([
      ["2026-06 (partial month)", 154], ["2026-07", 0], ["2026-08", 886], ["2026-09 (partial month)", 1000],
    ]);
    expect(value(result, "Monthly average (complete months)")).toMatchObject({ amountCents: 443, count: 2 });
    const rounded = analyze("trend", { query: { ...query, end: "2026-07-31" } }, [transaction("a1", "2026-06-01", -101)]);
    expect(value(rounded, "Monthly average (complete months)").amountCents).toBe(51);
  });
  it("distinguishes an empty complete month from an unavailable monthly average", () => {
    expect(value(analyze("trend", {}, []), "Monthly average (complete months)")).toMatchObject({ amountCents: 0, count: 3 });
    const partial = analyze("trend", { query: { ...query, start: "2026-08-02", end: "2026-08-03" } });
    expect(partial.sections.flatMap(section => section.rows).some(row => row.label.includes("average"))).toBe(false);
    expect(partial.assumptions.join(" ")).toContain("average is unavailable");
  });
  it("bounds monthly expansion to the 24-month dataset", () => {
    expect(analyze("trend", { query: { ...query, start: "2024-10-01", end: "2026-09-10" } }, []).sections[0].rows).toHaveLength(24);
    expect(() => analyze("trend", { query: { ...query, start: "2024-09-01", end: "2026-09-10" } })).toThrow("24");
  });
});

describe("recorded cashflow", () => {
  it("includes only defined income and investment transfers, with positive absolute evidence", () => {
    const result = analyze("cashflow", {}, [...fixture,
      transaction("a13", "2026-06-01", 121, "Other Income", { transactionType: "other_income" }),
      transaction("a14", "2026-06-01", -607, "Invest Deposit", { transactionType: "investment_deposit" }),
      transaction("a15", "2026-06-01", 99999, "Invest Withdraw", { transactionType: "investment_withdrawal" }),
      transaction("a16", "2026-06-01", -88888, "Salary Sweep", { transactionType: "salary_sweep" }),
      transaction("a17", "2026-06-01", -7777, "Salary", { transactionType: "salary" }),
      transaction("a18", "2026-06-01", 6666, "Invest Deposit", { transactionType: "investment_deposit" }),
      transaction("a19", "2026-09-11", 55555, "Salary", { transactionType: "salary" }),
      transaction("a20", "2026-08-01", 44444, "Salary", { transactionType: "salary", customerId: "OTHER" }),
    ]);
    expect(result.sections[0].rows.map(row => [row.amountCents, row.count])).toEqual([[12466, 2], [1040, 8], [607, 1]]);
    expect(result.evidenceCount).toBe(11);
    expect(result.evidence.every(row => row.amountCents >= 0)).toBe(true);
    expect(result.assumptions.join(" ")).toContain("neither they nor any residual are verified savings");
    expect(analyze("cashflow", {}, []).sections[0].rows.map(row => row.amountCents)).toEqual([0, 0, 0]);
  });
  it.each<Partial<SpendingQuery>>([{ categories: ["Groceries"] }, { baskets: ["regular"] }, { merchantType: "taxi" }])("rejects spending filters: %j", filter => {
    expect(() => analyze("cashflow", { query: { ...query, ...filter } })).toThrow("unfiltered");
  });
});

describe("hypothetical reductions", () => {
  it("floors the available-month average and annualizes the rounded monthly reduction including zero months", () => {
    const rows = [transaction("a1", "2026-06-01", -101), transaction("a2", "2026-08-01", -203),
      transaction("a3", "2026-09-10", -99999), transaction("a4", "2026-08-01", -800, "Health"),
      transaction("a5", "2026-06-01", -777, "Groceries", { customerId: "OTHER" })];
    const result = analyze("whatif", { query: { ...query, start: "2026-08-01", categories: ["Groceries"] }, percent: 50 }, rows);
    expect(value(result, "Hypothetical reduction (50%)").amountCents).toBe(102);
    expect(value(result, "Hypothetical remaining spending").amountCents).toBe(101);
    // 304 / 3 floors to 101 cents; 50% rounds to 51 cents, then 51 × 12 = 612.
    expect(value(result, "Monthly average (complete months)")).toMatchObject({ amountCents: 101, count: 3 });
    expect(value(result, "Hypothetical monthly reduction (50%)").amountCents).toBe(51);
    expect(value(result, "Hypothetical annual reduction (50%)").amountCents).toBe(612);
    expect(result.evidence.map(row => row.id).sort()).toEqual(["a1", "a2"]);
    expect(result.assumptions.join(" ")).toContain("2026-06, 2026-07, 2026-08");
  });
  it("uses explicit availability, applies corrections and distinguishes no baseline from a zero baseline", () => {
    const op = operation("whatif", { query: { ...query, baskets: ["regular"] }, percent: 50 });
    const corrected = calculateAnalysis(fixture, "C", op, { a1: "regular" }, referenceDate, "2026-07-01");
    expect(value(corrected, "Total spending").amountCents).toBe(501);
    expect(value(corrected, "Monthly average (complete months)")).toMatchObject({ amountCents: 200, count: 2 });
    const zero = analyze("whatif", { percent: 20 }, []);
    expect(value(zero, "Hypothetical annual reduction (20%)").amountCents).toBe(0);
    const unavailable = calculateAnalysis([], "C", operation("whatif", { percent: 20, query: { ...query, start: "2026-09-01", end: "2026-09-10" } }), {}, referenceDate, "2026-09-01");
    expect(unavailable.sections).toHaveLength(1);
    expect(unavailable.assumptions.join(" ")).toContain("annual projection is unavailable, not zero");
    expect(() => calculateAnalysis(fixture, "C", op, {}, referenceDate)).toThrow("explicit dataset start");
  });
});

describe("recent-period profile", () => {
  it("shows corrected basket shares, top categories and neutral monthly range including zero months", () => {
    const result = calculateAnalysis(fixture, "C", operation("profile", { top: 1 }), { a5: "regular" }, referenceDate);
    expect(value(result, "Regular essentials")).toMatchObject({ amountCents: 539, sharePercent: 51.8 });
    expect(result.sections[1].rows.map(row => [row.label, row.amountCents])).toEqual([["Housing", 400], ["Other", 640]]);
    // Housing 0,0,400 outranks Groceries 101,0,202 despite Groceries having two nonzero months.
    expect(result.sections[2].rows[0]).toMatchObject({ label: "Housing", amountCents: 400, count: 3 });
    expect(result.assumptions.join(" ")).toContain("maximum-minus-minimum");
  });
  it("has no most-variable category for no records and rejects partial or filtered profiles", () => {
    const empty = analyze("profile", {}, []);
    expect(empty.sections[0].rows.every(row => row.amountCents === 0 && row.sharePercent === null)).toBe(true);
    expect(empty.sections[2].rows).toEqual([]);
    expect(() => analyze("profile", { query: { ...query, start: "2026-06-02" } })).toThrow("complete calendar");
    expect(() => analyze("profile", { query: { ...query, categories: ["Groceries"] } })).toThrow("unfiltered");
  });
});

describe("analysis date and operation validation", () => {
  it.each<AnalysisOperation["kind"]>(["breakdown", "comparison", "trend", "cashflow", "whatif", "profile"])("rejects future or reversed periods for %s", kind => {
    expect(() => analyze(kind, { query: { ...query, end: "2026-09-11" } })).toThrow("period up to the current date");
    expect(() => analyze(kind, { query: { ...query, start: "2026-09-01" } })).toThrow("period up to the current date");
  });
  it("validates comparison dates and required parameters", () => {
    expect(() => analyze("comparison", { comparePeriod: { start: "2026-09-01", end: "2026-09-11" } })).toThrow("period up to the current date");
    expect(() => analyze("comparison", { comparePeriod: { start: "2026-08-02", end: "2026-08-01" } })).toThrow("period up to the current date");
    expect(() => analyze("comparison")).toThrow("comparison period");
    expect(() => analyze("breakdown")).toThrow("dimension");
    expect(() => analyze("whatif")).toThrow("percentage");
    expect(() => analyze("whatif", { percent: 101 })).toThrow();
  });

  it("compares last winter's Transportation with a normal month, counting zero months", () => {
    const real = raw.transactions as unknown as Transaction[];
    const customerId = raw.customerId;
    const ref = "2026-09-16";
    const run = (date: string) => calculateAnalysis(real, customerId,
      operation("season", { query: winterQuery(date) }), {}, date, "2025-09-01");
    const result = run(ref);
    const facts = seasonFacts(result);
    expect(result.title).toBe("Winter transport vs a normal month");
    expect(facts.normal).toMatchObject({ label: "Sep 2025 – Aug 2026", amountCents: 20057, count: 10 });
    expect(facts.months.map(row => [row.label, row.amountCents, row.count])).toEqual([["December 2025", 72989, 16], ["January 2026", 78009, 17]]);
    expect(facts.winterAverage.amountCents).toBe(75499);
    expect([facts.extraCents, facts.percent]).toEqual([55442, 276]);
    expect(result.evidenceCount).toBe(33);
    expect(result.evidence.reduce((sum, row) => sum + row.amountCents, 0)).toBe(150998);
    expect(() => run("2026-01-15")).toThrow("No complete winter");
  });
});

describe("what-if insight", () => {
  const nbsp = (text: string) => text.replaceAll("\u00a0", " ");
  const rows = [transaction("w1", "2026-06-05", -10000, "Restaurants"), transaction("w2", "2026-07-05", -20000, "Restaurants"),
    transaction("w3", "2026-08-05", -30000, "Restaurants"), transaction("w4", "2026-09-05", -25000, "Restaurants")];
  const insight = (percent: number, context: Partial<Parameters<typeof whatIfInsight>[1]> = {}, data = rows, changes: Partial<SpendingQuery> = {}) => {
    const result = calculateAnalysis(data, "C", operation("whatif", { percent, query: { ...query, start: "2026-09-01", end: "2026-09-10", categories: ["Restaurants"], ...changes } }), {}, referenceDate, "2026-06-01");
    return whatIfInsight(whatIfFacts(result), { goalMonthlyCents: 0, safeToSaveCents: 0, referenceDate, ...context });
  };
  it("compares with safe to save, then with a goal, else not at all", () => {
    // Usual month 20000 cents; 20% is 4000.
    const safe = insight(20, { safeToSaveCents: 1500 });
    expect(nbsp(safe.headline)).toBe("Trimming Restaurants by 20% would free 40,00 € a month, or 480,00 € over a year.");
    expect(nbsp(safe.supporting[0])).toBe("That's more than double the 15,00 € that usually stays free to save.");
    expect(safe.supporting[1]).toContain("Restaurants spending is already past a usual month, so the rest of September");
    expect(nbsp(safe.message)).toContain("would free 40,00 € a month, more than double what usually stays free to save.");
    expect(nbsp(insight(20, { safeToSaveCents: 4000 }).supporting[0])).toContain("more than the 40,00 €");
    expect(nbsp(insight(20, { safeToSaveCents: 10000 }).supporting[0])).toContain("about 40% of the 100,00 €");
    expect(insight(20, { safeToSaveCents: 4000, goalMonthlyCents: 4000 }).supporting[0]).toBe("That covers what your goal needs each month.");
    expect(nbsp(insight(20, { goalMonthlyCents: 8000 }).message)).toContain("about 50% of what your goal needs each month");
    expect(insight(20).supporting).toEqual([expect.stringContaining("past a usual month")]);
    expect(nbsp(insight(20, { safeToSaveCents: 1500 }).message).match(/\d+,\d\d €/g)).toHaveLength(1);
  });
  it("handles 0%, 100%, tiny, zero baseline and missing complete months", () => {
    expect(insight(0).headline).toBe("A 0% trim leaves spending unchanged.");
    expect(insight(100).headline).toContain("Skipping Restaurants entirely would free");
    const tiny = insight(1, { safeToSaveCents: 500 }, [transaction("t1", "2026-08-05", -300, "Restaurants")]);
    expect(tiny.supporting.join(" ")).toContain("Bigger categories may matter more.");
    expect(tiny.supporting[0]).not.toContain("%");
    expect(insight(20, {}, []).headline).toBe("No Restaurants spending in a usual month, so a trim frees nothing.");
    const none = calculateAnalysis(rows, "C", operation("whatif", { percent: 20, query: { ...query, start: "2026-09-01", end: "2026-09-10", categories: ["Restaurants"] } }), {}, referenceDate, "2026-09-01");
    const result = whatIfInsight(whatIfFacts(none), { goalMonthlyCents: 0, safeToSaveCents: 0, referenceDate });
    expect(nbsp(result.headline)).toBe("Trimming Restaurants by 20% would come to 50,00 € in this period.");
    expect(result.supporting).toEqual(["There isn't a full month yet for a monthly figure."]);
  });
  it("adds the essentials note outside the everyday basket only", () => {
    expect(insight(20).supporting.join(" ")).toContain("Everyday spending can include essentials.");
    expect(insight(20, {}, rows, { baskets: ["everyday"] }).supporting.join(" ")).not.toContain("essentials");
  });
});
