import { describe, expect, it } from "vitest";
import { verifyReply } from "@/domain/replies";
import { replyFacts, toView, transition } from "@/server/coach";
import { scopePlan, type Interpretation } from "@/server/providers/gemini";
import { initialState, type SessionState } from "@/server/storage/state";

const quote = "The 177,96 € Home & Tech payment on 2026-09-21 at MRC-HMT-0049 was necessary.";
const movePlan: Interpretation = { ...scopePlan, kind: "move", reply: "none", correction: {
  amountCents: 17796, date: "2026-09-21", merchant: "MRC-HMT-0049", category: "Home & Tech", necessityQuote: quote,
} };

function ask(state: SessionState, text: string, plan: Interpretation): SessionState {
  return transition(state, { action: "ask", revision: state.revision, text }, plan);
}

function nextWeek(): SessionState {
  return transition(initialState(), { action: "next-week", revision: 0 });
}

describe("weekly coordinator contract", () => {
  it.each(["jar", "pace", "usual", "overspend"] as const)("explores %s without awarding weekly credit", kind => {
    const before = initialState();
    const state = ask(before, "Show my spending", { ...scopePlan, kind });
    const view = toView(state);
    expect(view.activity.kind).toBe(kind);
    expect(view.demoDate).toBe("2026-09-16");
    expect(view.jar).toMatchObject({ spentCents: 128771, leftCents: 91229, daysLeft: 14 });
    expect(view.checkup).toMatchObject({ due: true, completed: false, streak: 2,
      completedDates: ["2026-09-02", "2026-09-09"] });
    expect(state.weeklyCompletedDates).toEqual(before.weeklyCompletedDates);
    expect(state.completedDates).toEqual([]);
    expect(before).toEqual(initialState());
    if (view.activity.kind === "usual") {
      expect(view.activity.comparison).toMatchObject({ baseline: { start: "2026-03-01", end: "2026-08-31" }, monthCount: 6 });
      expect(view.activity.comparison.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ category: "Home & Tech", currentCents: 28165, usualCents: 18677 }),
        expect.objectContaining({ category: "Restaurants", currentCents: 20370, usualCents: 18891 }),
      ]));
    }
  });

  it("completes explicitly once, advances to September 23 without credit, and then completes the fourth week", () => {
    const first = transition(initialState(), { action: "weekly-checkup", revision: 0 });
    expect(toView(first).checkup).toMatchObject({ completed: true, due: false, streak: 3,
      completedDates: ["2026-09-02", "2026-09-09", "2026-09-16"] });
    const repeated = transition(first, { action: "weekly-checkup", revision: 0 });
    expect(repeated.weeklyCompletedDates).toEqual(first.weeklyCompletedDates);
    expect(toView(repeated).checkup.streak).toBe(3);
    const next = transition(repeated, { action: "next-week", revision: 0 });
    expect(toView(next)).toMatchObject({ demoDate: "2026-09-23", jar: { spentCents: 232720, overCents: 12720 },
      checkup: { due: true, completed: false, streak: 3, completedDates: first.weeklyCompletedDates } });
    expect(toView(transition(next, { action: "weekly-checkup", revision: 0 })).checkup)
      .toMatchObject({ completed: true, due: false, streak: 4,
        completedDates: ["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23"] });
    expect(next.completedDates).toEqual([]);
    expect(toView(nextWeek()).checkup).toMatchObject({ due: true, completed: false, streak: 0,
      completedDates: ["2026-09-02", "2026-09-09"] });
  });

  it("accepts an explicit spoken check-up request", () => {
    const completed = ask(initialState(), "Let's do my check-up", { ...scopePlan, kind: "weekly_checkup" });
    expect(toView(completed).checkup).toMatchObject({ completed: true, due: false, streak: 3 });
  });

  it.each(["What is a weekly check-up?", "Don't complete my check-up.", "If I complete my check-up, what happens?"])
    ("does not turn a question or refusal into completion: %s", text => {
      const before = initialState();
      const after = ask(before, text, { ...scopePlan, kind: "weekly_checkup" });
      expect(after.weeklyCompletedDates).toEqual(before.weeklyCompletedDates);
      expect(toView(after).checkup).toMatchObject({ completed: false, due: true, streak: 2 });
    });
});

