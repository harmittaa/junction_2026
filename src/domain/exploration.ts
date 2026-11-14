import { analysisOperationSchema, analysisSchema, basketLabels, dateSchema, type Analysis,
  type AnalysisOperation, type Basket, type Spending, type SpendingQuery, type Transaction } from "@/shared/contracts";
import { merchantTypes } from "@/domain/merchant-types";
import { calculateSpending, defaultBasket, percentageScenario, queryLabel } from "@/domain/spending";

type AnalysisRow = Analysis["sections"][number]["rows"][number];
type Section = Analysis["sections"][number];

function monthStart(date: string, offset = 0): string {
  const month = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() + offset);
  return month.toISOString().slice(0, 10);
}

function monthEnd(date: string): string {
  const end = new Date(`${monthStart(date, 1)}T12:00:00Z`);
  end.setUTCDate(0);
  return end.toISOString().slice(0, 10);
}

function monthsIn(query: SpendingQuery): string[] {
  const months: string[] = [];
  for (let month = monthStart(query.start); month <= query.end; month = monthStart(month, 1)) {
    if (months.length === 24) throw new Error("Choose at most 24 calendar months.");
    months.push(month);
  }
  return months;
}

export function recentCompleteQuery(referenceDate: string, datasetStart: string, count = 3): SpendingQuery {
  dateSchema.parse(referenceDate);
  dateSchema.parse(datasetStart);
  if (!Number.isInteger(count) || count < 1 || count > 24) throw new Error("Choose between 1 and 24 complete months.");
  const firstComplete = datasetStart === monthStart(datasetStart) ? datasetStart : monthStart(datasetStart, 1);
  const requested = monthStart(referenceDate, -count);
  const start = firstComplete > requested ? firstComplete : requested;
  const end = monthEnd(monthStart(referenceDate, -1));
  if (start > end) throw new Error("No complete month is available before the current month.");
  return { start, end, categories: [], baskets: [], merchantType: null };
}

function resultRow(label: string, amountCents: number, count: number | null = null, total?: number): AnalysisRow {
  return { label, amountCents, count,
    // Explicit half-up rounding to one decimal place. Zero total has no shares.
    sharePercent: total ? Math.floor((amountCents * 1000 + total / 2) / total) / 10 : null };
}

function ranked(groups: Map<string, { total: number; count: number }>, total: number, top: number | null): AnalysisRow[] {
  const sorted = [...groups].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
  const shown = top === null ? sorted : sorted.slice(0, top);
  const rows = shown.map(([label, group]) => resultRow(label, group.total, group.count, total));
  const rest = sorted.slice(shown.length);
  if (rest.length) rows.push(resultRow("Other", rest.reduce((sum, [, group]) => sum + group.total, 0),
    rest.reduce((sum, [, group]) => sum + group.count, 0), total));
  return rows;
}

function grouped(spending: Spending, label: (row: Spending["evidence"][number]) => string) {
  const groups = new Map<string, { total: number; count: number }>();
  for (const row of spending.evidence) {
    const key = label(row);
    const group = groups.get(key) ?? { total: 0, count: 0 };
    group.total += row.amountCents;
    group.count++;
    groups.set(key, group);
  }
  return groups;
}

function monthlyRows(spending: Spending): AnalysisRow[] {
  const groups = grouped(spending, row => row.date.slice(0, 7));
  return monthsIn(spending.query).map(month => {
    const group = groups.get(month.slice(0, 7));
    const partial = spending.query.start > month || spending.query.end < monthEnd(month);
    return resultRow(`${month.slice(0, 7)}${partial ? " (partial month)" : ""}`, group?.total ?? 0, group?.count ?? 0);
  });
}

