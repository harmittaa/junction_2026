import { dateSchema, type Noticed, type Transaction } from "@/shared/contracts";
import { euros, isSpending } from "@/domain/spending";

export const merchantReflectionQuestion = "Still worth it to you?";

export function merchantSpike({ rows, customerId, month, referenceDate }: {
  rows: readonly Transaction[]; customerId: string; month: string; referenceDate: string;
}): { merchantId: string; month: string; noticed: Noticed } | null {
  const start = `${month}-01`;
  dateSchema.parse(start);
  dateSchema.parse(referenceDate);
  if (start > referenceDate) return null;
  const baseline = new Date(`${start}T12:00:00Z`);
  baseline.setUTCMonth(baseline.getUTCMonth() - 11);
  const baselineStart = baseline.toISOString().slice(0, 10);
  const merchants = new Map<string, { count: number; total: number; prior: number }>();
  for (const row of rows) {
    if (row.customerId !== customerId || !row.merchantId || !isSpending(row)
      || row.date < baselineStart || row.date > referenceDate || row.date.slice(0, 7) > month) continue;
    const value = merchants.get(row.merchantId) ?? { count: 0, total: 0, prior: 0 };
    if (row.date >= start) {
      value.count++;
      value.total -= row.amountCents;
    } else value.prior -= row.amountCents;
    merchants.set(row.merchantId, value);
  }
  const winner = [...merchants.entries()]
    // Compare the exact 11-month average without rounding money first.
    .filter(([, value]) => value.count >= 3 && value.total >= 20000 && value.total * 11 >= value.prior * 2)
    .sort(([a, left], [b, right]) => right.total - left.total || a.localeCompare(b))[0];
  if (!winner) return null;
  const [merchantId, value] = winner;
  const monthName = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" })
    .format(new Date(`${start}T12:00:00Z`));
  return { merchantId, month, noticed: {
    rule: "merchant_spike",
    text: `${value.count} payments here in ${monthName}, ${euros(value.total)}. In the 11 months before: ${euros(value.prior)}.`,
    question: merchantReflectionQuestion,
  } };
}
