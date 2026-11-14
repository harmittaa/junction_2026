import "server-only";
import { calculateSpending, euros, nextDate, percentageScenario, queryLabel } from "@/domain/spending";
import { calculateAnalysis, recentCompleteQuery } from "@/domain/exploration";
import { completeWeeklyCheckup } from "@/domain/checkup";
import { speechText, type ReplyFacts } from "@/domain/replies";
import { analysisKindSchema, analysisOperationSchema, basketLabels, type Analysis, type CoachRequest, type CoachView, type Activity, viewSchema } from "@/shared/contracts";
import { categories, dataset } from "./data";
import { AppError } from "./errors";
import { compose, interpret, validatePlan, type Interpretation } from "./providers/gemini";
import { consumeBudget, readSession, updateSession } from "./storage/sessions";
import { type SessionState } from "./storage/state";

// Sponky's voice: a curious, upbeat friend. Short spoken sentences, reacts to
// what the user did, and states each caution once, where it changes meaning.
const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const month = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);
function period({ start, end }: { start: string; end: string }) {
  if (start === end) return `on ${day.format(utc(start))}`;
  const wholeMonth = start.endsWith("-01") && nextDate(end).endsWith("-01") && start.slice(0, 7) === end.slice(0, 7);
  return wholeMonth ? `in ${month.format(utc(start))}` : `from ${fullDate.format(utc(start))} to ${fullDate.format(utc(end))}`;
}

function spending(state: SessionState) {
  if (!state.query) throw new AppError("Ask about spending first.");
  return calculateSpending(dataset.transactions, state.customerId, state.query, state.corrections, state.demoDate);
}
function analysis(state: SessionState) {
  if (!state.analysis) throw new AppError("Ask an exploration question first.");
  return calculateAnalysis(dataset.transactions, state.customerId, state.analysis, state.corrections, state.demoDate, dataset.period.start);
}
const itemNotice = "Single items and real merchant names aren't in the data. This is a wider total, not an item total.";
function analysisSummary(result: Analysis) {
  const rows = result.sections.flatMap(section => section.rows);
  const selected = result.kind === "whatif" ? rows.filter(row => /reduction|annual|year/i.test(row.label)) : rows.slice(0, 3);
  const basis = result.kind === "whatif" ? result.sections.find(section => section.label.startsWith("Projection basis:"))?.label : undefined;
  if (result.kind === "profile") {
    if (!result.evidenceCount) return `No matching spending records ${period(result.query)}. That does not establish spending outside this dataset.`;
    const baskets = result.sections[0].rows.map(row => `${row.label}: ${row.sharePercent}%`).join(", ");
    const top = result.sections[1].rows[0];
    const variable = result.sections[2].rows[0];
    return `Your recorded spending ${period(result.query)}: ${baskets}. ${top ? `Top category: ${top.label}, ${euros(top.amountCents)}. ` : ""}${variable ? `Largest monthly range: ${variable.label}, ${euros(variable.amountCents)}.` : "No matching categories."} These are patterns, not personality labels.`;
  }
  if (result.kind === "cashflow") return `Recorded ${period(result.query)}: income ${euros(rows[0].amountCents)}, spending ${euros(rows[1].amountCents)}, and recorded transfers to investments ${euros(rows[2].amountCents)}. Investment deposits are not a verified goal result.`;
  return `${result.title} ${period(result.query)}: ${selected.map(row => `${row.label}: ${euros(row.amountCents)}`).join("; ")}. ${basis ? `${basis}. ` : ""}${result.kind === "whatif" ? "Hypothetical only; no money has been saved." : "The card shows the full calculation and assumptions."}`;
}
function guessReaction(guessCents: number, totalCents: number) {
  const gap = Math.abs(totalCents - guessCents);
  if (gap === 0) return `Spot on! You guessed ${euros(guessCents)}, and that's exactly it.`;
  // Within 10% counts as close, compared in integer cents.
  if (gap * 10 <= totalCents) return `So close! You guessed ${euros(guessCents)}, and it's ${euros(totalCents)}.`;
  return totalCents > guessCents
    ? `Plot twist! It's ${euros(totalCents)}, ${euros(gap)} more than your guess of ${euros(guessCents)}.`
    : `Less than you thought. It's ${euros(totalCents)}, ${euros(gap)} under your guess of ${euros(guessCents)}.`;
}
function reveal(state: SessionState, guessCents: number | null): SessionState {
  const result = spending(state);
  const category = queryLabel(result.query).toLowerCase();
  const count = `${result.evidence.length} ${result.evidence.length === 1 ? "payment" : "payments"}`;
  return { ...state, mode: "reveal", analysis: null, guessCents, percent: null,
    message: !result.evidence.length
      ? `Nothing here! I found no ${category} spending in your records ${period(result.query)}, so that's ${euros(0)}. Anything you paid outside this dataset wouldn't show up, though.`
      : guessCents === null
        ? `Here it is: ${euros(result.totalCents)} on ${category} ${period(result.query)}, across ${count}. Want to see where it went?`
        : `${guessReaction(guessCents, result.totalCents)} That's ${count} ${period(result.query)}. Want to see where it went?` };
}

