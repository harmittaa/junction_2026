import { querySchema, scenarioSchema, type Basket, type Spending, type SpendingQuery, type Transaction } from "@/shared/contracts";

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

export function calculateSpending(
  rows: readonly Transaction[], customerId: string, query: SpendingQuery,
  corrections: Record<string, Basket>, referenceDate: string,
): Spending {
  querySchema.parse(query);
  if (query.start > query.end || query.end > referenceDate) throw new Error("Choose a completed historical period, up to the simulated date.");
  const evidence = rows.filter(row => row.customerId === customerId && isSpending(row)
    && row.category === query.category && row.date >= query.start && row.date <= query.end)
    .map(row => ({ id: row.id, sourceRow: row.sourceRow, date: row.date, category: row.category,
      merchant: row.merchantId ?? row.transactionType.replaceAll("_", " "),
      amountCents: -row.amountCents, basket: corrections[row.id] ?? defaultBasket(row) }));
  const baskets = { regular: 0, unexpected: 0, everyday: 0 };
  for (const row of evidence) baskets[row.basket] += row.amountCents;
  return { query, totalCents: baskets.regular + baskets.unexpected + baskets.everyday, evidence, baskets };
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
