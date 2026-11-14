import { analysisOperationSchema, analysisSchema, basketLabels, dateSchema, type Analysis,
  type AnalysisOperation, type Basket, type Spending, type SpendingQuery, type Transaction } from "@/shared/contracts";
import { formatDay, formatRange } from "@/domain/dates";
import { merchantTypes } from "@/domain/merchant-types";
import { calculateSpending, defaultBasket, euros, percentageScenario, queryLabel } from "@/domain/spending";

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

const byLabel = { category: "Spending by category", basket: "Spending by basket", month: "Spending by month", merchantType: "Where the money went" } as const;
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

/** Latest complete 1 Dec - 31 Jan before the current month, all Transportation. */
export function winterQuery(referenceDate: string): SpendingQuery {
  dateSchema.parse(referenceDate);
  const month = Number(referenceDate.slice(5, 7));
  if (month < 2 || month > 11) throw new Error("No complete winter is available yet.");
  const year = Number(referenceDate.slice(0, 4));
  return { start: `${year - 1}-12-01`, end: `${year}-01-31`, categories: ["Transportation"], baskets: [], merchantType: null };
}

const monthName = (month: string, style: "long" | "short") =>
  new Date(`${month.slice(0, 7)}-01T12:00:00Z`).toLocaleString("en-US", { month: style, year: "numeric", timeZone: "UTC" });
// Round half up to cents.
const averageCents = (sum: number, count: number) => Math.floor((sum + count / 2) / count);

/** Reads the figures back out of a "season" analysis so the card and reply never recompute them. */
export function seasonFacts(analysis: Analysis) {
  const [normalSection, winterSection, extraSection] = analysis.sections;
  const winterAverage = winterSection.rows[winterSection.rows.length - 1];
  return { normal: normalSection.rows[0], months: winterSection.rows.slice(0, -1), winterAverage,
    extraCents: extraSection.rows[0].amountCents, percent: Number(/\+(\d+)%/.exec(extraSection.label)?.[1] ?? NaN) };
}

/** Reads the figures back out of a "whatif" analysis so the card and reply never recompute them. */
export function whatIfFacts(analysis: Analysis) {
  const [periodSection, basisSection] = analysis.sections;
  const { query } = analysis;
  const [total, reduction] = periodSection.rows;
  return { query, periodCents: total.amountCents, count: total.count ?? 0, periodReductionCents: reduction.amountCents,
    percent: Number(/\((\d+)%\)/.exec(reduction.label)?.[1] ?? NaN),
    name: query.categories.length ? query.categories.join(", ") : query.baskets.length ? query.baskets.map(basket => basketLabels[basket]).join(", ") : "spending",
    basis: basisSection ? { label: basisSection.label.replace("Projection basis: ", ""), averageCents: basisSection.rows[1].amountCents,
      months: basisSection.rows[1].count ?? 0, monthlyCents: basisSection.rows[2].amountCents, annualCents: basisSection.rows[3].amountCents } : null };
}

