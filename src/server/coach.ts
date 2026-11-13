import "server-only";
import { calculateSpending, euros } from "@/domain/spending";
import { type CoachRequest, type CoachView, type Activity, viewSchema } from "@/shared/contracts";
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
    message: `${euros(result.totalCents)} across ${result.evidence.length} ${result.query.category.toLowerCase()} transactions. ${guessCents === null ? "Here's the real picture." : "Thanks for guessing. Now you have the real picture."} These are historical records, not money saved.` };
}

export function transition(current: SessionState, request: CoachRequest, interpretation?: Interpretation): SessionState {
  let state = structuredClone(current);
  if (request.action === "ask") {
    const result = interpretationSchema.parse(interpretation);
    if (result.kind === "spending" && result.query) {
      if (!categories.includes(result.query.category) || result.query.start < dataset.period.start) throw new AppError("That category or period isn't in this demo.");
      calculateSpending(dataset.transactions, state.customerId, result.query, state.corrections, state.demoDate);
      state = { ...state, query: result.query, guessCents: null, percent: null };
      if (result.direct || state.skipGuess) return reveal(state, null);
      return { ...state, mode: "invitation", message: `Let's look at ${result.query.category.toLowerCase()}, ${result.query.start} to ${result.query.end}. Want to guess before I show you?` };
    }
    if (result.kind === "reveal" && state.mode === "invitation") return reveal({ ...state, skipGuess: true }, null);
    return { ...state, mode: "none", query: null, guessCents: null, percent: null,
      message: result.reply || "Ask me about a category and period in the demo, such as groceries in October." };
  }
  if (request.action === "reveal") {
    if (state.mode !== "invitation") throw new AppError("There is no hidden answer waiting.");
    return reveal({ ...state, skipGuess: request.guessCents === null || state.skipGuess }, request.guessCents);
  }
  throw new AppError("This activity isn't available yet.");
}

export function toView(state: SessionState): CoachView {
  let activity: Activity = { kind: "none" };
  if (state.mode === "invitation" && state.query) activity = { kind: "invitation", query: state.query };
  if (state.mode === "reveal") activity = { kind: "reveal", spending: spending(state), guessCents: state.guessCents, scenario: null };
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