describe("evidence-bound necessity moves", () => {
  it("moves exactly the stated payment, keeps it visible for undo, and restores 232720 cents", () => {
    const original = nextWeek();
    const changed = ask(original, quote, movePlan);
    const view = toView(changed);
    expect(view.jar).toMatchObject({ spentCents: 214924, leftCents: 5076, overCents: 0 });
    expect(view.move).toEqual({ transactionId: "row-2898396", amountCents: 17796, from: "everyday", to: "unexpected" });
    expect(changed.corrections).toEqual({ "row-2898396": "unexpected" });
    expect(view.jar.evidence.find(row => row.sourceRow === 2898396)).toMatchObject({
      date: "2026-09-21", merchant: "MRC-HMT-0049", amountCents: 17796, basket: "unexpected" });
    expect(view.jar.evidence.map(({ id, amountCents }) => ({ id, amountCents })))
      .toEqual(toView(original).jar.evidence.map(({ id, amountCents }) => ({ id, amountCents })));
    const duplicate = ask(changed, quote, movePlan);
    expect(duplicate.corrections).toEqual(changed.corrections);
    expect(toView(duplicate).jar.spentCents).toBe(214924);
    const undone = transition(duplicate, { action: "undo-move", revision: 0 });
    expect(toView(undone)).toMatchObject({ move: null, jar: { spentCents: 232720, leftCents: 0, overCents: 12720 } });
    expect(toView(undone).jar.evidence.find(row => row.sourceRow === 2898396))
      .toMatchObject({ amountCents: 17796, basket: "everyday" });
    expect(undone.weeklyCompletedDates).toEqual(original.weeklyCompletedDates);
    expect(original.corrections).toEqual({});
    expect(() => transition(undone, { action: "undo-move", revision: 0 })).toThrow();
  });

  it.each([
    { label: "a quote not in the request", text: "Please move the 177,96 € payment.", correction: movePlan.correction },
    { label: "an amount not stated by the user", text: "The 178,96 € payment was necessary.",
      correction: { ...movePlan.correction!, necessityQuote: "The 178,96 € payment was necessary." } },
    { label: "an unknown amount", text: "The 177,97 € payment was necessary.",
      correction: { ...movePlan.correction!, amountCents: 17797, necessityQuote: "The 177,97 € payment was necessary." } },
    { label: "ambiguous category-only criteria", text: "My Home & Tech payment was necessary.",
      correction: { amountCents: null, date: null, merchant: null, category: "Home & Tech", necessityQuote: "My Home & Tech payment was necessary." } },
    { label: "no identifying criteria", text: "It was necessary.",
      correction: { amountCents: null, date: null, merchant: null, category: null, necessityQuote: "It was necessary." } },
    { label: "a mismatched date", text: quote, correction: { ...movePlan.correction!, date: "2026-09-20" } },
    { label: "a mismatched merchant", text: quote, correction: { ...movePlan.correction!, merchant: "MRC-UNKNOWN" } },
    { label: "a mismatched category", text: quote, correction: { ...movePlan.correction!, category: "Groceries" } },
    { label: "a full negated necessity quote", text: "The 177,96 € payment was not necessary.",
      correction: { ...movePlan.correction!, necessityQuote: "The 177,96 € payment was not necessary." } },
    { label: "a necessity substring extracted from a negation", text: "The 177,96 € payment was not necessary.",
      correction: { ...movePlan.correction!, necessityQuote: "necessary" } },
    { label: "a hypothetical necessity", text: "If the 177,96 € payment were necessary, could you move it?",
      correction: { ...movePlan.correction!, necessityQuote: "If the 177,96 € payment were necessary, could you move it?" } },
    { label: "a quoted example rather than a correction", text: `Example only: "${quote}"`,
      correction: { ...movePlan.correction!, necessityQuote: quote } },
  ])("does not mutate for $label", ({ text, correction }) => {
    const original = nextWeek();
    const state = ask(original, text, { ...movePlan, correction });
    expect(state.corrections).toEqual(original.corrections);
    expect(state.move).toEqual(original.move);
    expect(state.weeklyCompletedDates).toEqual(original.weeklyCompletedDates);
    expect(toView(state).jar.spentCents).toBe(232720);
  });

  it("limits corrections to current visible evidence, not the jar always present on every view", () => {
    const future = ask(initialState(), "Show my jar", { ...scopePlan, kind: "jar" });
    expect(toView(future).jar.evidence.some(row => row.id === "row-2898396")).toBe(false);
    expect(ask(future, quote, movePlan).corrections).toEqual({});
    expect(() => transition(future, { action: "correct", revision: 0, transactionId: "row-2898396", basket: "unexpected", confirmed: true })).toThrow();

    const noActivity = { ...nextWeek(), mode: "none" as const };
    expect(toView(noActivity).jar.evidence.some(row => row.id === "row-2898396")).toBe(true);
    expect(ask(noActivity, quote, movePlan).corrections).toEqual({});
    const shown = ask(noActivity, "Show my jar", { ...scopePlan, kind: "jar" });
    expect(ask(shown, quote, movePlan).corrections).toEqual({ "row-2898396": "unexpected" });

    const august = ask(nextWeek(), "Show August", { ...scopePlan, kind: "spending", direct: true,
      query: { start: "2026-08-01", end: "2026-08-31", categories: [], baskets: [], merchantType: null } });
    expect(ask(august, quote, movePlan).corrections).toEqual({});
    expect(() => transition(nextWeek(), { action: "correct", revision: 0, transactionId: "row-2898292", basket: "unexpected", confirmed: true })).toThrow();
    expect(() => transition({ ...nextWeek(), customerId: "OTHER" }, { action: "ask", revision: 0, text: quote }, movePlan)).toThrow();
  });

  it("does not offer a corrected Unexpected payment as current Everyday usual-comparison evidence", () => {
    const corrected = ask(nextWeek(), quote, movePlan);
    const usual = ask(corrected, "Compare with usual", { ...scopePlan, kind: "usual" });
    const view = toView(usual);
    expect(view.activity.kind).toBe("usual");
    if (view.activity.kind !== "usual") throw new Error("Expected usual comparison");
    expect(view.activity.comparison.evidence.some(row => row.id === "row-2898396")).toBe(false);
    expect(view.jar.evidence.find(row => row.id === "row-2898396")?.basket).toBe("unexpected");
    expect(() => transition(usual, { action: "correct", revision: 0, transactionId: "row-2898396", basket: "everyday", confirmed: true })).toThrow();
  });
});

