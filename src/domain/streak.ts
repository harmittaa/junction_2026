import { dateSchema } from "@/shared/contracts";
import { isoWeekStart } from "@/domain/checkup";

export function shiftDate(date: string, days: number): string {
  dateSchema.parse(date);
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function longestRun(completedDates: readonly string[]): number {
  if (completedDates.length === 0) return 0;
  const uniqueWeeks = [...new Set(completedDates.map(isoWeekStart))].sort();
  let maxRun = 0;
  let currentRun = 0;
  let expectedNext: string | null = null;
  for (const week of uniqueWeeks) {
    if (expectedNext !== null && week === expectedNext) {
      currentRun++;
    } else {
      currentRun = 1;
    }
    if (currentRun > maxRun) maxRun = currentRun;
    expectedNext = shiftDate(week, 7);
  }
  return maxRun;
}

const shortMonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const longMonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const weekDayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function formatDueBy(weekStart: string): string {
  dateSchema.parse(weekStart);
  const sunday = shiftDate(weekStart, 6);
  const d = new Date(`${sunday}T12:00:00Z`);
  return `Due by ${weekDayNames[d.getUTCDay()]} ${d.getUTCDate()} ${longMonthNames[d.getUTCMonth()]}`;
}

export function formatShortDate(date: string): string {
  dateSchema.parse(date);
  const d = new Date(`${date}T12:00:00Z`);
  return `${d.getUTCDate()} ${shortMonthNames[d.getUTCMonth()]}`;
}

export function formatLongDate(date: string): string {
  dateSchema.parse(date);
  const d = new Date(`${date}T12:00:00Z`);
  return `${d.getUTCDate()} ${longMonthNames[d.getUTCMonth()]}`;
}
