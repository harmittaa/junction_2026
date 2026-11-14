import {
  type Analysis,
  type CoachView,
  type GoalVerdict,
  type Noticed,
  type SafeToSave,
} from "@/shared/contracts";

type EvidenceItem = Analysis["evidence"][number];

export const goalSpentHistory = [
  { month: "2026-03", spentCents: 99581 },
  { month: "2026-04", spentCents: 205000 },
  { month: "2026-05", spentCents: 158000 },
  { month: "2026-06", spentCents: 266089 },
  { month: "2026-07", spentCents: 158000 },
  { month: "2026-08", spentCents: 333652 },
] as const;

export function buildGoalHistory(neededJarCents: number) {
  return goalSpentHistory.map(item => ({
    month: item.month,
    spentCents: item.spentCents,
    inside: item.spentCents <= neededJarCents,
  }));
}

export const saveNoticedFixture: Noticed = {
  rule: "invest_over_left",
  text: "You invest 186,58 € a month, but a usual month leaves 16,90 €. Your balance pays the difference.",
  question: "Where does my everyday money go?",
};

export const saveFixture: SafeToSave = {
  usual: {
    baseline: { start: "2026-03-01", end: "2026-08-31" },
    monthCount: 6,
    incomeCents: 319487,
    regularCents: 106678,
    unexpectedCents: 7732,
    everydayCents: 203387,
    investmentCents: 18658,
    everydayByMonth: goalSpentHistory.map(h => ({ month: h.month, spentCents: h.spentCents })),
  },
  safeToSaveCents: 1690,
};

export const stretchNoticedFixture: Noticed = {
  rule: "largest_category",
  text: "Groceries are 818,13 € of your usual everyday month.",
  question: "What if I cut groceries by 20 %?",
};

export const stretchFixture: GoalVerdict = {
  goal: { amountCents: 150000, targetMonth: "2027-03" },
  months: 6,
  monthlyCents: 25000,
  neededJarCents: 161419,
  cutCents: 41968,
  verdict: "stretch",
  monthsInside: 3,
  lowestMonthCents: 99581,
  history: buildGoalHistory(161419),
};

export const outOfReachFixture: GoalVerdict = {
  goal: { amountCents: 600000, targetMonth: "2027-03" },
  months: 6,
  monthlyCents: 100000,
  neededJarCents: 86419,
  cutCents: 116968,
  verdict: "out_of_reach",
  monthsInside: 0,
  lowestMonthCents: 99581,
  history: buildGoalHistory(86419),
};

// synthetic: CUST04060 cannot be on track: the most any goal leaves is 186,419 below usual 203,387
export const onTrackFixture: GoalVerdict = {
  goal: { amountCents: 12000, targetMonth: "2027-03" },
  months: 6,
  monthlyCents: 2000,
  neededJarCents: 210000,
  cutCents: 0,
  verdict: "on_track",
  monthsInside: 4,
  lowestMonthCents: 99581,
  history: buildGoalHistory(210000),
};