function checkin(state: SessionState): SessionState {
  if (!state.habit) return { ...state, mode: "none", query: null, message: "We haven't picked a daily habit yet! Ask me about a category, then tap Keep an eye on it. Nothing's saved until you confirm." };
  const query = { categories: [state.habit.category], baskets: [], merchantType: null, start: state.demoDate, end: state.demoDate };
  const result = calculateSpending(dataset.transactions, state.customerId, query, state.corrections, state.demoDate);
  const today = `${day.format(utc(state.demoDate))}, our simulated today`;
  const ask = `How did “${state.habit.action}” go?`;
  return { ...state, mode: "checkin", query, analysis: null, itemLimitation: false, guessCents: null, percent: null,
    message: state.completedDates.includes(state.demoDate) ? `You've already checked in for ${today}. It's saved, nice work!`
      : result.evidence.length ? `Check-in time! It's ${today}, with ${euros(result.totalCents)} on ${state.habit.category.toLowerCase()}. ${ask} Needed spending never counts against you.`
      : `Check-in time! It's ${today}, and there's no ${state.habit.category.toLowerCase()} spending recorded. ${ask} Your reflection counts either way.` };
}

function scenario(state: SessionState, percent: number): SessionState {
  if (state.mode !== "reveal") throw new AppError("Reveal the spending first, then explore a what-if.");
  const result = percentageScenario(spending(state).baskets.everyday, percent);
  return { ...state, percent, message: `Let's play pretend: trimming ${percent}% off your ${euros(result.baseCents)} of everyday spending would free up ${euros(result.reductionCents)}. Purely hypothetical, nothing's actually saved. Move any must-haves out of Everyday first so the maths stays fair.` };
}

