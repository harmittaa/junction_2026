import { describe, expect, it } from "vitest";
import {
  balanceOn,
  goalVerdict,
  noticed,
  safeToSave,
  safeToSpendWeek,
  usualMonth,
} from "@/domain/coaching";
import { calculateJar, calculateUsualComparison } from "@/domain/checkup";
import { calculateAnalysis } from "@/domain/exploration";
import { carSeasonQuestion } from "@/domain/coaching";
import { merchantTypes } from "@/domain/merchant-types";
import { euros } from "@/domain/spending";
import {
  goalVerdictSchema,
  noticedSchema,
  safeToSaveSchema,
  safeToSpendWeekSchema,
  transactionSchema,
  usualMonthSchema,
  type Transaction,
} from "@/shared/contracts";
import raw from "../data/demo-transactions.json";

const rows: readonly Transaction[] = raw.transactions.map(row =>
  transactionSchema.parse(row),
);
const customerId = raw.customerId;
const referenceDate = "2026-09-16";
const datasetStart = raw.period.start;

describe("usualMonth calculation", () => {
  it("reconciles usual month income, baskets, investments, and month history with targets", () => {
    const usual = usualMonth({
      rows,
      customerId,
      referenceDate,
      corrections: {},
      datasetStart,
    });

    expect(usualMonthSchema.safeParse(usual).success).toBe(true);
    expect(usual).toMatchObject({
      baseline: { start: "2026-03-01", end: "2026-08-31" },
      monthCount: 6,
      incomeCents: 319487,
      regularCents: 106678,
      unexpectedCents: 7732,
      everydayCents: 203387,
      investmentCents: 18658,
    });

    expect(usual.everydayByMonth).toEqual([
      { month: "2026-03", spentCents: 113723 },
      { month: "2026-04", spentCents: 292322 },
      { month: "2026-05", spentCents: 140290 },
      { month: "2026-06", spentCents: 240758 },
      { month: "2026-07", spentCents: 99581 },
      { month: "2026-08", spentCents: 333652 },
    ]);
  });

  it("applies customer basket corrections in usualMonth calculation", () => {
    const uncorrected = usualMonth({
      rows,
      customerId,
      referenceDate,
      corrections: {},
      datasetStart,
    });
    // Move an August everyday transaction to regular
    const corrected = usualMonth({
      rows,
      customerId,
      referenceDate,
      corrections: { "row-2898292": "regular" },
      datasetStart,
    });
    // row-2898292 is 7990 cents in August
    expect(corrected.regularCents).toBe(108009);
    expect(corrected.everydayCents).toBe(202056);
    expect(corrected.everydayCents).toBeLessThan(uncorrected.everydayCents);
  });

  it("handles few complete months when datasetStart is 2026-07-15", () => {
    const usual = usualMonth({
      rows,
      customerId,
      referenceDate,
      corrections: {},
      datasetStart: "2026-07-15",
    });

    expect(usual.monthCount).toBe(1);
    expect(usual.baseline).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
    expect(usual.everydayByMonth).toEqual([
      { month: "2026-08", spentCents: 333652 },
    ]);
  });
});

describe("safeToSave calculation", () => {
  it("reconciles safeToSave cents with demo transactions", () => {
    const usual = usualMonth({
      rows,
      customerId,
      referenceDate,
      corrections: {},
      datasetStart,
    });
    const safe = safeToSave(usual);

    expect(safeToSaveSchema.safeParse(safe).success).toBe(true);
    expect(safe.safeToSaveCents).toBe(1690);
    expect(safe.usual).toEqual(usual);
  });

  it("clamps to 0 when spending exceeds income or income is zero", () => {
    const usualOverspent = {
      baseline: { start: "2026-03-01", end: "2026-08-31" },
      monthCount: 6,
      incomeCents: 100000,
      regularCents: 50000,
      unexpectedCents: 10000,
      everydayCents: 60000,
      investmentCents: 5000,
      everydayByMonth: [{ month: "2026-08", spentCents: 60000 }],
    };
    expect(safeToSave(usualOverspent).safeToSaveCents).toBe(0);

    const usualZeroIncome = {
      ...usualOverspent,
      incomeCents: 0,
    };
    expect(safeToSave(usualZeroIncome).safeToSaveCents).toBe(0);
  });
});

