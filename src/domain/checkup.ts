import { dateSchema, monthlyLimitSchema, type Basket, type JarStatus, type MonthlyLimit,
  type OverspendInsight, type Transaction, type UsualComparison, type WeeklyCheckup } from "@/shared/contracts";
import { calculateSpending, euros } from "@/domain/spending";
import { formatDay } from "@/domain/dates";

type CheckupInput = {
  rows: readonly Transaction[];
  customerId: string;
  referenceDate: string;
  corrections: Record<string, Basket>;
  limit: MonthlyLimit;
  jarMonth?: string | null;
};

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function monthStart(date: string, offset = 0): string {
  const month = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() + offset);
  return month.toISOString().slice(0, 10);
}

export function calculateJar(input: CheckupInput): JarStatus {
  const { rows, customerId, referenceDate, corrections, limit } = input;
  dateSchema.parse(referenceDate);
  monthlyLimitSchema.parse(limit);
  dateSchema.parse(`${limit.activeSince}-01`);
  const currentMonth = referenceDate.slice(0, 7);
  if (input.jarMonth) {
    dateSchema.parse(`${input.jarMonth}-01`);
    if (input.jarMonth < limit.activeSince || input.jarMonth > currentMonth) {
      throw new RangeError("Month out of range");
    }
  }
  const targetMonth = input.jarMonth && input.jarMonth < currentMonth ? input.jarMonth : currentMonth;
  dateSchema.parse(`${targetMonth}-01`);
  const isPast = targetMonth < currentMonth;
  const start = `${targetMonth}-01`;
  const end = isPast ? shiftDate(monthStart(start, 1), -1) : referenceDate;
  const period = { start, end };
  // calculateSpending owns gross-spending eligibility and corrected/default baskets.
  const spending = calculateSpending(rows, customerId,
    { ...period, categories: [], baskets: [], merchantType: null }, corrections, referenceDate);
  const evidence = spending.evidence.sort((a, b) => b.date.localeCompare(a.date) || b.sourceRow - a.sourceRow);
  const spentCents = spending.baskets.everyday;
  const elapsedDays = isPast ? Number(end.slice(8)) : Number(referenceDate.slice(8));
  const daysInMonth = Number(shiftDate(monthStart(start, 1), -1).slice(8));
  const daysLeft = isPast ? 0 : daysInMonth - elapsedDays;
  const leftCents = Math.max(0, limit.amountCents - spentCents);
  // Linear extrapolation of historical spending, not live affordability.
  const projectedCents = isPast ? spentCents : Math.floor(spentCents * daysInMonth / elapsedDays);
  const months: JarStatus["months"] = [];
  const currentMonthStart = `${currentMonth}-01`;
  for (let month = `${limit.activeSince}-01`; month < currentMonthStart; month = monthStart(month, 1)) {
    const closed = calculateSpending(rows, customerId, { start: month,
      end: shiftDate(monthStart(month, 1), -1), categories: [], baskets: ["everyday"], merchantType: null },
    corrections, referenceDate);
    months.push({ month: month.slice(0, 7), spentCents: closed.totalCents, inside: closed.totalCents <= limit.amountCents });
  }
  return { period, limitCents: limit.amountCents, spentCents, leftCents,
    overCents: Math.max(0, spentCents - limit.amountCents), elapsedDays, daysLeft,
    dailySpentCents: Math.floor(spentCents / elapsedDays), dailyRemainingCents: daysLeft ? Math.floor(leftCents / daysLeft) : 0,
    projectedCents, projectedOverCents: Math.max(0, projectedCents - limit.amountCents),
    unexpectedCents: spending.baskets.unexpected, months, evidence };
}

export function calculateUsualComparison(input: CheckupInput): UsualComparison {
  const { rows, customerId, referenceDate, corrections, limit } = input;
  dateSchema.parse(referenceDate);
  const currentMonth = referenceDate.slice(0, 7);
  if (input.jarMonth) {
    dateSchema.parse(`${input.jarMonth}-01`);
    if (limit && (input.jarMonth < limit.activeSince || input.jarMonth > currentMonth)) {
      throw new RangeError("Month out of range");
    }
  }
  const targetMonth = input.jarMonth && input.jarMonth < currentMonth ? input.jarMonth : currentMonth;
  dateSchema.parse(`${targetMonth}-01`);
  const isPast = targetMonth < currentMonth;
  const start = `${targetMonth}-01`;
  const end = isPast ? shiftDate(monthStart(start, 1), -1) : referenceDate;
  const period = { start, end };
  const baseline = { start: monthStart(start, -6), end: shiftDate(start, -1) };
  const current = calculateSpending(rows, customerId,
    { ...period, categories: [], baskets: ["everyday"], merchantType: null }, corrections, referenceDate);
  const previous = calculateSpending(rows, customerId,
    { ...baseline, categories: [], baskets: ["everyday"], merchantType: null }, corrections, referenceDate);
  const evidence = current.evidence.sort((a, b) => b.date.localeCompare(a.date) || b.sourceRow - a.sourceRow);
  const categories = [...new Set(evidence.map(row => row.category))].sort();
  const base = categories.map(category => {
    const payments = evidence.filter(row => row.category === category);
    return { category, currentCents: payments.reduce((sum, row) => sum + row.amountCents, 0),
      // Six complete calendar months, including months without payments; floor cents.
      usualCents: Math.floor(previous.evidence.filter(row => row.category === category)
        .reduce((sum, row) => sum + row.amountCents, 0) / 6),
      paymentDates: payments.map(row => row.date).sort(), count: payments.length };
  });
  const { flags, insight, elapsedDays, daysInMonth } = usualInsight({ period, baseline, rows: base }, referenceDate);
  return { period, baseline, monthCount: 6, elapsedDays, daysInMonth, evidence, insight,
    rows: base.map(row => ({ ...row, ...flags[row.category] })) };
}