function generateEvidence(): EvidenceItem[] {
  const rows: EvidenceItem[] = [];
  let sourceRow = 100;

  // Regular: 4 rows = 98,719
  const regTotal = 98719;
  const regBase = Math.floor(regTotal / 4);
  const regAmounts = [regBase, regBase, regBase, regTotal - regBase * 3];
  regAmounts.forEach((amt, idx) => {
    rows.push({
      id: `reg-${idx + 1}`,
      sourceRow: sourceRow++,
      date: `2026-08-${String(28 - idx * 5).padStart(2, "0")}`,
      category: idx === 0 ? "Housing" : "Utilities",
      merchant: `MRC-REG-000${idx + 1}`,
      amountCents: amt,
      basket: "regular",
    });
  });

  // Unexpected: 3 rows = 12,507
  const unexpTotal = 12507;
  const unexpBase = Math.floor(unexpTotal / 3);
  const unexpAmounts = [unexpBase, unexpBase, unexpTotal - unexpBase * 2];
  unexpAmounts.forEach((amt, idx) => {
    rows.push({
      id: `unexp-${idx + 1}`,
      sourceRow: sourceRow++,
      date: `2026-08-${String(24 - idx * 7).padStart(2, "0")}`,
      category: "Health",
      merchant: `MRC-UNE-000${idx + 1}`,
      amountCents: amt,
      basket: "unexpected",
    });
  });

  // Everyday: 52 rows = 333,652
  const everyTotal = 333652;
  const everyBase = Math.floor(everyTotal / 52);
  const everyCategories = ["Groceries", "Restaurants", "Entertainment", "Lifestyle", "Transportation", "Home & Tech"];
  for (let idx = 0; idx < 52; idx++) {
    const amt = idx === 51 ? everyTotal - everyBase * 51 : everyBase;
    const day = 29 - Math.floor(idx / 2);
    rows.push({
      id: `ev-${idx + 1}`,
      sourceRow: sourceRow++,
      date: `2026-08-${String(Math.max(1, day)).padStart(2, "0")}`,
      category: everyCategories[idx % everyCategories.length],
      merchant: `MRC-GRO-${String(idx + 10).padStart(4, "0")}`,
      amountCents: amt,
      basket: "everyday",
    });
  }

  // Sort descending by date
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export const profileEvidence = generateEvidence();

export const profileNoticedFixture: Noticed = {
  rule: "month_over_usual",
  text: "August everyday spending was 3 336,52 €. Your usual month is 2 033,87 €.",
  question: "What have I spent more on than usual?",
};

export const profileFixture: Analysis = {
  kind: "profile",
  query: {
    start: "2026-08-01",
    end: "2026-08-31",
    categories: [],
    baskets: [],
    merchantType: null,
  },
  title: "Profile · All spending",
  sections: [
    {
      label: "Basket shares",
      rows: [
        { label: "Regular essentials", amountCents: 98719, count: 4, sharePercent: 22.2 },
        { label: "Unexpected necessities", amountCents: 12507, count: 3, sharePercent: 2.8 },
        { label: "Everyday spending", amountCents: 333652, count: 52, sharePercent: 75.0 },
      ],
    },
    {
      label: "Top categories",
      rows: [
        { label: "Groceries", amountCents: 120000, count: 18, sharePercent: 27.0 },
        { label: "Restaurants", amountCents: 85000, count: 14, sharePercent: 19.1 },
        { label: "Lifestyle", amountCents: 65000, count: 10, sharePercent: 14.6 },
      ],
    },
    {
      label: "Most variable category (monthly range)",
      rows: [
        { label: "Restaurants", amountCents: 52000, count: 6, sharePercent: null },
      ],
    },
  ],
  evidence: profileEvidence,
  evidenceCount: 59,
  assumptions: [
    "Gross recorded spending counts negative purchases, housing and utilities payments; excludes income, transfers and refunds.",
    "Payments from 2026-08-01 through 2026-08-31, inclusive; current date 2026-09-01.",
    "Basket assignments are correctable interpretations, not changes to payment amounts.",
  ],
};

const baseView: Omit<CoachView, "activity" | "noticed"> = {
  revision: 1,
  demoDate: "2026-09-01",
  message: "Here is what your numbers say.",
  entryMessage: "Welcome back.",
  profile: {
    firstName: "Matti",
    everydayLimit: { amountCents: 200000, activeSince: "2026-03" },
  },
  checkup: {
    weekStart: "2026-08-31",
    completed: false,
    due: true,
    streak: 2,
    completedDates: ["2026-08-17", "2026-08-24"],
  },
  jar: {
    period: { start: "2026-08-01", end: "2026-08-31" },
    limitCents: 200000,
    spentCents: 333652,
    leftCents: 0,
    overCents: 133652,
    elapsedDays: 31,
    daysLeft: 0,
    dailySpentCents: 10762,
    dailyRemainingCents: 0,
    projectedCents: 333652,
    projectedOverCents: 133652,
    unexpectedCents: 12507,
    months: [{ month: "2026-08", spentCents: 333652, inside: false }],
    evidence: [],
  },
  move: null,
  goal: null,
  spendWeek: {
    dailyCents: 2857,
    daysLeftInWeek: 4,
    amountCents: 11428,
    weekEnd: "2026-09-06",
  },
  entryNoticed: null,
  habit: null,
  completedDates: ["2026-08-17", "2026-08-24"],
  categories: ["Groceries", "Restaurants", "Entertainment", "Lifestyle", "Transportation", "Utilities", "Housing"],
  period: { start: "2026-08-01", end: "2026-08-31" },
};

export const saveViewFixture: CoachView = {
  ...baseView,
  activity: { kind: "save", save: saveFixture },
  noticed: saveNoticedFixture,
};

export const stretchViewFixture: CoachView = {
  ...baseView,
  activity: { kind: "goal", verdict: stretchFixture },
  noticed: stretchNoticedFixture,
};

export const outOfReachViewFixture: CoachView = {
  ...baseView,
  activity: { kind: "goal", verdict: outOfReachFixture },
  noticed: null,
};

export const onTrackViewFixture: CoachView = {
  ...baseView,
  activity: { kind: "goal", verdict: onTrackFixture },
  noticed: null,
};

export const profileViewFixture: CoachView = {
  ...baseView,
  activity: { kind: "analysis", analysis: profileFixture },
  noticed: profileNoticedFixture,
};