export function transition(current: SessionState, request: CoachRequest, interpretation?: Interpretation): SessionState {
  if (current.customerId !== dataset.customerId) throw new AppError("This session uses another dataset.", 409);
  let state = structuredClone(current);
  if (request.action === "ask") {
    const result = validatePlan(interpretation, { categories, ...dataset.period, referenceDate: state.demoDate, previousQuery: state.query });
    if (analysisKindSchema.safeParse(result.kind).success) {
      const query = result.kind === "profile" ? recentCompleteQuery(state.demoDate, dataset.period.start) : result.query;
      const operation = analysisOperationSchema.parse({ kind: result.kind, query, comparePeriod: result.comparePeriod, by: result.by, top: result.top, percent: result.percent });
      state = { ...state, mode: "analysis", query, analysis: operation, itemLimitation: result.reply === "items", guessCents: null, percent: null };
      return { ...state, message: analysisSummary(analysis(state)) };
    }
    if (result.kind === "spending" && result.query) {
      calculateSpending(dataset.transactions, state.customerId, result.query, state.corrections, state.demoDate);
      state = { ...state, query: result.query, analysis: null, itemLimitation: result.reply === "items", guessCents: null, percent: null };
      if (result.direct || state.skipGuess || state.itemLimitation) return reveal({ ...state, skipGuess: result.direct || state.skipGuess }, null);
      return { ...state, mode: "invitation", message: `Ooh, ${queryLabel(result.query).toLowerCase()} ${period(result.query)}! Want to guess before I show you?` };
    }
    if (result.kind === "reveal" && state.mode === "invitation") return reveal({ ...state, skipGuess: true }, null);
    if (result.kind === "scenario" && result.percent !== null) return scenario(state, result.percent);
    if (result.kind === "checkin") return checkin(state);
    if (result.kind === "habit") return { ...state, message: "Love that idea! Tap Keep an eye on it or Edit habit to pick your action. I'll save it once you confirm." };
    // The model plans, then writes from application-calculated facts. Only a
    // verified reply reaches text/speech; these sentences are its safe fallback.
    const message = result.kind === "explain" && result.concept ? concepts[result.concept] : result.kind === "chat"
      ? result.reply === "tired" ? "Oof, sounds like a long day. Want to tell me what made it tough? We can skip the money talk."
        : result.reply === "positive" ? "Love hearing that! What was the best bit of your day?"
          : "I'm all ears. What's on your mind? We don't have to talk money."
      : result.reply === "scope" ? "I can explore only your selected historical records. I can't access other customers, move money, forecast safe spending or compare you with peers. Want to look at your own spending instead?"
        : result.reply === "items" ? `${itemNotice} We can look at a category or merchant type instead, such as Restaurants or fast food.`
          : "Happy to dig in! What would you like to explore, and for which period? I can show totals, comparisons, monthly patterns or a breakdown.";
    return { ...state, mode: "none", query: null, analysis: null, itemLimitation: false, guessCents: null, percent: null,
      message };
  }
  if (request.action === "reveal") {
    if (state.mode !== "invitation") throw new AppError("There is no hidden answer waiting.");
    return reveal({ ...state, skipGuess: request.guessCents === null || state.skipGuess }, request.guessCents);
  }
  if (request.action === "correct") {
    const evidence = state.mode === "reveal" ? spending(state).evidence
      : state.mode === "analysis" && state.analysis?.kind !== "cashflow" ? analysis(state).evidence : [];
    if (!evidence.slice(0, 40).some(row => row.id === request.transactionId)) throw new AppError("Choose a transaction in the revealed evidence.");
    state.corrections[request.transactionId] = request.basket;
    return { ...state, percent: null, message: `Got it, that's ${basketLabels[request.basket]} now. You know your life best! The amount stays the same; only the basket changes.` };
  }
  if (request.action === "scenario") return scenario(state, request.percent);
  if (request.action === "weekly-checkup") {
    const result = completeWeeklyCheckup(state.weeklyCompletedDates, state.demoDate);
    return { ...state, weeklyCompletedDates: result.completedDates,
      message: `Your weekly check-up is complete. ${result.streak} weeks in a row — that's showing up for yourself.` };
  }
  if (request.action === "habit") {
    if (!categories.includes(request.habit.category)) throw new AppError("Choose an available spending category.");
    return { ...state, habit: request.habit, mode: "none", query: null, analysis: null, itemLimitation: false, guessCents: null, percent: null,
      message: `Habit saved: “${request.habit.action}”.${request.habit.goal ? ` Keeping “${request.habit.goal}” in sight.` : ""} I'll check in with you each day. A quick reflection is all it takes.` };
  }
  if (request.action === "checkin") return checkin(state);
  if (request.action === "complete") {
    if (!state.habit || state.mode !== "checkin") throw new AppError("Open your daily check-in before completing it.");
    if (!state.completedDates.includes(state.demoDate)) {
      state.completedDates.push(state.demoDate);
      state.reflections[state.demoDate] = request.reflection;
    }
    return { ...state, message: `Check-in complete! That's ${state.completedDates.length} ${state.completedDates.length === 1 ? "day" : "days"} of showing up. The streak is about checking in, not spending less.` };
  }
  if (request.action === "advance") {
    const date = nextDate(state.demoDate);
    if (date > dataset.period.end) throw new AppError("You've reached the end of this historical demo slice.");
    return checkin({ ...state, demoDate: date, mode: "none", query: null, guessCents: null, percent: null,
      message: "Simulated date advanced. This is historical data, not a live feed." });
  }
  return state;
}

export function toView(state: SessionState): CoachView {
  let activity: Activity = { kind: "none" };
  if (state.mode === "invitation" && state.query) activity = { kind: "invitation", query: state.query };
  if (state.mode === "reveal") {
    const result = spending(state);
    activity = { kind: "reveal", spending: result, guessCents: state.guessCents,
      scenario: state.percent === null ? null : percentageScenario(result.baskets.everyday, state.percent) };
  }
  if (state.mode === "checkin") activity = { kind: "checkin", spending: spending(state), completed: state.completedDates.includes(state.demoDate) };
  if (state.mode === "analysis") activity = { kind: "analysis", analysis: analysis(state) };
  if (activity.kind === "reveal" || activity.kind === "checkin") activity.spending.evidence = activity.spending.evidence.slice(0, 40);
  if (activity.kind === "analysis") activity.analysis.evidence = activity.analysis.evidence.slice(0, 40);
  return viewSchema.parse({ revision: state.revision, demoDate: state.demoDate, message: state.message, activity,
    habit: state.habit, completedDates: state.completedDates, categories, period: { start: dataset.period.start, end: state.demoDate } });
}