describe("financial reply clauses", () => {
  it.each(["jar", "pace", "usual", "overspend"] as const)("requires intact %s facts and rejects unsupported additions", kind => {
    const state = ask(kind === "overspend" ? nextWeek() : initialState(), "Show my results", { ...scopePlan, kind });
    const facts = replyFacts(state);
    expect(facts.required).toHaveLength(1);
    expect(facts.required?.[0]).toBe(state.message);
    expect(verifyReply(facts.fallback, facts)).toBe(true);
    expect(verifyReply(`${facts.fallback} You've got this.`, facts)).toBe(true);
    expect(verifyReply("You've got this.", facts)).toBe(false);
    expect(verifyReply(`${facts.fallback} ${facts.fallback}`, facts)).toBe(false);
    for (const claim of ["You can safely spend the rest.", "You have saved money.", "Your balance is healthy.", "This proves you are frugal.", "You spent 999 euros."]) {
      expect(verifyReply(`${facts.fallback} ${claim}`, facts), claim).toBe(false);
    }
    expect(JSON.stringify(facts)).not.toMatch(/sourceRow|customerId|row-289|MRC-/);
  });

  it("rejects swapped financial meanings even when all original quantities are retained", () => {
    const jar = replyFacts(ask(initialState(), "Show my jar", { ...scopePlan, kind: "jar" }));
    const spentInsteadOfLeft = jar.fallback.replace(/left in/, "spent in");
    expect(spentInsteadOfLeft).not.toBe(jar.fallback);
    expect(verifyReply(spentInsteadOfLeft, jar)).toBe(false);
    const pace = replyFacts(ask(initialState(), "How is my pace?", { ...scopePlan, kind: "pace" }));
    const swappedPace = pace.fallback.replace("80,48", "SWAP").replace("65,16", "80,48").replace("SWAP", "65,16");
    expect(swappedPace).not.toBe(pace.fallback);
    expect(verifyReply(swappedPace, pace)).toBe(false);
    const usual = replyFacts(ask(initialState(), "Compare with usual", { ...scopePlan, kind: "usual" }));
    const swappedUsual = usual.fallback.replace("281,65", "SWAP").replace("186,77", "281,65").replace("SWAP", "186,77");
    expect(swappedUsual).not.toBe(usual.fallback);
    expect(verifyReply(swappedUsual, usual)).toBe(false);
  });
});