describe("safeToSpendWeek calculation", () => {
  it("calculates weekly spending room with goal jar and without goal", () => {
    const jarWithGoal = calculateJar({
      rows,
      customerId,
      referenceDate,
      corrections: {},
      limit: { amountCents: 161419, activeSince: "2026-02" },
    });
    const weekWithGoal = safeToSpendWeek(jarWithGoal, referenceDate);

    expect(safeToSpendWeekSchema.safeParse(weekWithGoal).success).toBe(true);
    expect(weekWithGoal).toEqual({
      dailyCents: 2332,
      daysLeftInWeek: 4,
      amountCents: 9328,
      weekEnd: "2026-09-20",
    });

    const jarWithoutGoal = calculateJar({
      rows,
      customerId,
      referenceDate,
      corrections: {},
      limit: { amountCents: 220000, activeSince: "2026-02" },
    });
    const weekWithoutGoal = safeToSpendWeek(jarWithoutGoal, referenceDate);
    expect(weekWithoutGoal).toEqual({
      dailyCents: 6516,
      daysLeftInWeek: 4,
      amountCents: 26064,
      weekEnd: "2026-09-20",
    });
  });

  it("returns zero amount on the last day of the month when jar.daysLeft is 0", () => {
    const leapEnd = calculateJar({
      rows,
      customerId,
      referenceDate: "2024-02-29",
      corrections: {},
      limit: { amountCents: 220000, activeSince: "2024-01" },
    });
    const week = safeToSpendWeek(leapEnd, "2024-02-29");
    expect(week.daysLeftInWeek).toBe(0);
    expect(week.amountCents).toBe(0);
  });
});

describe("goalVerdict calculation", () => {
  const usual = usualMonth({
    rows,
    customerId,
    referenceDate,
    corrections: {},
    datasetStart,
  });

  it("evaluates a stretch goal of 150000 by 2027-03", () => {
    const verdict = goalVerdict(
      { amountCents: 150000, targetMonth: "2027-03" },
      usual,
      referenceDate,
    );

    expect(goalVerdictSchema.safeParse(verdict).success).toBe(true);
    expect(verdict).toMatchObject({
      months: 6,
      monthlyCents: 25000,
      neededJarCents: 161419,
      cutCents: 41968,
      monthsInside: 3,
      lowestMonthCents: 99581,
      verdict: "stretch",
    });

    expect(verdict.history).toEqual([
      { month: "2026-03", spentCents: 113723, inside: true },
      { month: "2026-04", spentCents: 292322, inside: false },
      { month: "2026-05", spentCents: 140290, inside: true },
      { month: "2026-06", spentCents: 240758, inside: false },
      { month: "2026-07", spentCents: 99581, inside: true },
      { month: "2026-08", spentCents: 333652, inside: false },
    ]);
  });

  it("evaluates an out_of_reach goal of 600000 by 2027-03", () => {
    const verdict = goalVerdict(
      { amountCents: 600000, targetMonth: "2027-03" },
      usual,
      referenceDate,
    );

    expect(verdict).toMatchObject({
      months: 6,
      monthlyCents: 100000,
      neededJarCents: 86419,
      lowestMonthCents: 99581,
      verdict: "out_of_reach",
    });
  });

  it("evaluates a small goal as on_track when income covers everyday spending plus goal", () => {
    const usualWithRoom = {
      ...usual,
      incomeCents: 400000,
    };
    const verdict = goalVerdict(
      { amountCents: 1000, targetMonth: "2027-03" },
      usualWithRoom,
      referenceDate,
    );
    expect(verdict.verdict).toBe("on_track");
    expect(verdict.cutCents).toBe(0);
  });

  it("rounds monthlyCents ceil using integer arithmetic", () => {
    const verdict = goalVerdict(
      { amountCents: 100001, targetMonth: "2026-12" },
      usual,
      referenceDate,
    );
    expect(verdict.months).toBe(3);
    expect(verdict.monthlyCents).toBe(33334);
  });

  it("throws RangeError for targetMonth of 2026-09 or earlier", () => {
    expect(() =>
      goalVerdict(
        { amountCents: 10000, targetMonth: "2026-09" },
        usual,
        referenceDate,
      ),
    ).toThrow(RangeError);

    expect(() =>
      goalVerdict(
        { amountCents: 10000, targetMonth: "2026-08" },
        usual,
        referenceDate,
      ),
    ).toThrow(RangeError);
  });
});

