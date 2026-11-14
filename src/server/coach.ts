import "server-only";
import { calculateSpending, euros, nextDate, percentageScenario } from "@/domain/spending";
import { basketLabels, type CoachRequest, type CoachView, type Activity, viewSchema } from "@/shared/contracts";
import { categories, dataset } from "./data";
import { AppError } from "./errors";
import { interpret, interpretationSchema, type Interpretation } from "./providers/gemini";
import { consumeBudget, readSession, updateSession } from "./storage/sessions";
import { type SessionState } from "./storage/state";

function spending(state: SessionState) {
  if (!state.query) throw new AppError("Ask about a category first.");
  return calculateSpending(dataset.transactions, state.customerId, state.query, state.corrections, state.demoDate);
}
function reveal(state: SessionState, guessCents: number | null): SessionState {
  const result = spending(state);
  return { ...state, mode: "reveal", guessCents, percent: null,
    message: result.evidence.length
      ? `${euros(result.totalCents)} across ${result.evidence.length} ${result.query.category.toLowerCase()} transactions. ${guessCents === null ? "Here's the recorded picture." : "Thanks for guessing. Now you have the recorded picture."} These are historical records, not money saved.`
      : `No matching ${result.query.category.toLowerCase()} spending records in this period. The recorded total is ${euros(0)}; that isn't proof of no spending outside this dataset.` };
}

function checkin(state: SessionState): SessionState {
  if (!state.habit) return { ...state, mode: "none", query: null, message: "Choose a category to explore, then tap Keep an eye on it to confirm a daily habit. Nothing is saved until you confirm." };
  const query = { category: state.habit.category, start: state.demoDate, end: state.demoDate };
  const result = calculateSpending(dataset.transactions, state.customerId, query, state.corrections, state.demoDate);
  return { ...state, mode: "checkin", query, guessCents: null, percent: null,
    message: state.completedDates.includes(state.demoDate) ? "You've already reflected on this simulated date. Your completed day is saved."
      : result.evidence.length ? `${euros(result.totalCents)} in ${query.category.toLowerCase()} on this simulated date. How did your chosen action go? Essential spending never invalidates a check-in.`
      : `No ${query.category.toLowerCase()} spending recorded on this simulated date. Your reflection still counts. How did your chosen action go?` };
}

function scenario(state: SessionState, percent: number): SessionState {
  if (state.mode !== "reveal") throw new AppError("Reveal the spending first, then explore a what-if.");
  const result = percentageScenario(spending(state).baskets.everyday, percent);
  return { ...state, percent, message: `A ${percent}% reduction of the ${euros(result.baseCents)} currently in Everyday spending would be ${euros(result.reductionCents)} less. This is hypothetical, not money saved. Correct any necessary purchases first.` };
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
      return { ...state, mode: "invitation", message: `Let's look at ${result.query.category.toLowerCase()}, ${result.query.start} to ${result.query.end}. Want to guess before I show you?` };
    }
    if (result.kind === "reveal" && state.mode === "invitation") return reveal({ ...state, skipGuess: true }, null);
    if (result.kind === "scenario" && result.percent !== null) return scenario(state, result.percent);
    if (result.kind === "checkin") return checkin(state);
    if (result.kind === "habit") return { ...state, message: "Tap Keep an eye on it or Edit habit to choose your action. Review the form and confirm to save it." };
    // Model output selects an operation or tone, never user-visible prose.
    // Financial wording below comes only from validated, scoped calculations.
    // shortcut: day chat uses bounded wording; revisit conversational variety
    // with an evidence-checked response contract after the bounded demo.
    const message = result.kind === "chat"
      ? result.reply === "tired" ? "A long day can take a lot out of you. Want to tell me what felt difficult? We don't need to turn it into a money task."
        : result.reply === "positive" ? "It's good to make room for the good moments too. What felt good about today?"
          : "I'm here to listen. What's on your mind? We can talk without starting a money task."
      : result.reply === "scope" ? `This demo only has one synthetic customer's records, from ${dataset.period.start} to the simulated date ${state.demoDate}. It cannot access other accounts or move money. Choose one of the supported categories and a period.`
        : "Which spending category and period would you like to explore? For example, groceries in October. Missing records aren't proof of no spending elsewhere.";
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
    return { ...state, percent: null, message: `Updated to ${basketLabels[request.basket]}. You know the context best. Historical spending is unchanged; future what-ifs will use this interpretation.` };
  }
  if (request.action === "scenario") return scenario(state, request.percent);
  if (request.action === "habit") {
    if (!categories.includes(request.habit.category)) throw new AppError("Choose an available spending category.");
    return { ...state, habit: request.habit, mode: "none", query: null, guessCents: null, percent: null,
      message: "Your daily habit is saved. A small reflection is enough; this doesn't claim you've saved or moved money." };
  }
  if (request.action === "checkin") return checkin(state);
  if (request.action === "complete") {
    if (!state.habit || state.mode !== "checkin") throw new AppError("Open your daily check-in before completing it.");
    if (!state.completedDates.includes(state.demoDate)) {
      state.completedDates.push(state.demoDate);
      state.reflections[state.demoDate] = request.reflection;
    }
    return { ...state, message: `${state.completedDates.length} ${state.completedDates.length === 1 ? "day" : "days"} of reflection. Check-in complete! This rewards showing up, not spending less. Your action is self-reported.` };
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