const OVER_CENTS = 500;
const AHEAD_BP = 2000;
const UNDER_BP = 2500;
const longMonth = (date: string, year = false) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));

type InsightRow = { category: string; currentCents: number; usualCents: number };
type RowFlag = { flag: "over" | "ahead" | "under" | null; sharePercent: number | null };

// Deterministic, integer-only comparison of each category with its usual month and the month's elapsed share.
export function usualInsight(comparison: { period: { start: string }; baseline: { start: string; end: string }; rows: readonly InsightRow[] },
  referenceDate: string) {
  const { start } = comparison.period;
  const [year, monthNumber] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const isPast = start.slice(0, 7) < referenceDate.slice(0, 7);
  const elapsedDays = isPast ? daysInMonth : Number(referenceDate.slice(8, 10));
  const elapsedBp = Math.floor(elapsedDays * 10000 / daysInMonth);
  const flags: Record<string, RowFlag> = {};
  const over: { category: string; excess: number; pct: number | null }[] = [];
  const ahead: { category: string; bp: number }[] = [];
  const under: { category: string; bp: number }[] = [];
  for (const { category, currentCents, usualCents } of comparison.rows) {
    const bp = usualCents > 0 ? Math.floor(currentCents * 10000 / usualCents) : null;
    const excess = usualCents > 0 ? currentCents - usualCents : currentCents;
    let flag: RowFlag["flag"] = null;
    if (excess >= OVER_CENTS) { flag = "over"; over.push({ category, excess, pct: bp === null ? null : Math.floor(bp / 100) }); }
    else if (bp !== null && !isPast && bp - elapsedBp >= AHEAD_BP) { flag = "ahead"; ahead.push({ category, bp }); }
    else if (bp !== null && elapsedBp - bp >= UNDER_BP) { flag = "under"; under.push({ category, bp }); }
    flags[category] = { flag, sharePercent: bp === null ? null : Math.floor(bp / 100) };
  }
  over.sort((a, b) => b.excess - a.excess || a.category.localeCompare(b.category));
  ahead.sort((a, b) => b.bp - a.bp || a.category.localeCompare(b.category));
  under.sort((a, b) => a.bp - b.bp || a.category.localeCompare(b.category));
  const pctOf = (bp: number) => Math.floor(bp / 100);
  const daysLeft = daysInMonth - elapsedDays;
  const kind = over.length ? "over" : ahead.length ? "ahead" : "none";
  const headline = kind === "over"
    ? isPast
      ? `Your ${over[0].category} spending finished ${euros(over[0].excess)} over a usual month in ${longMonth(start, true)}.`
      : `Your ${over[0].category} spending is already ${euros(over[0].excess)} over a usual month, with ${daysLeft} ${daysLeft === 1 ? "day" : "days"} to go.`
    : kind === "ahead"
      ? `Your ${ahead[0].category} spending is already at ${pctOf(ahead[0].bp)}% of a usual month, and ${elapsedDays} of ${daysInMonth} days have passed.`
      : isPast ? "No category finished well over its usual month." : "Every category is at or below its usual pace so far.";
  const moreOver = over.slice(kind === "over" ? 1 : 0).map(row => row.category);
  const supporting = [
    ...(moreOver.length ? [`${list(moreOver)} ${moreOver.length === 1 ? "is" : "are"} over too.`] : []),
    ...ahead.slice(kind === "ahead" ? 1 : 0).map(row => `${row.category} is at ${pctOf(row.bp)}% with ${pctOf(elapsedBp)}% of the month gone.`),
    ...under.map(row => `${row.category} is well below, at ${pctOf(row.bp)}%.`),
  ].slice(0, 2);
  const message = [headline, ...supporting,
    ...(!isPast && kind !== "none" ? ["Holding back on these for the rest of the month helps."] : [])].join(" ");
  return { flags, elapsedDays, daysInMonth, insight: { kind, headline, supporting, message } as const };
}

export const overspendQuestion = "Why did my jar go over?";

export function overspendLead(jar: JarStatus, referenceDate: string) {
  return jar.period.start.slice(0, 7) < referenceDate.slice(0, 7)
    ? `Your ${longMonth(jar.period.start, true)} jar went ${euros(jar.overCents)} over the rim.`
    : `Your jar is ${euros(jar.overCents)} over the rim so far.`;
}