const TINY_CENTS = 100;
/** Deterministic headline, next step and spoken message for a what-if; one euro amount in the message. */
export function whatIfInsight(facts: ReturnType<typeof whatIfFacts>,
  context: { goalMonthlyCents: number; safeToSaveCents: number; referenceDate: string }) {
  const { name, percent, basis, query } = facts;
  const verb = percent === 100 ? `skipping ${name} entirely` : `trimming ${name} by ${percent}%`;
  const cap = (text: string) => text[0].toUpperCase() + text.slice(1);
  const edge = (headline: string, supporting: string[] = []) => ({ headline, supporting,
    message: [`Hypothetically: ${headline}`, ...supporting].join(" ") });
  if (percent === 0) return edge("A 0% trim leaves spending unchanged.");
  if (!basis) return edge(`${cap(verb)} would come to ${euros(facts.periodReductionCents)} in this period.`, ["There isn't a full month yet for a monthly figure."]);
  if (basis.averageCents === 0) return edge(`No ${name} spending in a usual month, so a trim frees nothing.`);
  const cut = basis.monthlyCents;
  const { goalMonthlyCents, safeToSaveCents } = context;
  // Integer ratios, floored. Goal first, then safe to save, else no comparison.
  let card = "", spoken = "";
  if (cut >= TINY_CENTS && goalMonthlyCents > 0) {
    const share = Math.floor(cut * 100 / goalMonthlyCents);
    [card, spoken] = cut >= goalMonthlyCents
      ? ["That covers what your goal needs each month.", "covering what your goal needs each month"]
      : [`That's about ${share}% of the ${euros(goalMonthlyCents)} your goal needs each month.`, `about ${share}% of what your goal needs each month`];
  } else if (cut >= TINY_CENTS && safeToSaveCents > 0) {
    const share = Math.floor(cut * 100 / safeToSaveCents);
    const free = "that usually stays free to save";
    [card, spoken] = cut >= 2 * safeToSaveCents ? [`That's more than double the ${euros(safeToSaveCents)} ${free}.`, `more than double what usually stays free to save`]
      : cut >= safeToSaveCents ? [`That's more than the ${euros(safeToSaveCents)} ${free}.`, `more than what usually stays free to save`]
      : [`That's about ${share}% of the ${euros(safeToSaveCents)} ${free}.`, `about ${share}% of what usually stays free to save`];
  }
  const month = new Date(`${context.referenceDate.slice(0, 7)}-01T12:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const current = query.start.slice(0, 7) === context.referenceDate.slice(0, 7) && query.end.slice(0, 7) === context.referenceDate.slice(0, 7);
  const next = [current && facts.periodCents > basis.averageCents
    ? `${name} spending is already past a usual month, so the rest of ${month} is an easy place to try it.`
    : "Try it for a month, then ask me to compare it with your usual.",
  ...(cut < TINY_CENTS ? ["Bigger categories may matter more."] : []),
  ...(query.baskets.length === 1 && query.baskets[0] === "everyday" ? [] : ["Everyday spending can include essentials."])].join(" ");
  return { headline: `${cap(verb)} would free ${euros(cut)} a month, or ${euros(basis.annualCents)} over a year.`,
    supporting: [...(card ? [card] : []), next],
    message: `Hypothetically, ${verb} would free ${euros(cut)} a month${spoken ? `, ${spoken}` : ""}. ${next}` };
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
  let title: string | undefined;
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
      sections.push({ label: byLabel[operation.by], rows: breakdown }, { label: "Period total", rows: [totalRow] });
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
        resultRow(formatRange(query.start, query.end), spending.totalCents, spending.evidenceCount),
        resultRow(formatRange(previous.query.start, previous.query.end), previous.totalCents, previous.evidenceCount),
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
      sections.push({ label: `Selected period: ${formatRange(query.start, query.end)}`, rows: [totalRow,
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
        sections.push({ label: `Projection basis: ${formatRange(recent.start, recent.end)}`, rows: [
          resultRow("Baseline recorded spending", baseline.totalCents, baseline.evidenceCount),
          resultRow("Monthly average (complete months)", average, months.length),
          resultRow(`Hypothetical monthly reduction (${operation.percent}%)`, monthlyReduction),
          resultRow(`Hypothetical annual reduction (${operation.percent}%)`, projection),
        ] });
        assumptions.push(`Annual projection uses ${months.length} available complete months before the current month: ${months.map(month => month.slice(0, 7)).join(", ")}, including zero months. Records begin ${formatDay(datasetStart)}. The same filters and corrections apply; fewer than six complete months are used only when data availability requires it.`);
      } else assumptions.push("No complete months available for a baseline; annual projection is unavailable, not zero.");
      assumptions.push("Hypothetical only, not recorded or verified savings. Round the selected-period reduction once, half up to cents. Floor the usual monthly average to cents, round its percentage reduction half up to cents, then multiply that monthly reduction by 12; this is not a forecast.");
      break;
    }
    case "season": {
      if (datasetStart === undefined) throw new Error("Season analysis requires the explicit dataset start date.");
      const winter = winterQuery(referenceDate);
      if (query.start !== winter.start || query.end !== winter.end || query.categories.join() !== "Transportation" || query.baskets.length || query.merchantType) {
        throw new Error("Season analysis uses the latest complete winter and all Transportation.");
      }
      const normalQuery = { ...recentCompleteQuery(referenceDate, datasetStart, 12), categories: ["Transportation"] };
      // Zero-spending months count; December and January are the winter being compared.
      const normalMonths = monthlyRows(calculateSpending(rows, customerId, normalQuery, corrections, referenceDate))
        .filter(row => !["12", "01"].includes(row.label.slice(5, 7)));
      if (!normalMonths.length) throw new Error("No normal months are available for a baseline.");
      const normalCents = averageCents(normalMonths.reduce((sum, row) => sum + row.amountCents, 0), normalMonths.length);
      const winterMonths = monthlyRows(spending).map(row => ({ ...row, label: monthName(row.label, "long") }));
      const winterCents = averageCents(spending.totalCents, winterMonths.length);
      const extraCents = winterCents - normalCents;
      const percent = normalCents > 0 ? Math.floor((extraCents * 100 + normalCents / 2) / normalCents) : null;
      title = "Winter transport vs a normal month";
      sections.push(
        { label: "Normal month", rows: [resultRow(`${monthName(normalQuery.start, "short")} – ${monthName(normalQuery.end, "short")}`, normalCents, normalMonths.length)] },
        { label: "Winter", rows: [...winterMonths, resultRow("Winter month average", winterCents, winterMonths.length)] },
        { label: `Extra per winter month${percent === null ? "" : ` (+${percent}%)`}`, rows: [resultRow("Winter minus normal month", extraCents)] },
      );
      assumptions.push("The normal month averages the complete months of the last 12 outside December and January, including zero-spending months. Averages round half up to cents; the percentage rounds half up to a whole number.");
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
  return analysisSchema.parse({ kind, query, title: title ?? `${kind === "whatif" ? "What-if" : kind[0].toUpperCase() + kind.slice(1)} · ${queryLabel(query)}`,
    sections, evidence: [...evidence.values()], evidenceCount: evidence.size, assumptions: [...new Set(assumptions)] });
}
