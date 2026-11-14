import { basketLabels, dateSchema, querySchema, scenarioSchema, type Basket, type Spending, type SpendingQuery, type Transaction } from "@/shared/contracts";
import { merchantTypes } from "@/domain/merchant-types";

// Gross recorded spending: negative purchases and explicit bills, not transfers,
// savings, withdrawals, income or refunds. Refunds are not matched to purchases.
export function isSpending(row: Transaction): boolean {
  return row.amountCents < 0 && ["purchase", "housing_payment", "utilities_payment"].includes(row.transactionType);
}

export function defaultBasket(row: Transaction): Basket {
  if (["Housing", "Utilities"].includes(row.category)) return "regular";
  if (row.category === "Health") return "unexpected";
  return "everyday";
}

export function queryLabel(query: SpendingQuery): string {
  return [query.categories.length ? query.categories.join(", ") : "All spending",
    ...query.baskets.map(basket => basketLabels[basket]),
    ...(query.merchantType ? [merchantTypes[query.merchantType].label] : [])].join(" · ");
}

export function calculateSpending(
  rows: readonly Transaction[], customerId: string, query: SpendingQuery,
  corrections: Record<string, Basket>, referenceDate: string,
): Spending {
  querySchema.parse(query);
  dateSchema.parse(referenceDate);
  if (query.start > query.end || query.end > referenceDate) throw new Error("Choose a period up to the current date.");
  const candidates = rows.filter(row => row.customerId === customerId && isSpending(row)
    && (!query.categories.length || query.categories.includes(row.category))
    && (!query.baskets.length || query.baskets.includes(corrections[row.id] ?? defaultBasket(row)))
    && row.date >= query.start && row.date <= query.end);
  const missingMccCount = candidates.filter(row => row.transactionType === "purchase" && row.mcc === null).length;
  const evidence = candidates.filter(row => !query.merchantType || (row.transactionType === "purchase"
    && row.mcc !== null && merchantTypes[query.merchantType].codes.includes(row.mcc)))
    .map(row => ({ id: row.id, sourceRow: row.sourceRow, date: row.date, category: row.category,
      merchant: row.merchantId ?? row.transactionType.replaceAll("_", " "),
      amountCents: -row.amountCents, basket: corrections[row.id] ?? defaultBasket(row) }));
  const baskets = { regular: 0, unexpected: 0, everyday: 0 };
  for (const row of evidence) baskets[row.basket] += row.amountCents;
  const assumptions = ["Gross recorded spending counts negative purchases, housing and utilities payments; excludes income, transfers and refunds.",
    `Payments from ${query.start} through ${query.end}, inclusive; current date ${referenceDate}.`,
    "Basket assignments are correctable interpretations, not changes to payment amounts."];
  if (!evidence.length) assumptions.push("No matching spending records in this period; this is not evidence of unavailable data or future activity.");
  if (query.merchantType) {
    assumptions.push("Merchant types are classified by MCC, not purchased items or motives; fuel-merchant purchases do not prove fuel was bought.");
    if (missingMccCount) assumptions.push(`${missingMccCount} candidate purchase rows have no MCC; the merchant subtotal may be incomplete. Missing MCCs are not assigned a merchant type.`);
  }
  return { query, totalCents: baskets.regular + baskets.unexpected + baskets.everyday, evidence,
    evidenceCount: evidence.length, missingMccCount, assumptions, baskets };
}

export function percentageScenario(baseCents: number, percent: number) {
  // Round once, half up to the nearest cent. No floating-point euro arithmetic.
  const reductionCents = Math.floor((baseCents * percent + 50) / 100);
  return scenarioSchema.parse({ percent, baseCents, reductionCents, remainingCents: baseCents - reductionCents });
}

export function nextDate(date: string): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function euros(cents: number): string {
  return new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" }).format(cents / 100);
}
