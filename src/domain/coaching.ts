import {
  dateSchema,
  goalSchema,
  goalVerdictSchema,
  jarSchema,
  noticedSchema,
  safeToSaveSchema,
  safeToSpendWeekSchema,
  usualMonthSchema,
  type Basket,
  type Goal,
  type GoalVerdict,
  type JarStatus,
  type Noticed,
  type SafeToSave,
  type SafeToSpendWeek,
  type Transaction,
  type UsualComparison,
  type UsualMonth,
} from "@/shared/contracts";
import { calculateSpending, euros, nextDate } from "@/domain/spending";
import { recentCompleteQuery } from "@/domain/exploration";
import { isoWeekStart } from "@/domain/checkup";

const monthNameFormatter = new Intl.DateTimeFormat("en", {
  month: "long",
  timeZone: "UTC",
});

function monthsInPeriod(start: string, end: string): string[] {
  const months: string[] = [];
  const startYear = Number(start.slice(0, 4));
  const startMonth = Number(start.slice(5, 7));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5, 7));
  let y = startYear;
  let m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

function yearEarlier(date: string): string {
  const year = Number(date.slice(0, 4)) - 1;
  const monthDay = date.slice(5);
  if (monthDay === "02-29") {
    return `${year}-02-28`;
  }
  return `${year}-${monthDay}`;
}

export function balanceOn(
  rows: readonly Transaction[],
  customerId: string,
  date: string,
): number | null {
  dateSchema.parse(date);
  const matching = rows.filter(
    row => row.customerId === customerId && row.date <= date,
  );
  if (matching.length === 0) return null;
  matching.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.timestamp.localeCompare(b.timestamp) ||
      a.sourceRow - b.sourceRow,
  );
  const lastRow = matching[matching.length - 1];
  return lastRow.balanceAfterCents ?? null;
}

export type UsualMonthInput = {
  rows: readonly Transaction[];
  customerId: string;
  referenceDate: string;
  corrections: Record<string, Basket>;
  datasetStart: string;
};

export function usualMonth(input: UsualMonthInput): UsualMonth {
  const { rows, customerId, referenceDate, corrections, datasetStart } = input;
  dateSchema.parse(referenceDate);
  dateSchema.parse(datasetStart);
  const query = recentCompleteQuery(referenceDate, datasetStart, 6);
  const baseline = { start: query.start, end: query.end };
  const months = monthsInPeriod(query.start, query.end);
  const monthCount = months.length;

  const baselineSpending = calculateSpending(
    rows,
    customerId,
    query,
    corrections,
    referenceDate,
  );

  const regularCents = Math.floor(baselineSpending.baskets.regular / monthCount);
  const unexpectedCents = Math.floor(baselineSpending.baskets.unexpected / monthCount);
  const everydayCents = Math.floor(baselineSpending.baskets.everyday / monthCount);

  const flows = rows.filter(
    row => row.customerId === customerId && row.date >= query.start && row.date <= query.end,
  );
  const incomeRows = flows.filter(
    row => row.amountCents > 0 && (row.transactionType === "salary" || row.transactionType === "other_income"),
  );
  const investmentRows = flows.filter(
    row => row.amountCents < 0 && row.transactionType === "investment_deposit",
  );

  const totalIncomeCents = incomeRows.reduce((sum, row) => sum + row.amountCents, 0);
  const totalInvestmentCents = investmentRows.reduce((sum, row) => sum - row.amountCents, 0);

  const incomeCents = Math.floor(totalIncomeCents / monthCount);
  const investmentCents = Math.floor(totalInvestmentCents / monthCount);

  const everydayByMonth = months.map(m => {
    const spentCents = baselineSpending.evidence
      .filter(row => row.basket === "everyday" && row.date.startsWith(m))
      .reduce((sum, row) => sum + row.amountCents, 0);
    return { month: m, spentCents };
  });

  return usualMonthSchema.parse({
    baseline,
    monthCount,
    incomeCents,
    regularCents,
    unexpectedCents,
    everydayCents,
    investmentCents,
    everydayByMonth,
  });
}

