import "server-only";
import { calculateSpending, euros, nextDate, percentageScenario, queryLabel } from "@/domain/spending";
import { calculateAnalysis, recentCompleteQuery } from "@/domain/exploration";
import { calculateJar, calculateUsualComparison, completeWeeklyCheckup, weeklyCheckup } from "@/domain/checkup";
import { goalVerdict, noticed, safeToSave, safeToSpendWeek, usualMonth } from "@/domain/coaching";
import { changeGoalText, quantities, speechText, type ReplyFacts } from "@/domain/replies";
import { analysisKindSchema, analysisOperationSchema, basketLabels, type Analysis, type CoachRequest, type CoachView, type Activity, type Noticed, viewSchema } from "@/shared/contracts";
import { categories, dataset } from "./data";
import { AppError } from "./errors";
import { compose, interpret, scopePlan, validatePlan, type Interpretation } from "./providers/gemini";
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
function lastDayOfMonth(m: string): string {
  const [year, mon] = m.split("-").map(Number);
  return new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
}
function activeMonth(state: SessionState): string {
  return state.jarMonth && state.jarMonth < state.demoDate.slice(0, 7) ? state.jarMonth : state.demoDate.slice(0, 7);
}
function activePeriod(state: SessionState): { start: string; end: string } {
  const m = activeMonth(state);
  return { start: `${m}-01`, end: m === state.demoDate.slice(0, 7) ? state.demoDate : lastDayOfMonth(m) };
}
function checkupInput(state: SessionState) {
  let limit = state.profile.everydayLimit;
  if (state.goal) {
    const usual = usualMonth({
      rows: dataset.transactions,
      customerId: state.customerId,
      referenceDate: state.demoDate,
      corrections: state.corrections,
      datasetStart: dataset.period.start,
    });
    const verdict = goalVerdict(state.goal, usual, state.demoDate);
    limit = { ...limit, amountCents: verdict.neededJarCents };
  }
  return { rows: dataset.transactions, customerId: state.customerId, referenceDate: state.demoDate,
    corrections: state.corrections, limit, jarMonth: activeMonth(state) };
}
function jarMessage(state: SessionState, welcome = false) {
  const jar = calculateJar(checkupInput(state));
  if (activeMonth(state) < state.demoDate.slice(0, 7)) {
    if (jar.overCents) return `Your ${month.format(utc(jar.period.start))} jar went ${euros(jar.overCents)} over the rim. ${jar.topDays.length ? `The biggest days were ${jar.topDays.map(row => fullDate.format(utc(row.date))).join(" and ")}.` : "We can take a closer look together."}`;
    return `${euros(jar.leftCents)} left in your ${month.format(utc(jar.period.start))} jar, finishing inside your ${euros(jar.limitCents)} limit.`;
  }
  if (jar.overCents) return `${welcome ? "Welcome back. " : ""}Your jar is ${euros(jar.overCents)} over the rim. ${jar.topDays.length ? `The biggest days this past week were ${jar.topDays.map(row => fullDate.format(utc(row.date))).join(" and ")}.` : "We can take a closer look together."}`;
  return `${euros(jar.leftCents)} left in your ${month.format(utc(state.demoDate))} jar, with ${jar.daysLeft} days to go.${jar.daysLeft ? " Your daily room is on screen." : ""}`;
}
function currentEvidence(state: SessionState) {
  if (["jar", "pace", "overspend"].includes(state.mode)) return calculateJar(checkupInput(state)).evidence;
  if (["save", "goal", "spend_week"].includes(state.mode)) return [];
  if (state.mode === "usual") return calculateUsualComparison(checkupInput(state)).evidence;
  if (state.mode === "reveal") return spending(state).evidence.slice(0, 40);
  if (state.mode === "analysis" && state.analysis?.kind !== "cashflow") return analysis(state).evidence.slice(0, 40);
  return [];
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
    return `Your recorded spending ${period(result.query)}: ${baskets}. ${top ? `Top category: ${top.label}, ${euros(top.amountCents)}. ` : ""}The full breakdown is on screen. These are patterns, not personality labels.`;
  }
  if (result.kind === "cashflow") return `Recorded ${period(result.query)}: recorded transfers to investments came to ${euros(rows[2].amountCents)}. Income and spending are on screen. Investment deposits are not a verified goal result.`;
  if (result.kind === "whatif") {
    const row = rows.find(r => /monthly reduction/i.test(r.label)) ?? selected[0];
    return `${result.title} ${period(result.query)}: ${row ? `${row.label}: ${euros(row.amountCents)}. ` : ""}${basis ? `${basis}. ` : ""}Hypothetical only; no money has been saved. The full breakdown is on screen.`;
  }
  const headline = selected[0];
  return `${result.title} ${period(result.query)}: ${headline ? `${headline.label}: ${euros(headline.amountCents)}. ` : ""}The breakdown is on screen. The card shows the payments and calculation.`;
}
function guessReaction(guessCents: number, totalCents: number) {
  const gap = Math.abs(totalCents - guessCents);
  if (gap === 0) return `Spot on! You guessed it — it comes to ${euros(totalCents)}.`;
  // Within 10% counts as close, compared in integer cents.
  if (gap * 10 <= totalCents) return `So close! It comes to ${euros(totalCents)}.`;
  return totalCents > guessCents
    ? `Plot twist! A bit more than your guess: it comes to ${euros(totalCents)}.`
    : `Nice surprise! Less than your guess: it comes to ${euros(totalCents)}.`;
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
  return { ...state, percent, message: `Let's play pretend: trimming ${percent}% off your everyday spending would free up ${euros(result.reductionCents)}. Purely hypothetical, nothing's actually saved. Move any must-haves out of Everyday first so the maths stays fair.` };
}