export async function coach(id: string, request: CoachRequest, signal?: AbortSignal) {
  const state = await readSession(id);
  if (state.revision !== request.revision) throw new AppError("A newer turn is already saved. Refresh and try again.", 409, true);
  let interpretation: Interpretation | undefined;
  // All model work shares the existing browser turn deadline. Reserve worst-case
  // calls atomically; an SDK retry cannot exceed the three-call turn ceiling.
  const deadline = AbortSignal.any([AbortSignal.timeout(27000), ...(signal ? [signal] : [])]);
  if (request.action === "ask") {
    await consumeBudget(id, "reasoning", new Date(), 3);
    interpretation = await interpret(request.text, { categories, ...dataset.period, referenceDate: state.demoDate, previousQuery: state.query }, deadline);
  }
  let next = transition(state, request, interpretation);
  if ((request.action === "ask" && !["checkin", "habit", "scenario"].includes(interpretation!.kind)) || request.action === "reveal") {
    if (request.action === "reveal") await consumeBudget(id, "reasoning", new Date(), 2);
    next = { ...next, message: await compose(replyFacts(next, interpretation), deadline) };
  }
  if (signal?.aborted) throw new AppError("Turn canceled", 499, true);
  return toView(await updateSession(id, request.revision, () => next));
}

const concepts = {
  baskets: "The three baskets are regular essentials, like rent; unexpected necessities, like an urgent repair; and everyday spending, like food or outings. They are correctable interpretations, not judgments. Everyday spending can still be essential.",
  budget: "A budget is a plan for how to use your money. Start with income and essentials, then leave room for irregular costs and things you choose. It is a plan you can adjust, not a score of how well you live.",
  interest: "Interest is the cost of borrowing money, or the return paid on some deposits. The rate and the time both matter. Fees and terms can change the overall cost or return.",
  compound_interest: "Compound interest means interest can itself earn interest over time. With debt, that can also mean interest is charged on earlier interest. Rates, fees and timing matter; investment returns are not guaranteed.",
  inflation: "Inflation means prices generally rise over time, so the same money buys less. Your own costs may change differently from the overall price measure.",
  saving: "Saving means setting money aside for later. A hypothetical spending cut is not money already saved, and a transfer to investments is not proof that a savings goal was met.",
  investing: "Investing puts money into assets whose value can rise or fall. A recorded transfer to investments shows money moved there, not a guaranteed return or verified savings.",
  gross_net: "Gross spending here adds recorded purchases and bills before any refund adjustment. Net cash flow compares money coming in and going out. Investment transfers are not consumption, so these measures answer different questions.",
};

export function replyFacts(state: SessionState, plan?: Interpretation): ReplyFacts {
  const base: ReplyFacts = { kind: state.mode, subject: state.query ? queryLabel(state.query) : plan?.concept ?? plan?.reply ?? "conversation",
    period: state.query ? period(state.query) : "", values: [], notes: [], required: [], fallback: state.message };
  // Do not calculate, serialize or forward the hidden answer to the writer.
  if (state.mode === "invitation") return base;
  if (state.mode === "reveal") {
    const result = spending(state);
    base.values = [{ label: `${queryLabel(result.query)} recorded spending`, amountCents: result.totalCents, count: result.evidenceCount }];
    if (state.guessCents !== null) base.values.push({ label: "Your guess", amountCents: state.guessCents },
      { label: "Absolute difference from your guess", amountCents: Math.abs(state.guessCents - result.totalCents) });
    base.notes = result.assumptions;
    if (state.query?.merchantType && result.missingMccCount) base.required!.push("Missing merchant codes mean this merchant-type subtotal may be incomplete.");
    if (!result.evidenceCount) base.notes.push("No matching records is not proof of no spending outside this dataset.");
  } else if (state.mode === "analysis") {
    const result = analysis(state);
    base.kind = result.kind;
    base.subject = result.title;
    base.values = result.sections.flatMap(section => section.rows.map(row => ({ label: `${section.label}: ${row.label}`, amountCents: row.amountCents,
      ...(row.count !== null ? { count: row.count } : {}), ...(row.sharePercent !== null ? { percent: row.sharePercent } : {}) })));
    base.notes = result.assumptions;
    if (state.analysis?.percent !== null && state.analysis?.percent !== undefined) base.values.push({ label: "Requested hypothetical reduction", percent: state.analysis.percent });
    if (result.assumptions.some(note => /subtotal may be incomplete|subtotals may be incomplete/.test(note))) base.required!.push("Missing merchant codes mean merchant-type subtotals may be incomplete.");
    if (result.kind === "whatif") {
      const basis = result.sections.find(section => section.label.startsWith("Projection basis:"));
      base.required!.push(basis ? `${basis.label}.` : "No complete months are available for an annual projection.");
    }
  } else {
    base.kind = plan?.kind ?? "chat";
    base.notes = [state.message];
  }
  if (state.itemLimitation) base.required!.unshift(itemNotice);
  if (base.required!.length) base.fallback = [base.fallback, ...base.required!.filter(note => !base.fallback.includes(note))].join(" ");
  if (base.fallback.length > 480 || speechText(base.fallback).length > 600) {
    base.fallback = `The card shows the calculated results ${base.period}, with the source records and assumptions. ${base.required!.join(" ")}`.trim();
  }
  return base;
}