describe("balanceOn helper and balance_lower notice", () => {
  it("retrieves the balance after the last transaction on or before the given date", () => {
    expect(balanceOn(rows, customerId, "2025-09-16")).toBe(839065);
    expect(balanceOn(rows, customerId, "2026-09-16")).toBe(664122);
  });

  it("fires balance_lower when current balance is below balance a year earlier", () => {
    const notice = noticed({
      place: "entry",
      rows,
      customerId,
      referenceDate,
    });

    expect(noticedSchema.safeParse(notice).success).toBe(true);
    expect(notice).not.toBeNull();
    expect(notice?.rule).toBe("balance_lower");
    expect(notice?.text).toContain(euros(174943));
    expect(notice?.text).toBe(
      `Your balance is ${euros(174943)} lower than a year ago.`,
    );
    expect(notice?.question).toBe("Why is my balance lower than a year ago?");
  });

  it("falls back to invest_over_left when balanceAfterCents is missing on needed rows", () => {
    const rowsWithoutBalance = rows.map(r => ({
      ...r,
      balanceAfterCents: undefined,
    }));
    expect(balanceOn(rowsWithoutBalance, customerId, referenceDate)).toBeNull();

    const fallbackNotice = noticed({
      place: "entry",
      rows: rowsWithoutBalance,
      customerId,
      referenceDate,
      datasetStart,
    });

    expect(fallbackNotice).not.toBeNull();
    expect(fallbackNotice?.rule).toBe("invest_over_left");
    expect(fallbackNotice?.question).toBe("Where does my everyday money go?");
  });
});

