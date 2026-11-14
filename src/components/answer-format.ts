import { euros } from "@/domain/spending";

export function goalAmount(cents: number): string {
  const formatted = euros(cents);
  return cents % 100 === 0 ? formatted.replace(",00", "") : formatted;
}

export function lastDayOfMonth(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const d = new Date(Date.UTC(year, month, 0));
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function monthRange(start: string, end: string): string {
  const d1 = new Date(`${start}T12:00:00Z`);
  const d2 = new Date(`${end}T12:00:00Z`);
  const m1 = d1.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const y1 = d1.getUTCFullYear();
  const m2 = d2.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const y2 = d2.getUTCFullYear();
  if (y1 === y2) {
    if (m1 === m2) return `${m1} ${y1}`;
    return `${m1}–${m2} ${y1}`;
  }
  return `${m1} ${y1}–${m2} ${y2}`;
}

export function dayHeading(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).formatToParts(d);
  const weekday = parts.find(p => p.type === "weekday")?.value ?? "";
  const day = parts.find(p => p.type === "day")?.value ?? "";
  const month = parts.find(p => p.type === "month")?.value ?? "";
  return `${weekday} ${day} ${month}`;
}

export function minusEuros(cents: number): string {
  return `\u2212 ${euros(cents)}`;
}

export const formatMinus = minusEuros;
