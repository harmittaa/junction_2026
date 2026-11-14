import { dateSchema, monthlyLimitSchema, type Basket, type JarStatus, type MonthlyLimit,
  type Transaction, type UsualComparison, type WeeklyCheckup } from "@/shared/contracts";
import { calculateSpending } from "@/domain/spending";

type CheckupInput = {
  rows: readonly Transaction[];
  customerId: string;
  referenceDate: string;
  corrections: Record<string, Basket>;
  limit: MonthlyLimit;
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
  const start = monthStart(referenceDate);
  const period = { start, end: referenceDate };
  // calculateSpending owns gross-spending eligibility and corrected/default baskets.
  const spending = calculateSpending(rows, customerId,
    { ...period, categories: [], baskets: [], merchantType: null }, corrections, referenceDate);
  const evidence = spending.evidence.sort((a, b) => b.date.localeCompare(a.date) || b.sourceRow - a.sourceRow);
  const spentCents = spending.baskets.everyday;
  const elapsedDays = Number(referenceDate.slice(8));
  const daysInMonth = Number(shiftDate(monthStart(referenceDate, 1), -1).slice(8));
  const daysLeft = daysInMonth - elapsedDays;
  const leftCents = Math.max(0, limit.amountCents - spentCents);
  // Linear extrapolation of historical spending, not live affordability.
  const projectedCents = Math.floor(spentCents * daysInMonth / elapsedDays);
  const months: JarStatus["months"] = [];
  for (let month = `${limit.activeSince}-01`; month < start; month = monthStart(month, 1)) {
    const closed = calculateSpending(rows, customerId, { start: month,
      end: shiftDate(monthStart(month, 1), -1), categories: [], baskets: ["everyday"], merchantType: null },
    corrections, referenceDate);
    months.push({ month: month.slice(0, 7), spentCents: closed.totalCents, inside: closed.totalCents <= limit.amountCents });
  }
  const recentStart = shiftDate(referenceDate, -6);
  const contributionPeriod = { start: recentStart < start ? start : recentStart, end: referenceDate };
  const days = new Map<string, JarStatus["topDays"][number]>();
  for (const row of evidence) {
    if (row.basket !== "everyday" || row.date < contributionPeriod.start) continue;
    const day = days.get(row.date) ?? { date: row.date, amountCents: 0, count: 0 };
    day.amountCents += row.amountCents;
    day.count++;
    days.set(row.date, day);
  }
  const topDays = [...days.values()].sort((a, b) => b.amountCents - a.amountCents || b.date.localeCompare(a.date)).slice(0, 2);
  return { period, limitCents: limit.amountCents, spentCents, leftCents,
    overCents: Math.max(0, spentCents - limit.amountCents), elapsedDays, daysLeft,
    dailySpentCents: Math.floor(spentCents / elapsedDays), dailyRemainingCents: daysLeft ? Math.floor(leftCents / daysLeft) : 0,
    projectedCents, projectedOverCents: Math.max(0, projectedCents - limit.amountCents),
    unexpectedCents: spending.baskets.unexpected, months, contributionPeriod, topDays, evidence };
}

export function calculateUsualComparison(input: CheckupInput): UsualComparison {
  const { rows, customerId, referenceDate, corrections } = input;
  dateSchema.parse(referenceDate);
  const period = { start: monthStart(referenceDate), end: referenceDate };
  const baseline = { start: monthStart(referenceDate, -6), end: shiftDate(period.start, -1) };
  const current = calculateSpending(rows, customerId,
    { ...period, categories: [], baskets: ["everyday"], merchantType: null }, corrections, referenceDate);
  const previous = calculateSpending(rows, customerId,
    { ...baseline, categories: [], baskets: ["everyday"], merchantType: null }, corrections, referenceDate);
  const evidence = current.evidence.sort((a, b) => b.date.localeCompare(a.date) || b.sourceRow - a.sourceRow);
  const categories = [...new Set(evidence.map(row => row.category))].sort();
  return { period, baseline, monthCount: 6, evidence,
    rows: categories.map(category => {
      const payments = evidence.filter(row => row.category === category);
      return { category, currentCents: payments.reduce((sum, row) => sum + row.amountCents, 0),
        // Six complete calendar months, including months without payments; floor cents.
        usualCents: Math.floor(previous.evidence.filter(row => row.category === category)
          .reduce((sum, row) => sum + row.amountCents, 0) / 6),
        paymentDates: payments.map(row => row.date).sort(), count: payments.length };
    }) };
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