export function safeToSave(usual: UsualMonth): SafeToSave {
  usualMonthSchema.parse(usual);
  const safeToSaveCents = Math.max(
    0,
    usual.incomeCents - usual.regularCents - usual.unexpectedCents - usual.everydayCents,
  );
  return safeToSaveSchema.parse({ usual, safeToSaveCents });
}

export function safeToSpendWeek(
  jar: JarStatus,
  referenceDate: string,
): SafeToSpendWeek {
  dateSchema.parse(referenceDate);
  jarSchema.parse(jar);
  const dailyCents = jar.dailyRemainingCents;
  const day = new Date(`${referenceDate}T12:00:00Z`).getUTCDay();
  const isoWeekday = day === 0 ? 7 : day;
  const daysLeftInWeek = Math.min(Math.max(0, 7 - isoWeekday), jar.daysLeft);
  const amountCents = dailyCents * daysLeftInWeek;
  let weekEnd = isoWeekStart(referenceDate);
  for (let i = 0; i < 6; i++) {
    weekEnd = nextDate(weekEnd);
  }
  return safeToSpendWeekSchema.parse({
    dailyCents,
    daysLeftInWeek,
    amountCents,
    weekEnd,
  });
}

export function goalVerdict(
  goal: Goal,
  usual: UsualMonth,
  referenceDate: string,
): GoalVerdict {
  goalSchema.parse(goal);
  usualMonthSchema.parse(usual);
  dateSchema.parse(referenceDate);
  const currentMonth = referenceDate.slice(0, 7);
  if (goal.targetMonth <= currentMonth) {
    throw new RangeError("Target month must be after current month");
  }
  const currentYear = Number(referenceDate.slice(0, 4));
  const currentMon = Number(referenceDate.slice(5, 7));
  const targetYear = Number(goal.targetMonth.slice(0, 4));
  const targetMon = Number(goal.targetMonth.slice(5, 7));
  const months = (targetYear - currentYear) * 12 + (targetMon - currentMon);
  if (months <= 0) {
    throw new RangeError("Target month must be after current month");
  }
  const monthlyCents = Math.floor((goal.amountCents + months - 1) / months);
  const rawNeeded =
    usual.incomeCents -
    usual.regularCents -
    usual.unexpectedCents -
    usual.investmentCents -
    monthlyCents;
  const neededJarCents = Math.max(0, rawNeeded);
  const cutCents = Math.max(0, usual.everydayCents - neededJarCents);
  const history = usual.everydayByMonth.map(m => ({
    month: m.month,
    spentCents: m.spentCents,
    inside: m.spentCents <= neededJarCents,
  }));
  const monthsInside = history.filter(m => m.inside).length;
  const lowestMonthCents = Math.min(
    ...usual.everydayByMonth.map(m => m.spentCents),
  );

  let verdict: GoalVerdict["verdict"];
  if (rawNeeded >= usual.everydayCents) {
    verdict = "on_track";
  } else if (rawNeeded < lowestMonthCents) {
    verdict = "out_of_reach";
  } else {
    verdict = "stretch";
  }

  return goalVerdictSchema.parse({
    goal,
    months,
    monthlyCents,
    neededJarCents,
    cutCents,
    verdict,
    monthsInside,
    lowestMonthCents,
    history,
  });
}

export type NoticedEntryInput = {
  place: "entry";
  rows: readonly Transaction[];
  customerId: string;
  referenceDate: string;
  safe?: SafeToSave;
  corrections?: Record<string, Basket>;
  datasetStart?: string;
};

export type NoticedSaveInput = {
  place: "save";
  safe: SafeToSave;
};

export type NoticedGoalInput = {
  place: "goal";
  verdict: GoalVerdict;
  comparison: UsualComparison;
};

export type NoticedJarInput = {
  place: "jar";
  jar: JarStatus;
  goal?: Goal | null;
};