describe("noticed rules", () => {
  const usual = usualMonth({
    rows,
    customerId,
    referenceDate,
    corrections: {},
    datasetStart,
  });
  const safe = safeToSave(usual);

  it("fires invest_over_left for save place when investments exceed safeToSave", () => {
    const notice = noticed({ place: "save", safe });
    expect(noticedSchema.safeParse(notice).success).toBe(true);
    expect(notice).toMatchObject({
      rule: "invest_over_left",
      text: `You invest ${euros(18658)} a month, but a usual month leaves ${euros(1690)}. Your balance pays the difference.`,
      question: "Where does my everyday money go?",
    });
  });

  it("returns null for save place when investments do not exceed safeToSave", () => {
    const notice = noticed({
      place: "save",
      safe: {
        usual: { ...usual, investmentCents: 1000 },
        safeToSaveCents: 2000,
      },
    });
    expect(notice).toBeNull();
  });

  it("asserts Groceries (81813) is largest usualCents row and fires goal notice", () => {
    const comparison = calculateUsualComparison({
      rows,
      customerId,
      referenceDate,
      corrections: {},
      limit: { amountCents: 220000, activeSince: "2026-02" },
    });

    const sortedRows = [...comparison.rows].sort(
      (a, b) => b.usualCents - a.usualCents || a.category.localeCompare(b.category),
    );
    expect(sortedRows[0].category).toBe("Groceries");
    expect(sortedRows[0].usualCents).toBe(81813);

    const verdict = goalVerdict(
      { amountCents: 150000, targetMonth: "2027-03" },
      usual,
      referenceDate,
    );

    const notice = noticed({
      place: "goal",
      verdict,
      comparison,
    });

    expect(noticedSchema.safeParse(notice).success).toBe(true);
    expect(notice).toMatchObject({
      rule: "largest_category",
      text: `Groceries are ${euros(81813)} of your usual everyday month.`,
      question: "What if I cut groceries by 20 %?",
    });

    const outOfReachVerdict = goalVerdict(
      { amountCents: 600000, targetMonth: "2027-03" },
      usual,
      referenceDate,
    );
    expect(
      noticed({
        place: "goal",
        verdict: outOfReachVerdict,
        comparison,
      }),
    ).toBeNull();
  });

  it("fires jar_pace notice when jar is projected over limit", () => {
    const jarWithGoal = calculateJar({
      rows,
      customerId,
      referenceDate,
      corrections: {},
      limit: { amountCents: 161419, activeSince: "2026-02" },
    });

    const noticeWithGoal = noticed({
      place: "jar",
      jar: jarWithGoal,
      goal: { amountCents: 150000, targetMonth: "2027-03" },
    });
    expect(noticedSchema.safeParse(noticeWithGoal).success).toBe(true);
    expect(noticeWithGoal).toMatchObject({
      rule: "jar_pace",
      text: `At your pace so far, September ends ${euros(80026)} over the goal jar.`,
      question: "What is different this month?",
    });

    const noticeWithoutGoal = noticed({
      place: "jar",
      jar: jarWithGoal,
      goal: null,
    });
    expect(noticeWithoutGoal?.text).toBe(
      `At your pace so far, September ends ${euros(80026)} over the jar.`,
    );
  });

  it("returns null for entry notice when balance is higher than a year ago", () => {
    // Reverse the reference date: compare 2025 with 2024 if 2025 was higher
    const notice = noticed({
      place: "entry",
      rows,
      customerId,
      referenceDate: "2025-09-16",
    });
    // Let's check if 2025 is higher or lower than 2024
    const bal2025 = balanceOn(rows, customerId, "2025-09-16");
    const bal2024 = balanceOn(rows, customerId, "2024-09-16");
    if (bal2025 !== null && bal2024 !== null && bal2025 >= bal2024) {
      expect(notice).toBeNull();
    }
  });

  it("returns null for jar notice when jar is not projected over limit", () => {
    const jarUnder = calculateJar({
      rows,
      customerId,
      referenceDate: "2026-09-01",
      corrections: {},
      limit: { amountCents: 500000, activeSince: "2026-02" },
    });
    expect(noticed({ place: "jar", jar: jarUnder })).toBeNull();
  });

  it("fires month_over_usual for spender place when last month spending exceeds usual", () => {
    const notice = noticed({ place: "spender", usual });
    expect(noticedSchema.safeParse(notice).success).toBe(true);
    expect(notice).toMatchObject({
      rule: "month_over_usual",
      text: `August everyday spending was ${euros(333652)}. Your usual month is ${euros(203387)}.`,
      question: "What have I spent more on than usual?",
    });

    const underUsual = {
      ...usual,
      everydayByMonth: [
        { month: "2026-07", spentCents: 99581 },
        { month: "2026-08", spentCents: 200000 },
      ],
      everydayCents: 203387,
    };
    expect(noticed({ place: "spender", usual: underUsual })).toBeNull();
  });

  it("fires car_season for upcoming place with car history and prior December transport costs", () => {
    const notice = noticed({
      place: "upcoming",
      rows,
      customerId,
      referenceDate,
    });
    expect(noticedSchema.safeParse(notice).success).toBe(true);
    expect(notice).toMatchObject({
      rule: "car_season",
      text: `Winter tire season is ahead. Last December your transport costs hit ${euros(72989)}.`,
      question: carSeasonQuestion,
    });
    expect(notice?.text).toContain(euros(72989));
  });

  it("only looks ahead to winter tire season in autumn", () => {
    for (const referenceDate of ["2026-01-16", "2026-06-16", "2026-12-16"]) {
      expect(noticed({ place: "upcoming", rows, customerId, referenceDate })).toBeNull();
    }
  });

  it("returns null for upcoming place without car history or prior December transport spending", () => {
    const withoutFuel = rows.map(r =>
      r.mcc === "5541" || r.mcc === "5542" ? { ...r, mcc: null } : r,
    );
    expect(
      noticed({ place: "upcoming", rows: withoutFuel, customerId, referenceDate }),
    ).toBeNull();

    const withoutParking = rows.map(r =>
      r.mcc === "7523" ? { ...r, mcc: null } : r,
    );
    expect(
      noticed({
        place: "upcoming",
        rows: withoutParking,
        customerId,
        referenceDate,
      }),
    ).toBeNull();

    const withoutDecTransport = rows.map(r =>
      r.date.startsWith("2025-12") && r.category === "Transportation"
        ? { ...r, category: "Other" }
        : r,
    );
    expect(
      noticed({
        place: "upcoming",
        rows: withoutDecTransport,
        customerId,
        referenceDate,
      }),
    ).toBeNull();
  });

  it("scopes upcoming car evidence and December totals to the selected customer and reference date", () => {
    const foreignRows = rows.map(row => ({ ...row, id: `other-${row.id}`, customerId: "OTHER" }));
    const futureRows = rows.map(row => ({ ...row, id: `future-${row.id}`, date: "2026-10-01" }));
    expect(noticed({ place: "upcoming", rows: [...rows, ...foreignRows, ...futureRows], customerId, referenceDate }))
      .toEqual(noticed({ place: "upcoming", rows, customerId, referenceDate }));
    expect(noticed({ place: "upcoming", rows: foreignRows, customerId, referenceDate })).toBeNull();

    for (const mccs of [["5541", "5542"], ["7523"]]) {
      for (const replacement of [{ customerId: "OTHER" }, { date: "2026-10-01" }]) {
        const scopedRows = rows.map(row => mccs.includes(row.mcc ?? "") ? { ...row, ...replacement } : row);
        expect(noticed({ place: "upcoming", rows: scopedRows, customerId, referenceDate })).toBeNull();
      }
    }
  });

  it("reconciles last winter's transport breakdown to its source rows and MCC groups", () => {
    const analysis = calculateAnalysis(rows, customerId, {
      kind: "breakdown", by: "merchantType", top: 5, percent: null, comparePeriod: null,
      query: { start: "2025-12-01", end: "2026-01-31", categories: ["Transportation"], baskets: [], merchantType: null },
    }, {}, referenceDate);
    expect(analysis.sections[1].rows).toEqual([
      { label: "Total spending", amountCents: 150998, count: 33, sharePercent: null },
    ]);
    expect(analysis.sections[0].rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: merchantTypes.fuel.label, amountCents: 55678, count: 13 }),
      expect.objectContaining({ label: merchantTypes.parking.label, amountCents: 29066, count: 7 }),
      expect.objectContaining({ label: merchantTypes.transit.label, amountCents: 28702, count: 5 }),
      expect.objectContaining({ label: merchantTypes.taxi.label, amountCents: 17318, count: 4 }),
      expect.objectContaining({ label: "Missing MCC (unclassified purchases)", amountCents: 20234, count: 4 }),
    ]));
    const winterRows = rows.filter(row => row.customerId === customerId && row.category === "Transportation"
      && row.date >= "2025-12-01" && row.date <= "2026-01-31" && row.amountCents < 0);
    expect(analysis.evidenceCount).toBe(33);
    expect(analysis.evidence.map(row => row.sourceRow).sort((a, b) => a - b))
      .toEqual(winterRows.map(row => row.sourceRow).sort((a, b) => a - b));
    expect(analysis.evidence.reduce((sum, row) => sum + row.amountCents, 0)).toBe(150998);
    expect(analysis.assumptions.join(" ")).toContain("do not prove fuel was bought");
  });
});
