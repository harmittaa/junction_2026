import "server-only";
import { calculateSpending, euros, nextDate, percentageScenario } from "@/domain/spending";
import { basketLabels, type CoachRequest, type CoachView, type Activity, viewSchema } from "@/shared/contracts";
import { categories, dataset } from "./data";
import { AppError } from "./errors";
import { interpret, interpretationSchema, type Interpretation } from "./providers/gemini";
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
  if (!state.query) throw new AppError("Ask about a category first.");
  return calculateSpending(dataset.transactions, state.customerId, state.query, state.corrections, state.demoDate);
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
  const category = result.query.category.toLowerCase();
  const count = `${result.evidence.length} ${result.evidence.length === 1 ? "payment" : "payments"}`;
  return { ...state, mode: "reveal", guessCents, percent: null,
    message: !result.evidence.length
      ? `Nothing here! I found no ${category} spending in your records ${period(result.query)}, so that's ${euros(0)}. Anything you paid outside this dataset wouldn't show up, though.`
      : guessCents === null
        ? `Here it is: ${euros(result.totalCents)} on ${category} ${period(result.query)}, across ${count}. Want to see where it went?`
        : `${guessReaction(guessCents, result.totalCents)} That's ${count} ${period(result.query)}. Want to see where it went?` };
}

function checkin(state: SessionState): SessionState {
  if (!state.habit) return { ...state, mode: "none", query: null, message: "We haven't picked a daily habit yet! Ask me about a category, then tap Keep an eye on it. Nothing's saved until you confirm." };
  const query = { category: state.habit.category, start: state.demoDate, end: state.demoDate };
  const result = calculateSpending(dataset.transactions, state.customerId, query, state.corrections, state.demoDate);
  const today = `${day.format(utc(state.demoDate))}, our simulated today`;
  const ask = `How did “${state.habit.action}” go?`;
  return { ...state, mode: "checkin", query, guessCents: null, percent: null,
    message: state.completedDates.includes(state.demoDate) ? `You've already checked in for ${today}. It's saved, nice work!`
      : result.evidence.length ? `Check-in time! It's ${today}, with ${euros(result.totalCents)} on ${query.category.toLowerCase()}. ${ask} Needed spending never counts against you.`
      : `Check-in time! It's ${today}, and there's no ${query.category.toLowerCase()} spending recorded. ${ask} Your reflection counts either way.` };
}

function scenario(state: SessionState, percent: number): SessionState {
  if (state.mode !== "reveal") throw new AppError("Reveal the spending first, then explore a what-if.");
  const result = percentageScenario(spending(state).baskets.everyday, percent);
  return { ...state, percent, message: `Let's play pretend: trimming ${percent}% off your ${euros(result.baseCents)} of everyday spending would free up ${euros(result.reductionCents)}. Purely hypothetical, nothing's actually saved. Move any must-haves out of Everyday first so the maths stays fair.` };
}

export function transition(current: SessionState, request: CoachRequest, interpretation?: Interpretation): SessionState {
  let state = structuredClone(current);
  if (request.action === "ask") {
    const result = interpretationSchema.parse(interpretation);
    if (result.kind === "spending" && result.query) {
      if (!categories.includes(result.query.category) || result.query.start < dataset.period.start) throw new AppError("That category or period isn't in this demo.");
      calculateSpending(dataset.transactions, state.customerId, result.query, state.corrections, state.demoDate);
      state = { ...state, query: result.query, guessCents: null, percent: null };
      if (result.direct || state.skipGuess) return reveal({ ...state, skipGuess: true }, null);
      return { ...state, mode: "invitation", message: `Ooh, ${result.query.category.toLowerCase()} ${period(result.query)}! Want to guess before I show you?` };
    }
    if (result.kind === "reveal" && state.mode === "invitation") return reveal({ ...state, skipGuess: true }, null);
    if (result.kind === "scenario" && result.percent !== null) return scenario(state, result.percent);
    if (result.kind === "checkin") return checkin(state);
    if (result.kind === "habit") return { ...state, message: "Love that idea! Tap Keep an eye on it or Edit habit to pick your action. I'll save it once you confirm." };
    // Model output selects an operation or tone, never user-visible prose.
    // Financial wording below comes only from validated, scoped calculations.
    // shortcut: day chat uses bounded wording; revisit conversational variety
    // with an evidence-checked response contract after the bounded demo.
    const message = result.kind === "chat"
      ? result.reply === "tired" ? "Oof, sounds like a long day. Want to tell me what made it tough? We can skip the money talk."
        : result.reply === "positive" ? "Love hearing that! What was the best bit of your day?"
          : "I'm all ears. What's on your mind? We don't have to talk money."
      : result.reply === "scope" ? `Ah, that's outside what I can see. I only know this demo customer's records ${period({ start: dataset.period.start, end: state.demoDate })}, our simulated today, and I can't move money. Try ${new Intl.ListFormat("en", { type: "disjunction" }).format(categories.map(category => category.toLowerCase()))}?`
        : "Happy to dig in! Which category and when? For example, groceries in August.";
    return { ...state, mode: "none", query: null, guessCents: null, percent: null,
      message };
  }
  if (request.action === "reveal") {
    if (state.mode !== "invitation") throw new AppError("There is no hidden answer waiting.");
    return reveal({ ...state, skipGuess: request.guessCents === null || state.skipGuess }, request.guessCents);
  }
  if (request.action === "correct") {
    if (state.mode !== "reveal" || !spending(state).evidence.some(row => row.id === request.transactionId)) throw new AppError("Choose a transaction in the revealed evidence.");
    state.corrections[request.transactionId] = request.basket;
    return { ...state, percent: null, message: `Got it, that's ${basketLabels[request.basket]} now. You know your life best! The amount stays the same; only the basket changes.` };
  }
  if (request.action === "scenario") return scenario(state, request.percent);
  if (request.action === "habit") {
    if (!categories.includes(request.habit.category)) throw new AppError("Choose an available spending category.");
    return { ...state, habit: request.habit, mode: "none", query: null, guessCents: null, percent: null,
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
  return viewSchema.parse({ revision: state.revision, demoDate: state.demoDate, message: state.message, activity,
    habit: state.habit, completedDates: state.completedDates, categories, period: { start: dataset.period.start, end: state.demoDate } });
}

export async function coach(id: string, request: CoachRequest, signal?: AbortSignal) {
  const state = await readSession(id);
  if (state.revision !== request.revision) throw new AppError("A newer turn is already saved. Refresh and try again.", 409, true);
  let interpretation: Interpretation | undefined;
  if (request.action === "ask") {
    await consumeBudget(id, "reasoning");
    interpretation = await interpret(request.text, { categories, ...dataset.period, referenceDate: state.demoDate, previousQuery: state.query }, signal);
  }
  if (signal?.aborted) throw new AppError("Turn canceled", 499, true);
  return toView(await updateSession(id, request.revision, current => transition(current, request, interpretation)));
}