export type NoticedSpenderInput = {
  place: "spender";
  usual: UsualMonth;
};

export type NoticedInput =
  | NoticedEntryInput
  | NoticedSaveInput
  | NoticedGoalInput
  | NoticedJarInput
  | NoticedSpenderInput;

export function noticed(input: NoticedInput): Noticed | null {
  switch (input.place) {
    case "entry": {
      const balNow = balanceOn(input.rows, input.customerId, input.referenceDate);
      const dateAgo = yearEarlier(input.referenceDate);
      const balAgo = balanceOn(input.rows, input.customerId, dateAgo);
      if (balNow !== null && balAgo !== null) {
        if (balNow < balAgo) {
          const diff = balAgo - balNow;
          return noticedSchema.parse({
            rule: "balance_lower",
            text: `Your balance is ${euros(diff)} lower than a year ago.`,
            question: "Why is my balance lower than a year ago?",
          });
        }
        return null;
      }
      // If a needed row has no balance, balanceOn returns null and entry returns
      // invest_over_left row instead, or null if that rule does not fire.
      let safe = input.safe;
      if (!safe) {
        try {
          const datasetStart =
            input.datasetStart ??
            input.rows.reduce(
              (min, r) => (!min || r.date < min ? r.date : min),
              "",
            );
          const usual = usualMonth({
            rows: input.rows,
            customerId: input.customerId,
            referenceDate: input.referenceDate,
            corrections: input.corrections ?? {},
            datasetStart,
          });
          safe = safeToSave(usual);
        } catch {
          return null;
        }
      }
      return noticed({ place: "save", safe });
    }
    case "save": {
      const { safe } = input;
      if (safe.usual.investmentCents > safe.safeToSaveCents) {
        return noticedSchema.parse({
          rule: "invest_over_left",
          text: `You invest ${euros(safe.usual.investmentCents)} a month, but a usual month leaves ${euros(safe.safeToSaveCents)}. Your balance pays the difference.`,
          question: "Where does my everyday money go?",
        });
      }
      return null;
    }
    case "goal": {
      const { verdict, comparison } = input;
      if (verdict.verdict === "out_of_reach") return null;
      if (!comparison.rows.length) return null;
      const sortedRows = [...comparison.rows].sort(
        (a, b) => b.usualCents - a.usualCents || a.category.localeCompare(b.category),
      );
      const largest = sortedRows[0];
      if (!largest || largest.usualCents <= 0) return null;
      // shortcut: the goal text reads right for plural category names (Groceries), revisit if other categories show.
      return noticedSchema.parse({
        rule: "largest_category",
        text: `${largest.category} are ${euros(largest.usualCents)} of your usual everyday month.`,
        question: `What if I cut ${largest.category.toLowerCase()} by 20 %?`,
      });
    }
    case "jar": {
      const { jar, goal } = input;
      if (jar.daysLeft > 0 && jar.projectedOverCents > 0) {
        const monthName = monthNameFormatter.format(
          new Date(`${jar.period.start}T12:00:00Z`),
        );
        const over = euros(jar.projectedOverCents);
        const targetJar = goal ? "over the goal jar." : "over the jar.";
        return noticedSchema.parse({
          rule: "jar_pace",
          text: `At your pace so far, ${monthName} ends ${over} ${targetJar}`,
          question: "What is different this month?",
        });
      }
      return null;
    }
    case "spender": {
      const { usual } = input;
      if (!usual.everydayByMonth.length) return null;
      const last = usual.everydayByMonth[usual.everydayByMonth.length - 1];
      if (last.spentCents > usual.everydayCents) {
        const monthName = monthNameFormatter.format(
          new Date(`${last.month}-01T12:00:00Z`),
        );
        return noticedSchema.parse({
          rule: "month_over_usual",
          text: `${monthName} everyday spending was ${euros(last.spentCents)}. Your usual month is ${euros(usual.everydayCents)}.`,
          question: "What have I spent more on than usual?",
        });
      }
      return null;
    }
  }
}