// Spoken input has no reliable punctuation or apostrophes, so grammar is anchored
// and negation/hypothetical/question wording blocks mutation instead of being ignored.
const refusal = /\b(?:(?:is|was|were|are|do|does|did|has|have|had|could|would|should|ai)n[’']?t|can[’']?t|won[’']?t|cannot|not|no|nope|never|neither|nor|without|nothing|unnecessary|skip|if|suppose|imagine|example|pretend|hypothetical|maybe|might|would|could|should|assuming|quote|quoted|said)\b/i;
const asking = /\?|^\s*(?:was|were|is|are|did|do|does|can|could|would|should)\b|\b(?:who|which|what|whether|why|how)\b/i;
const checkupRequest = /^\s*(?:(?:ok(?:ay)?|yes|yeah|please|hey sponky)[,.!]?\s+)*(?:(?:let[’']?s|let us)\s+|(?:i(?:\s+(?:want|wanna|would like|need)|[’']d like)\s+to\s+)|(?:i[’']?m ready to\s+)|(?:please\s+)?)(?:do|start|begin|complete|finish)\s+(?:my|the|a|our)\s+(?:weekly\s+)?check[- ]?up[\s.!]*$/i;
const clearGoalRequest = /^\s*(?:(?:ok(?:ay)?|yes|yeah|please|hey sponky)[,.!]?\s+)*(?:(?:let[’']?s|let us)\s+|(?:i(?:\s+(?:want|wanna|would like|need)|[’']d like)\s+to\s+)|(?:please\s+)?)(?:remove|clear|delete|drop)\s+(?:my|the|a|our)\s+(?:savings\s+)?goal[\s.!]*$/i;
const necessityStatement = /\b(?:(?:was|were|is|it[’']?s|that[’']?s)\s+(?:(?:a|an|the|my|really|truly|actually|definitely|absolutely|very)\s+)*(?:necessity|necessary|essential|emergency|urgent|unavoidable|must[- ]have|must|burst pipe)\b|had to (?:pay|buy|get|fix|replace|cover)\b)/i;
export function transition(current: SessionState, request: CoachRequest, interpretation?: Interpretation): SessionState {
  if (current.customerId !== dataset.customerId) throw new AppError("This session uses another dataset.", 409);
  let state = structuredClone(current);
  if (request.action === "select-month") {
    if (request.month < state.profile.everydayLimit.activeSince || request.month > state.demoDate.slice(0, 7)) {
      throw new AppError("Choose an available month.");
    }
    state = { ...state, jarMonth: request.month === state.demoDate.slice(0, 7) ? null : request.month,
      mode: "jar", query: null, analysis: null, itemLimitation: false, guessCents: null, percent: null };
    return { ...state, message: jarMessage(state) };
  }
  if (request.action === "ask") {
    const result = validatePlan(interpretation, { categories, ...dataset.period, referenceDate: state.demoDate, previousQuery: state.query, selectedMonth: activeMonth(state) });
    if (result.kind === "weekly_checkup") {
      // Questions about a check-up are not permission to complete one.
      if (!checkupRequest.test(request.text)) return { ...state, message: "Ready when you are. Choose “Let's do my check-up” to begin." };
      return transition(state, { action: "weekly-checkup", revision: request.revision });
    }
    if (result.kind === "jar" || result.kind === "pace" || result.kind === "usual" || result.kind === "overspend") {
      const mode = result.kind;
      state = { ...state, mode, query: null, analysis: null, itemLimitation: false, guessCents: null, percent: null };
      const jar = calculateJar(checkupInput(state));
      const usual = mode === "usual" ? calculateUsualComparison(checkupInput(state)) : null;
      const topOver = usual?.rows.filter(row => row.currentCents > row.usualCents).sort((a, b) => (b.currentCents - b.usualCents) - (a.currentCents - a.usualCents))[0];
      const isPast = activeMonth(state) < state.demoDate.slice(0, 7);
      const paceMessage = isPast
        ? jar.overCents
          ? `You went ${euros(jar.overCents)} over ${month.format(utc(jar.period.start))}'s limit. The card shows your full pace details.`
          : `${month.format(utc(jar.period.start))} finished at ${euros(jar.dailySpentCents)} a day. The card shows your full pace details.`
        : jar.overCents
          ? `You're already ${euros(jar.overCents)} over this month's limit. The card shows your full pace details.`
          : jar.daysLeft
            ? `That's ${euros(jar.dailyRemainingCents)} a day for the ${jar.daysLeft} days left to stay inside your limit. The card shows your full pace details.`
            : `This month is complete at ${euros(jar.dailySpentCents)} a day. The card shows your full pace details.`;
      const usualMessage = isPast
        ? `${topOver ? `${topOver.category}: ${euros(topOver.currentCents)} in ${month.format(utc(jar.period.start))}. ` : "No category was above its usual month. "}The full comparison is on screen. Your usual month averages the previous 6 complete months.`
        : `${topOver ? `${topOver.category}: ${euros(topOver.currentCents)} so far. ` : "No category is above its usual full month yet. "}The full comparison is on screen. Your usual month averages the previous 6 complete months.`;
      return { ...state, message: mode === "pace" ? paceMessage : mode === "usual" ? usualMessage : jarMessage(state) };
    }
    if (result.kind === "save") {
      state = { ...state, mode: "save", query: null, analysis: null, itemLimitation: false, guessCents: null, percent: null };
      const usual = usualMonth({ rows: dataset.transactions, customerId: state.customerId, referenceDate: state.demoDate, corrections: state.corrections, datasetStart: dataset.period.start });
      const safe = safeToSave(usual);
      const message = safe.safeToSaveCents > 0
        ? `A usual month leaves ${euros(safe.safeToSaveCents)} to save after your three baskets.`
        : "A usual month leaves nothing to save yet. Look at your everyday spending first.";
      return { ...state, message };
    }
    if (result.kind === "spend_week") {
      state = { ...state, mode: "spend_week", query: null, analysis: null, itemLimitation: false, guessCents: null, percent: null };
      const jar = calculateJar(checkupInput(state));
      const spendWeek = safeToSpendWeek(jar, state.demoDate);
      const message = spendWeek.amountCents > 0
        ? `You have ${euros(spendWeek.amountCents)} safe to spend this week and stay inside your jar.`
        : "Nothing is safe to spend this week. The jar is full.";
      return { ...state, message };
    }
    if (result.kind === "goal") {
      if (result.goal) {
        state = { ...state, mode: "goal", proposedGoal: result.goal, query: null, analysis: null, itemLimitation: false, guessCents: null, percent: null };
        const usual = usualMonth({ rows: dataset.transactions, customerId: state.customerId, referenceDate: state.demoDate, corrections: state.corrections, datasetStart: dataset.period.start });
        const verdict = goalVerdict(result.goal, usual, state.demoDate);
        let message: string;
        if (verdict.verdict === "on_track") {
          message = `On track: your usual month already leaves room for ${euros(verdict.monthlyCents)} a month.`;
        } else if (verdict.verdict === "stretch") {
          message = `Possible, but a stretch: it needs ${euros(verdict.cutCents)} less everyday spending a month, and you managed that in ${verdict.monthsInside} of the last 6 months.`;
        } else {
          message = "Out of reach by that month; try a smaller amount or a later month.";
        }
        return { ...state, message };
      }
      if (clearGoalRequest.test(request.text) && !refusal.test(request.text) && !asking.test(request.text)) {
        return transition(state, { action: "clear-goal", revision: request.revision, confirmed: true });
      }
      if (/remove|clear|delete|drop/i.test(request.text)) {
        return { ...state, mode: "none", query: null, analysis: null, itemLimitation: false, guessCents: null, percent: null,
          message: "Say “remove my goal” and I will do it." };
      }
      return { ...state, mode: "none", query: null, analysis: null, itemLimitation: false, guessCents: null, percent: null,
        message: "How much do you want to save, and by which month?" };
    }
    if (result.kind === "move") {
      const criteria = result.correction;
      const quote = criteria?.necessityQuote.toLowerCase() ?? "";
      const stated = criteria && request.text.toLowerCase().includes(quote) && necessityStatement.test(quote)
        && !refusal.test(request.text) && !asking.test(request.text);
      const amount = criteria?.amountCents;
      const suppliedAmount = !amount || quantities(request.text).some(value =>
        value === `money:${amount}` || value === `number:${amount / 100}`);
      const named = (value: string | null | undefined) => !value || request.text.toLowerCase().includes(value.toLowerCase());
      const matches = stated && suppliedAmount && named(criteria.date) && named(criteria.merchant) && named(criteria.category)
        && (criteria.amountCents || criteria.date || criteria.merchant || criteria.category)
        ? currentEvidence(state).filter(row => (criteria.amountCents === null || row.amountCents === criteria.amountCents)
          && (criteria.date === null || row.date === criteria.date) && (criteria.merchant === null || row.merchant === criteria.merchant)
          && (criteria.category === null || row.category === criteria.category)) : [];
      if (matches.length !== 1) return { ...state, message: "Which payment do you mean? Tell me its amount and date from the payments shown." };
      const row = matches[0];
      if (row.basket === "unexpected") return { ...state, message: "That payment is already in Unexpected. It doesn't count against your everyday limit." };
      state.corrections[row.id] = "unexpected";
      state = { ...state, mode: "jar", query: null, analysis: null, itemLimitation: false, percent: null,
        move: { transactionId: row.id, amountCents: row.amountCents, from: row.basket, to: "unexpected" } };
      return { ...state, message: `${euros(row.amountCents)} moved to Unexpected. The payment amount hasn't changed. Your updated jar is on screen.` };
    }
    if (analysisKindSchema.safeParse(result.kind).success) {
      const query = result.kind === "profile" ? recentCompleteQuery(state.demoDate, dataset.period.start, 1) : result.query;
      const operation = analysisOperationSchema.parse({ kind: result.kind, query, comparePeriod: result.comparePeriod, by: result.by, top: result.top, percent: result.percent });
      state = { ...state, mode: "analysis", query, analysis: operation, itemLimitation: result.reply === "items", guessCents: null, percent: null };
      return { ...state, message: analysisSummary(analysis(state)) };
    }
    if (result.kind === "spending" && result.query) {
      calculateSpending(dataset.transactions, state.customerId, result.query, state.corrections, state.demoDate);
      state = { ...state, query: result.query, analysis: null, itemLimitation: result.reply === "items", guessCents: null, percent: null };
      return reveal({ ...state, skipGuess: true }, null);
    }
    if (result.kind === "reveal" && state.mode === "invitation") return reveal({ ...state, skipGuess: true }, null);
    if (result.kind === "scenario" && result.percent !== null) return scenario(state, result.percent);
    if (result.kind === "checkin" || result.kind === "habit") return { ...state, message: "We can explore any question, or you can choose “Let's do my check-up”." };
    // The model plans, then writes from application-calculated facts. Only a
    // verified reply reaches text/speech; these sentences are its safe fallback.
    const message = result.kind === "explain" && result.concept ? concepts[result.concept] : result.kind === "chat"
      ? result.reply === "tired" ? "Oof, sounds like a long day. Want to tell me what made it tough? We can skip the money talk."
        : result.reply === "positive" ? "Love hearing that! What was the best bit of your day?"
          : "I'm all ears. What's on your mind? We don't have to talk money."
      : result.reply === "scope" ? "I can explore your own spending and everyday limit. I can't access other customers, move money or compare you with peers. Want to look at your jar instead?"
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
    const row = currentEvidence(state).find(row => row.id === request.transactionId);
    if (!row) throw new AppError("Choose a transaction in the revealed evidence.");
    state.corrections[request.transactionId] = request.basket;
    return { ...state, percent: null, move: { transactionId: row.id, amountCents: row.amountCents, from: row.basket, to: request.basket },
      message: `Got it, that's ${basketLabels[request.basket]} now. You know your life best! The amount stays the same; only the basket changes.` };
  }
  if (request.action === "scenario") return scenario(state, request.percent);
  if (request.action === "weekly-checkup") {
    const result = completeWeeklyCheckup(state.weeklyCompletedDates, state.demoDate);
    return { ...state, mode: "jar", query: null, analysis: null, itemLimitation: false,
      weeklyCompletedDates: result.completedDates,
      message: `${result.streak} weeks in a row — that's showing up for yourself. ${jarMessage(state)}` };
  }
  if (request.action === "next-week") {
    let date = state.demoDate;
    for (let day = 0; day < 7; day++) date = nextDate(date);
    if (date > dataset.period.end) throw new AppError("You've reached the last available week.");
    state = { ...state, demoDate: date, mode: "jar", query: null, analysis: null, itemLimitation: false, move: null, jarMonth: null };
    return { ...state, message: jarMessage(state, true) };
  }
  if (request.action === "undo-move") {
    if (!state.move || state.corrections[state.move.transactionId] !== state.move.to) throw new AppError("There is no basket move to undo.");
    state.corrections[state.move.transactionId] = state.move.from;
    state = { ...state, mode: "jar", query: null, analysis: null, itemLimitation: false, move: null };
    return { ...state, message: `Basket move undone. ${jarMessage(state)}` };
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
  if (request.action === "set-goal") {
    const currentYear = Number(state.demoDate.slice(0, 4));
    const currentMon = Number(state.demoDate.slice(5, 7));
    const targetYear = Number(request.goal.targetMonth.slice(0, 4));
    const targetMon = Number(request.goal.targetMonth.slice(5, 7));
    const months = (targetYear - currentYear) * 12 + (targetMon - currentMon);
    if (!Number.isInteger(request.goal.amountCents) || request.goal.amountCents <= 0 || request.goal.amountCents > 100_000_000 || targetMon < 1 || targetMon > 12 || months <= 0 || months > 60) {
      throw new AppError("Choose a future target month within 5 years and a valid amount.");
    }
    const usual = usualMonth({ rows: dataset.transactions, customerId: state.customerId, referenceDate: state.demoDate, corrections: state.corrections, datasetStart: dataset.period.start });
    const verdict = goalVerdict(request.goal, usual, state.demoDate);
    if (verdict.verdict === "out_of_reach") {
      throw new AppError("That goal is out of reach. Try a smaller amount or a later month.");
    }
    state = { ...state, goal: request.goal, proposedGoal: null, mode: "jar", query: null, analysis: null, itemLimitation: false, guessCents: null, percent: null };
    return { ...state, message: `Your goal is set. The jar limit is now ${euros(verdict.neededJarCents)} a month.` };
  }
  if (request.action === "clear-goal") {
    if (!state.goal) throw new AppError("There is no goal to remove.");
    delete state.goal;
    state = { ...state, proposedGoal: null, mode: "jar", query: null, analysis: null, itemLimitation: false, guessCents: null, percent: null };
    return { ...state, message: `Goal removed. The jar limit is back to ${euros(state.profile.everydayLimit.amountCents)} a month.` };
  }
  return state;
}

export function toView(state: SessionState): CoachView {
  let activity: Activity = { kind: "none" };
  const jar = calculateJar(checkupInput(state));
  if (state.mode === "jar" || state.mode === "pace" || state.mode === "overspend" || state.mode === "spend_week") activity = { kind: state.mode };
  if (state.mode === "save") {
    const usual = usualMonth({ rows: dataset.transactions, customerId: state.customerId, referenceDate: state.demoDate, corrections: state.corrections, datasetStart: dataset.period.start });
    activity = { kind: "save", save: safeToSave(usual) };
  }
  if (state.mode === "goal") {
    const targetGoal = state.proposedGoal ?? state.goal;
    if (targetGoal) {
      const usual = usualMonth({ rows: dataset.transactions, customerId: state.customerId, referenceDate: state.demoDate, corrections: state.corrections, datasetStart: dataset.period.start });
      activity = { kind: "goal", verdict: goalVerdict(targetGoal, usual, state.demoDate) };
    }
  }
  if (state.mode === "usual") activity = { kind: "usual", comparison: calculateUsualComparison(checkupInput(state)) };
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

  let noticedRow: Noticed | null = null;
  if (activity.kind === "save") {
    noticedRow = noticed({ place: "save", safe: activity.save });
  } else if (activity.kind === "goal") {
    noticedRow = noticed({ place: "goal", verdict: activity.verdict, comparison: calculateUsualComparison(checkupInput(state)) });
  } else if (activity.kind === "jar" || activity.kind === "spend_week") {
    noticedRow = noticed({ place: "jar", jar, goal: state.goal ?? null });
  } else if (activity.kind === "analysis" && activity.analysis.kind === "profile") {
    const usual = usualMonth({ rows: dataset.transactions, customerId: state.customerId, referenceDate: state.demoDate, corrections: state.corrections, datasetStart: dataset.period.start });
    noticedRow = noticed({ place: "spender", usual });
  }

  const entryNoticed = noticed({
    place: "entry",
    rows: dataset.transactions,
    customerId: state.customerId,
    referenceDate: state.demoDate,
    corrections: state.corrections,
    datasetStart: dataset.period.start,
  });

  const checkup = weeklyCheckup(state.weeklyCompletedDates, state.demoDate);
  const streakCount = Math.min(checkup.streak, 4);
  const recentCompleted = streakCount > 0 ? checkup.completedDates.slice(-streakCount) : [];
  const streakJars = recentCompleted.map(date => ({
    date,
    leftCents: calculateJar({ ...checkupInput(state), referenceDate: date, jarMonth: null }).leftCents,
  }));

  return viewSchema.parse({ revision: state.revision, demoDate: state.demoDate, message: state.message, activity,
    entryMessage: jar.overCents ? jarMessage(state, true) : "A little check-up, or something on your mind? I'm here for both.",
    profile: state.profile, checkup, streakJars, jar, move: state.move,
    goal: state.goal ?? null, noticed: noticedRow, entryNoticed,
    spendWeek: safeToSpendWeek(jar, state.demoDate),
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
    if (request.text === changeGoalText) {
      interpretation = { ...scopePlan, kind: "goal", goal: null, reply: "none" };
    } else {
      await consumeBudget(id, "reasoning", new Date(), 3);
      interpretation = await interpret(request.text, { categories, ...dataset.period, referenceDate: state.demoDate, previousQuery: state.query, selectedMonth: activeMonth(state) }, deadline);
    }
  }
  let next = transition(state, request, interpretation);
  const skipCompose = interpretation && (
    ["checkin", "habit", "scenario", "weekly_checkup", "move"].includes(interpretation.kind) ||
    (interpretation.kind === "goal" && interpretation.goal === null)
  );
  if ((request.action === "ask" && !skipCompose) || request.action === "reveal") {
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
  if (["jar", "pace", "usual", "overspend", "save", "goal", "spend_week"].includes(state.mode)) {
    // These captions include guidance and comparisons, so preserve the entire
    // verified financial clause rather than accepting a bag of valid numbers
    // that could swap "left"/"spent" or "so far"/"usual".
    base.subject = state.mode === "usual" ? "Everyday spending against your usual month"
      : state.mode === "save" ? "Monthly safe to save"
      : state.mode === "spend_week" ? "Weekly safe to spend"
      : state.mode === "goal" ? "Savings goal"
      : "Everyday monthly limit";
    base.period = period(activePeriod(state));
    base.required = [state.message];
    base.notes = [state.message];
    return base;
  }
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
    base.fallback = `The card shows your results ${base.period}, with the payments and calculation details. ${base.required!.join(" ")}`.trim();
  }
  return base;
}