export function calculateAnalysis(
  rows: readonly Transaction[], customerId: string, operation: AnalysisOperation,
  corrections: Record<string, Basket>, referenceDate: string, datasetStart?: string,
): Analysis {
  analysisOperationSchema.parse(operation);
  const { kind, query, top } = operation;
  const spending = calculateSpending(rows, customerId, query, corrections, referenceDate);
  monthsIn(query);
  const assumptions = [...spending.assumptions];
  const sections: Section[] = [];
  const evidence = new Map(spending.evidence.map(row => [row.id, row]));
  const include = (value: Spending) => {
    for (const row of value.evidence) evidence.set(row.id, row);
    assumptions.push(...value.assumptions);
  };
  const totalRow = resultRow("Total spending", spending.totalCents, spending.evidenceCount);

  switch (kind) {
    case "breakdown": {
      if (!operation.by) throw new Error("Choose a breakdown dimension.");
      let breakdown: AnalysisRow[];
      if (operation.by === "merchantType") {
        const source = new Map(rows.filter(row => row.customerId === customerId).map(row => [row.id, row]));
        const groups = grouped(spending, evidence => {
          const row = source.get(evidence.id)!;
          if (row.transactionType !== "purchase") return "Not merchant-classified (bills)";
          if (row.mcc === null) return "Missing MCC (unclassified purchases)";
          return Object.values(merchantTypes).find(type => type.codes.includes(row.mcc!))?.label
            ?? "Unmapped MCC (other merchant types)";
        });
        const unclassified = new Map([...groups].filter(([label]) => !Object.values(merchantTypes).some(type => type.label === label)));
        for (const label of unclassified.keys()) groups.delete(label);
        breakdown = [...ranked(groups, spending.totalCents, top), ...ranked(unclassified, spending.totalCents, null)];
        assumptions.push("Merchant types describe the merchant, not items or motives; fuel-merchant purchases do not prove fuel was bought. Missing MCCs and unmapped MCCs remain unclassified.");
        if (spending.missingMccCount) assumptions.push(`${spending.missingMccCount} candidate purchases lack MCCs; named merchant subtotals may be incomplete.`);
        assumptions.push("Top N applies to named merchant types; unclassified rows are always shown separately.");
      } else if (operation.by === "month") {
        const months = monthlyRows(spending);
        // Month labels retain partial-period qualifiers even when ranked.
        breakdown = ranked(new Map(months.map(row => [row.label, { total: row.amountCents, count: row.count! }])), spending.totalCents, top);
      } else {
        breakdown = ranked(grouped(spending, row => operation.by === "basket" ? basketLabels[row.basket] : row.category), spending.totalCents, top);
      }
      sections.push({ label: `Spending by ${operation.by}`, rows: breakdown }, { label: "Period total", rows: [totalRow] });
      assumptions.push("Shares are rounded half up to one decimal; rounded shares need not sum to 100%. Other is the remainder excluded by top N.");
      break;
    }
    case "comparison": {
      if (!operation.comparePeriod) throw new Error("Choose a comparison period.");
      const previous = calculateSpending(rows, customerId, { ...query, ...operation.comparePeriod }, corrections, referenceDate);
      monthsIn(previous.query);
      include(previous);
      const difference = spending.totalCents - previous.totalCents;
      sections.push({ label: "Period comparison", rows: [
        resultRow(`${query.start} to ${query.end}`, spending.totalCents, spending.evidenceCount),
        resultRow(`${previous.query.start} to ${previous.query.end}`, previous.totalCents, previous.evidenceCount),
        resultRow("Difference (selected period minus comparison period)", difference),
      ] });
      assumptions.push("Periods use the same category, basket and merchant filters; totals are not normalized for period length. Overlapping source rows are retained once in evidence.");
      if (previous.totalCents === 0) assumptions.push("Percentage change is undefined when the comparison total is zero; only the signed cent difference is shown.");
      break;
    }
    case "trend": {
      const monthly = monthlyRows(spending);
      const complete = monthsIn(query).flatMap((month, index) =>
        query.start <= month && monthEnd(month) <= query.end ? [monthly[index]] : []);
      sections.push({ label: "Monthly spending", rows: monthly }, { label: "Period total", rows: [totalRow] });
      if (complete.length) sections.push({ label: "Complete-month basis", rows: [resultRow("Monthly average (complete months)",
        Math.floor((complete.reduce((sum, row) => sum + row.amountCents, 0) + complete.length / 2) / complete.length), complete.length)] });
      assumptions.push("Zero-spending calendar months are included. Partial months are labeled and excluded from the monthly average; the average is rounded half up to cents.");
      if (!complete.length) assumptions.push("No complete months in the selected period; a monthly average is unavailable.");
      break;
    }
    case "cashflow": {
      if (query.categories.length || query.baskets.length || query.merchantType) throw new Error("Cashflow requires an unfiltered period.");
      const flows = rows.filter(row => row.customerId === customerId && row.date >= query.start && row.date <= query.end);
      const income = flows.filter(row => row.amountCents > 0 && ["salary", "other_income"].includes(row.transactionType));
      const investments = flows.filter(row => row.amountCents < 0 && row.transactionType === "investment_deposit");
      for (const row of [...income, ...investments]) evidence.set(row.id, { id: row.id, sourceRow: row.sourceRow,
        date: row.date, category: row.category, merchant: row.merchantId ?? row.transactionType.replaceAll("_", " "),
        amountCents: Math.abs(row.amountCents), basket: corrections[row.id] ?? defaultBasket(row) });
      sections.push({ label: "Recorded cashflow", rows: [
        resultRow("Income (salary and other income)", income.reduce((sum, row) => sum + row.amountCents, 0), income.length),
        totalRow,
        resultRow("Transfers to investments", investments.reduce((sum, row) => sum - row.amountCents, 0), investments.length),
      ] });
      assumptions.push("Income counts only positive salary and other_income rows. Transfers to investments count only negative investment_deposit rows; neither they nor any residual are verified savings. Investment withdrawals and salary sweeps are excluded. Evidence shows absolute amounts; row labels identify flow direction, not basket assignments.");
      break;
    }
    case "whatif": {
      if (operation.percent === null) throw new Error("Choose a reduction percentage.");
      if (datasetStart === undefined) throw new Error("What-if projections require the explicit dataset start date.");
      dateSchema.parse(datasetStart);
      const scenario = percentageScenario(spending.totalCents, operation.percent);
      sections.push({ label: `Selected period: ${query.start} to ${query.end}`, rows: [totalRow,
        resultRow(`Hypothetical reduction (${operation.percent}%)`, scenario.reductionCents),
        resultRow("Hypothetical remaining spending", scenario.remainingCents),
      ] });
      const firstComplete = datasetStart === monthStart(datasetStart) ? datasetStart : monthStart(datasetStart, 1);
      if (firstComplete < monthStart(referenceDate)) {
        const recent = { ...recentCompleteQuery(referenceDate, datasetStart, 6), categories: query.categories,
          baskets: query.baskets, merchantType: query.merchantType };
        const baseline = calculateSpending(rows, customerId, recent, corrections, referenceDate);
        include(baseline);
        const months = monthsIn(recent);
        const average = Math.floor(baseline.totalCents / months.length);
        const monthlyReduction = percentageScenario(average, operation.percent).reductionCents;
        const projection = monthlyReduction * 12;
        sections.push({ label: `Projection basis: ${recent.start} to ${recent.end}`, rows: [
          resultRow("Baseline recorded spending", baseline.totalCents, baseline.evidenceCount),
          resultRow("Monthly average (complete months)", average, months.length),
          resultRow(`Hypothetical monthly reduction (${operation.percent}%)`, monthlyReduction),
          resultRow(`Hypothetical annual reduction (${operation.percent}%)`, projection),
        ] });
        assumptions.push(`Annual projection uses ${months.length} available complete months before the current month: ${months.map(month => month.slice(0, 7)).join(", ")}, including zero months. Records begin ${datasetStart}. The same filters and corrections apply; fewer than six complete months are used only when data availability requires it.`);
      } else assumptions.push("No complete months available for a baseline; annual projection is unavailable, not zero.");
      assumptions.push("Hypothetical only, not recorded or verified savings. Round the selected-period reduction once, half up to cents. Floor the usual monthly average to cents, round its percentage reduction half up to cents, then multiply that monthly reduction by 12; this is not a forecast.");
      break;
    }
    case "profile": {
      if (query.categories.length || query.baskets.length || query.merchantType) throw new Error("Profile requires an unfiltered recent-complete period.");
      if (query.start !== monthStart(query.start) || query.end !== monthEnd(query.end)) throw new Error("Profile requires complete calendar months.");
      sections.push({ label: "Basket shares", rows: Object.entries(spending.baskets).map(([basket, amount]) =>
        resultRow(basketLabels[basket as Basket], amount, spending.evidence.filter(row => row.basket === basket).length, spending.totalCents)) },
      { label: "Top categories", rows: ranked(grouped(spending, row => row.category), spending.totalCents, top ?? 3) });
      const categories = [...new Set(spending.evidence.map(row => row.category))];
      const months = monthsIn(query);
      const ranges = categories.map(category => {
        const totals = months.map(month => spending.evidence.filter(row => row.category === category && row.date.startsWith(month.slice(0, 7)))
          .reduce((sum, row) => sum + row.amountCents, 0));
        return { category, range: Math.max(...totals) - Math.min(...totals) };
      }).sort((a, b) => b.range - a.range || a.category.localeCompare(b.category));
      sections.push({ label: "Most variable category (monthly range)", rows: ranges.length ? [resultRow(ranges[0].category, ranges[0].range, months.length)] : [] });
      assumptions.push("Most variable means the largest monthly maximum-minus-minimum spending range, including zero-spending months, not a personality or motive. Ties use category name order. Basket shares round half up to one decimal; top categories include an Other remainder. The coordinator supplies the recent complete-month period.");
      if (!ranges.length) assumptions.push("No matching categories; no most-variable category can be identified.");
      break;
    }
  }
  return analysisSchema.parse({ kind, query, title: `${kind === "whatif" ? "What-if" : kind[0].toUpperCase() + kind.slice(1)} · ${queryLabel(query)}`,
    sections, evidence: [...evidence.values()], evidenceCount: evidence.size, assumptions: [...new Set(assumptions)] });
}