const list = (names: readonly string[]) => names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// Deterministic reason a jar went over its limit; null when the jar is inside it. Gemini writes no facts.
export function overspendInsight(input: CheckupInput): OverspendInsight | null {
  const jar = calculateJar(input);
  if (!jar.overCents) return null;
  const { rows, customerId, referenceDate, corrections } = input;
  const usual = calculateUsualComparison(input);
  const baseline = calculateSpending(rows, customerId, { ...usual.baseline, categories: [], baskets: ["everyday"], merchantType: null },
    corrections, referenceDate).evidence;
  const monthRows = jar.evidence.filter(row => row.basket === "everyday");
  const payments = monthRows.filter(row => {
    const old = baseline.filter(other => other.category === row.category);
    // shortcut: fewer than 3 baseline payments is too little history to call a payment unusual, revisit with more data.
    return old.length >= 3 && row.amountCents > Math.max(...old.map(other => other.amountCents));
  }).sort((a, b) => b.amountCents - a.amountCents || a.id.localeCompare(b.id));
  const largeSum = payments.reduce((sum, row) => sum + row.amountCents, 0);
  const categories = usual.rows.filter(row => row.flag === "over")
    .sort((a, b) => (b.currentCents - b.usualCents) - (a.currentCents - a.usualCents) || a.category.localeCompare(b.category))
    .slice(0, 2).map(({ category, currentCents, usualCents }) => ({ category, currentCents, usualCents }));
  const kind = payments.length && largeSum >= jar.overCents ? "large_payments" : categories.length ? "category" : "spread";
  let running = 0;
  const crossing = [...monthRows].sort((a, b) => a.date.localeCompare(b.date) || a.sourceRow - b.sourceRow)
    .find(row => (running += row.amountCents) > jar.limitCents)!;
  const daysInMonth = Number(shiftDate(monthStart(jar.period.start, 1), -1).slice(8));
  const daysLeftAfter = daysInMonth - Number(crossing.date.slice(8));
  const isPast = jar.period.start.slice(0, 7) < referenceDate.slice(0, 7);
  const shown = payments.slice(0, 3).map(({ date, category, amountCents }) => ({ date, category, amountCents }));
  const names = categories.map(row => row.category);
  const headline = kind === "large_payments"
    ? payments.length === 1 ? "An unusually large payment is more than the overage." : `${payments.length} unusually large payments add up to more than the overage.`
    : kind === "category" ? `${list(names)} ran furthest above a usual month.`
    : "No single category or payment stood out. Many everyday payments added up.";
  const detail = payments.length === 1
    ? `Your ${payments[0].category} payment on ${formatDay(payments[0].date)} was bigger than any ${payments[0].category} payment in the previous six months.`
    : payments.length === 2
      ? `Your ${payments[0].category} payment on ${formatDay(payments[0].date)} and ${payments[1].category} payment on ${formatDay(payments[1].date)} were bigger than any in their category in the previous six months.`
      : payments.length
        ? `${payments.length} payments were bigger than any in their category in the previous six months, the largest on ${formatDay(payments[0].date)}.` : null;
  const wentOver = `The jar went over on ${formatDay(crossing.date)}, with ${daysLeftAfter} ${daysLeftAfter === 1 ? "day" : "days"} of the month left.`;
  const lines = [detail, kind !== "category" && names.length ? `${list(names)} also ran above a usual month.` : null, wentOver]
    .filter((line): line is string => line !== null);
  const advice = kind === "large_payments" ? "Leaving room for bigger payments helps keep the jar inside."
    : isPast ? `Keeping an eye on ${names[0] ?? "everyday payments"} next month helps keep the jar inside.`
    : `Holding back on ${names[0] ?? "everyday payments"} for the rest of the month helps.`;
  return { kind, headline, supporting: lines.slice(0, 2), wentOverOn: crossing.date, daysLeftAfter, payments: shown, categories,
    message: [headline, ...lines, advice].join(" ") };
}

export function isoWeekStart(date: string): string {
  dateSchema.parse(date);
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftDate(date, -((day + 6) % 7));
}

export function weeklyCheckup(completedDates: readonly string[], referenceDate: string): WeeklyCheckup {
  const weekStart = isoWeekStart(referenceDate);
  const weeks = new Map<string, string>();
  // Retain the earliest actual completion, not a synthesized Monday date.
  for (const date of [...completedDates].sort()) {
    const week = isoWeekStart(date);
    if (date <= referenceDate && !weeks.has(week)) weeks.set(week, date);
  }
  const completed = weeks.has(weekStart);
  let streak = 0;
  for (let week = completed ? weekStart : shiftDate(weekStart, -7); weeks.has(week); week = shiftDate(week, -7)) streak++;
  return { weekStart, completed, due: !completed, streak, completedDates: [...weeks.values()] };
}

export function completeWeeklyCheckup(completedDates: readonly string[], date: string): WeeklyCheckup {
  return weeklyCheckup([...completedDates, date], date);
}
