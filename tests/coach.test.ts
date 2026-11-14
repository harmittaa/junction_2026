import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { transition, toView } from "@/server/coach";
import { changeGoalText } from "@/domain/replies";
import { euros } from "@/domain/spending";
import { dataset } from "@/server/data";
import { initialState } from "@/server/storage/state";
import { type Interpretation, interpret } from "@/server/providers/gemini";
import { signSession, verifySession } from "@/server/session";
import { type Analysis } from "@/shared/contracts";

const query = { categories: ["Groceries"], baskets: [], merchantType: null, start: "2026-08-01", end: "2026-08-31" };
const operation: Interpretation = { kind: "spending", query, direct: false, percent: null, reply: "none", comparePeriod: null, by: null, top: null, concept: null };
const ask = { action: "ask", text: "Groceries last month?", revision: 0 } as const;
function analysisOf(state: ReturnType<typeof transition>): Analysis {
  const view = toView(state);
  if (view.activity.kind !== "analysis") throw new Error("Expected an analysis");
  return view.activity.analysis;
}
// Basket label -> [payment count, amount in cents], from the calculated basket shares.
function sharesOf(analysis: Analysis) {
  return Object.fromEntries(analysis.sections[0].rows.map(row => [row.label, [row.count, row.amountCents]]));
}
describe("coordinator boundaries", () => {
  it("reflects on a merchant note without calculating an unrelated total or changing saved state", () => {
    const state = transition(initialState(), ask, { ...operation, kind: "profile", query: null });
    const next = transition(state, { ...ask, text: "Still worth it to you?" }, operation);
    expect(next).toEqual({ ...state, message: "What did you value about those payments? You can decide whether they still fit your priorities." });
    expect(toView(next).merchantNoticed?.merchantId).toBe("MRC-ENT-0052");
  });
  it("answers directly with calculated amounts and evidence, distinguishing empty matches", () => {
    const revealed = toView(transition(initialState(), ask, operation));
    expect(revealed.activity.kind).toBe("reveal");
    if (revealed.activity.kind === "reveal") {
      expect(revealed.activity.spending.totalCents).toBe(111106);
      expect(revealed.activity.spending.evidenceCount).toBe(16);
      expect(revealed.activity.guessCents).toBeNull();
    }
    expect(revealed.message).toMatch(/1\s111,06\s€ on groceries in August 2026, across 16 payments/);
    const empty = toView(transition(initialState(), ask, { ...operation, direct: true,
      query: { ...query, categories: ["Health"], start: "2026-08-01", end: "2026-08-09" } }));
    expect(empty.message).toContain("no health spending in your records from 1 August 2026 to 9 August 2026");
    expect(empty.message).toContain("outside this dataset wouldn't show up");
  });
  it("answers without a game regardless of the old direct flag and permits topic changes", () => {
    const direct = transition(initialState(), ask, { ...operation, direct: true });
    expect(toView(direct).activity.kind).toBe("reveal");
    const pending = transition(initialState(), ask, operation);
    expect(toView(pending).activity.kind).toBe("reveal");
    expect(toView(transition(pending, ask, operation)).activity.kind).toBe("reveal");
    const chat = transition(pending, ask, { ...operation, kind: "chat", query: null, reply: "tired" });
    expect(toView(chat).activity.kind).toBe("none");
    expect(chat.completedDates).toEqual([]);
    expect(chat.habit).toBeNull();
    expect(() => transition(chat, { action: "reveal", revision: 0, guessCents: null })).toThrow();
  });
  it("only corrects revealed evidence and recalculates the everyday scenario without changing history", () => {
    const hidden = initialState();
    const correct = { action: "correct", revision: 0, transactionId: "row-2898292", basket: "regular", confirmed: true } as const;
    expect(() => transition(hidden, correct)).toThrow("revealed evidence");
    expect(() => transition(hidden, { action: "scenario", revision: 0, percent: 20 })).toThrow("Reveal");
    const revealed = transition(hidden, ask, operation);
    expect(() => transition(revealed, { ...correct, transactionId: "row-2898357" })).toThrow("revealed evidence");
    const changed = transition(revealed, correct);
    const result = toView(transition(changed, { action: "scenario", revision: 0, percent: 20 }));
    if (result.activity.kind !== "reveal") throw new Error("Expected reveal");
    expect(result.activity.spending.totalCents).toBe(111106);
    expect(result.activity.scenario).toEqual({ percent: 20, baseCents: 103116, reductionCents: 20623, remainingCents: 82493 });
    expect(result.message).toContain("hypothetical");
    expect(changed.habit).toBeNull();
    expect(changed.completedDates).toEqual([]);
  });
  it("lists every selected-month profile payment, reconciled to source rows, and keeps other analysis bounded", () => {
    const profileState = transition(initialState(), ask, { ...operation, kind: "profile", query: null });
    const profile = analysisOf(profileState);
    const sourcePayments = dataset.transactions.filter(row => row.customerId === dataset.customerId && row.date.startsWith("2026-08")
      && row.amountCents < 0 && ["purchase", "housing_payment", "utilities_payment"].includes(row.transactionType));
    expect(sourcePayments).toHaveLength(59);
    expect(profile.query).toMatchObject({ start: "2026-08-01", end: "2026-08-31" });
    expect(profile.evidenceCount).toBe(59);
    expect(profile.evidence).toHaveLength(59);
    expect(profile.evidence.reduce((sum, row) => sum + row.amountCents, 0)).toBe(444878);
    const source = new Map(sourcePayments.map(row => [row.id, row]));
    expect(new Set(profile.evidence.map(row => row.id))).toEqual(new Set(source.keys()));
    for (const row of profile.evidence) {
      expect(source.get(row.id)).toMatchObject({ sourceRow: row.sourceRow, date: row.date, amountCents: -row.amountCents });
    }
    const original = sharesOf(profile);
    expect(original).toEqual({ "Regular essentials": [4, 98719], "Unexpected necessities": [3, 12507], "Everyday spending": [52, 333652] });
    expect(profile.evidence.filter(row => row.basket === "everyday")).toHaveLength(52);

    // A payment past the old 40-row cap is still correctable, and the full total stays put.
    const late = profile.evidence.slice(40).find(row => row.basket === "everyday");
    if (!late) throw new Error("Expected a late everyday payment");
    const corrected = transition(profileState, { action: "correct", revision: 0, transactionId: late.id, basket: "regular", confirmed: true });
    const moved = analysisOf(corrected);
    expect(moved.evidence.find(row => row.id === late.id)).toMatchObject({ basket: "regular", amountCents: late.amountCents });
    expect(moved.evidenceCount).toBe(59);
    expect(sharesOf(moved)).toEqual({ "Regular essentials": [5, 98719 + late.amountCents], "Unexpected necessities": [3, 12507],
      "Everyday spending": [51, 333652 - late.amountCents] });
    const undone = transition(corrected, { action: "undo-move", revision: 0 });
    expect(sharesOf(analysisOf(transition(undone, ask, { ...operation, kind: "profile", query: null })))).toEqual(original);

    // Other analysis cards keep the 40-row response bound.
    const trend = analysisOf(transition(initialState(), ask, { ...operation, kind: "trend",
      query: { categories: [], baskets: [], merchantType: null, start: "2026-01-01", end: "2026-08-31" } }));
    expect(trend.evidenceCount).toBeGreaterThan(40);
    expect(trend.evidence).toHaveLength(40);
  });
  it("formats every coach reply template with at most one euro amount", () => {
    const euroCount = (text: string) => (text.match(/€/g) ?? []).length;
    const revealedSkip = transition(initialState(), ask, operation);
    expect(euroCount(revealedSkip.message)).toBeLessThanOrEqual(1);

    const invitation = { ...initialState(), mode: "invitation" as const, query };
    const revealedClose = transition(invitation, { action: "reveal", revision: 0, guessCents: 110000 });
    expect(euroCount(revealedClose.message)).toBeLessThanOrEqual(1);
    const revealedLow = transition(invitation, { action: "reveal", revision: 0, guessCents: 50000 });
    expect(euroCount(revealedLow.message)).toBeLessThanOrEqual(1);
    const revealedHigh = transition(invitation, { action: "reveal", revision: 0, guessCents: 200000 });
    expect(euroCount(revealedHigh.message)).toBeLessThanOrEqual(1);

    const scen = transition(revealedSkip, { action: "scenario", revision: 0, percent: 20 });
    expect(euroCount(scen.message)).toBeLessThanOrEqual(1);

    const jarState = transition(initialState(), ask, { ...operation, kind: "jar", query: null });
    expect(euroCount(jarState.message)).toBeLessThanOrEqual(1);

    const paceState = transition(initialState(), ask, { ...operation, kind: "pace", query: null });
    expect(euroCount(paceState.message)).toBeLessThanOrEqual(1);

    const usualState = transition(initialState(), ask, { ...operation, kind: "usual", query: null });
    expect(euroCount(usualState.message)).toBeLessThanOrEqual(1);

    const nextWeek = transition(initialState(), { action: "next-week", revision: 0 });
    const overspendState = transition(nextWeek, ask, { ...operation, kind: "overspend", query: null });
    expect(euroCount(overspendState.message)).toBeLessThanOrEqual(1);

    const quote = "The 177,96 € Home & Tech payment on 2026-09-21 at MRC-HMT-0049 was necessary.";
    const movePlan: Interpretation = {
      ...operation, kind: "move", reply: "none",
      correction: { amountCents: 17796, date: "2026-09-21", merchant: "MRC-HMT-0049", category: "Home & Tech", necessityQuote: quote },
    };
    const moved = transition(nextWeek, { action: "ask", revision: 0, text: quote }, movePlan);
    expect(euroCount(moved.message)).toBeLessThanOrEqual(1);

    const weeklyCheckup = transition(initialState(), { action: "weekly-checkup", revision: 0 });
    expect(euroCount(weeklyCheckup.message)).toBeLessThanOrEqual(1);

    const undone = transition(moved, { action: "undo-move", revision: 0 });
    expect(euroCount(undone.message)).toBeLessThanOrEqual(1);

    const breakdown = transition(initialState(), ask, { ...operation, kind: "breakdown", by: "category", top: 5 });
    expect(euroCount(breakdown.message)).toBeLessThanOrEqual(1);

    const comparison = transition(initialState(), ask, { ...operation, kind: "comparison", comparePeriod: { start: "2026-07-01", end: "2026-07-31" } });
    expect(euroCount(comparison.message)).toBeLessThanOrEqual(1);

    const trend = transition(initialState(), ask, { ...operation, kind: "trend", query: { ...query, start: "2026-06-01", end: "2026-08-31" } });
    expect(euroCount(trend.message)).toBeLessThanOrEqual(1);

    const cashflow = transition(initialState(), ask, { ...operation, kind: "cashflow", query: { ...query, categories: [] } });
    expect(euroCount(cashflow.message)).toBeLessThanOrEqual(1);

    const whatif = transition(initialState(), ask, { ...operation, kind: "whatif", percent: 20 });
    expect(euroCount(whatif.message)).toBeLessThanOrEqual(1);

    const profile = transition(initialState(), ask, { ...operation, kind: "profile", query: null });
    expect(euroCount(profile.message)).toBeLessThanOrEqual(1);

    const saveState = transition(initialState(), ask, { ...operation, kind: "save", query: null });
    expect(euroCount(saveState.message)).toBeLessThanOrEqual(1);

    const spendWeekState = transition(initialState(), ask, { ...operation, kind: "spend_week", query: null });
    expect(euroCount(spendWeekState.message)).toBeLessThanOrEqual(1);

    const goalState = transition(initialState(), ask, { ...operation, kind: "goal", query: null, goal: { amountCents: 150000, targetMonth: "2027-03" } });
    expect(euroCount(goalState.message)).toBeLessThanOrEqual(1);

    const setGoalState = transition(initialState(), { action: "set-goal", revision: 0, goal: { amountCents: 150000, targetMonth: "2027-03" }, confirmed: true });
    expect(euroCount(setGoalState.message)).toBeLessThanOrEqual(1);

    const clearGoalState = transition(setGoalState, { action: "clear-goal", revision: 0, confirmed: true });
    expect(euroCount(clearGoalState.message)).toBeLessThanOrEqual(1);
  });
  it("does not save a model-proposed habit or complete reflection through ordinary text", () => {
    const current = initialState();
    const proposed = transition(current, ask, { ...operation, kind: "habit", query: null });
    expect(proposed.habit).toBeNull();
    expect(proposed.completedDates).toEqual([]);
    expect(proposed.message).not.toContain("100");
    expect(() => transition(current, { action: "complete", revision: 0, reflection: "done", confirmed: true })).toThrow();
  });
  it.each(["chat", "clarify", "spending"])("rejects fabricated %s prose before it can become display or speech text", async kind => {
    const context = { categories: ["Groceries"], start: "2024-10-01", end: "2026-09-30", referenceDate: "2026-09-01", previousQuery: null };
    const fabricated = { ...operation, kind, reply: "You spent 900 euros on taxis and saved 200 euros. Cut taxis to grow your balance." };
    await expect(interpret("Tell me about spending", context, undefined, async () => JSON.stringify(fabricated))).rejects.toThrow("couldn't interpret");
    const valid = await interpret("A long day", context, undefined, async () => JSON.stringify({ ...operation, kind: "chat", query: null, reply: "tired" }));
    const view = toView(transition(initialState(), ask, valid));
    expect(view.message).toContain("long day");
    expect(view.message).not.toMatch(/900|200|taxi|balance|saved/);
    expect(view.activity.kind).toBe("none");
    expect(view.jar.spentCents).toBe(128771);
  });
  it("normalizes malformed, out-of-scope and failed reasoning without trusting model output", async () => {
    const context = { categories: ["Groceries"], start: "2024-10-01", end: "2026-09-30", referenceDate: "2026-09-01", previousQuery: null };
    const future = { ...operation, query: { ...query, end: "2026-09-30" } };
    expect((await interpret("November", context, undefined, async () => JSON.stringify(future))).kind).toBe("clarify");
    await expect(interpret("hello", context, undefined, async () => '{"kind":"complete"}')).rejects.toThrow("saved activity is safe");
    await expect(interpret("hello", context, undefined, async () => { throw new Error("secret provider response"); })).rejects.toThrow("couldn't interpret");
  });
  it("authenticates signed, unexpired session cookies and rejects tampering", () => {
    const id = "12345678-1234-1234-1234-123456789012";
    const token = signSession(id, 1800000001, "test-only-secret");
    expect(verifySession(token, "test-only-secret", 1800000000)).toBe(id);
    expect(verifySession(token, "test-only-secret", 1800000001)).toBeNull();
    expect(verifySession(token.replace("12345678", "12345679"), "test-only-secret", 1800000000)).toBeNull();
  });
  it("reports real SDK HTTP limits and retry hints without leaking provider bodies, headers or input", async () => {
    const context = { categories: ["Groceries"], start: "2024-10-01", end: "2026-09-30", referenceDate: "2026-09-01", previousQuery: null };
    const cases = [
      { status: 429, providerStatus: "RESOURCE_EXHAUSTED", retry: "4160", seconds: 4160, at: undefined },
      { status: 503, providerStatus: "UNAVAILABLE", retry: "Sat, 14 Nov 2026 08:00:00 GMT", seconds: undefined, at: "2026-11-14T08:00:00.000Z" },
      { status: 429, providerStatus: "RESOURCE_EXHAUSTED", retry: "0", seconds: 0, at: undefined },
      { status: 429, providerStatus: "private-provider-body", retry: "private-header", seconds: undefined, at: undefined },
    ];
    let requests = 0;
    const server = createServer((request, response) => {
      request.resume();
      const fixture = cases[requests++];
      response.writeHead(fixture.status, { "Content-Type": "application/json", "Retry-After": fixture.retry, "X-Private": "private-header" });
      response.end(JSON.stringify({ error: { code: fixture.status, status: fixture.providerStatus,
        message: "private-provider-body", details: [{ secret: "fixture-only" }] } }));
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    vi.stubEnv("SPONKY_TEST_GEMINI_URL", `http://127.0.0.1:${address.port}`);
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8180");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "demo-sponky-tests");
    vi.stubEnv("GEMINI_API_KEY", "fixture-only");
    vi.stubEnv("GEMINI_MODEL", "fixture-model");
    vi.stubEnv("GEMINI_THINKING_LEVEL", "minimal");
    vi.stubEnv("ELEVENLABS_API_KEY", "fixture-only");
    vi.stubEnv("SESSION_SECRET", "fixture-only-secret-at-least-32-characters");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const fixture of cases) {
        await expect(interpret("private-user-input", context)).rejects.toMatchObject({ status: 503, retryable: true });
        expect(warn).toHaveBeenLastCalledWith("Reasoning failed", {
          type: "http", elapsedMs: expect.any(Number), status: fixture.status,
          providerStatus: fixture.providerStatus === "private-provider-body" ? undefined : fixture.providerStatus,
          retryAfterSeconds: fixture.seconds, retryAt: fixture.at,
        });
      }
      expect(requests).toBe(cases.length); // No automatic paid retries.
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private-|fixture-only|Groceries/);
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it("cancels a stalled real SDK transport at the deadline or caller interruption without retrying", async () => {
    const context = { categories: ["Groceries"], start: "2024-10-01", end: "2026-09-30", referenceDate: "2026-09-01", previousQuery: null };
    let requests = 0, disconnected = 0;
    const caller = new AbortController();
    const server = createServer((request, response) => {
      requests++;
      request.resume();
      response.on("close", () => disconnected++);
      if (requests === 2) caller.abort();
      // No response: exercise the actual SDK and socket, not an SDK mock.
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    vi.stubEnv("SPONKY_TEST_GEMINI_URL", `http://127.0.0.1:${address.port}`);
    vi.stubEnv("SPONKY_TEST_GEMINI_TIMEOUT_MS", "300");
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8180");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "demo-sponky-tests");
    vi.stubEnv("GEMINI_API_KEY", "fixture-only");
    vi.stubEnv("GEMINI_MODEL", "fixture-model");
    vi.stubEnv("GEMINI_THINKING_LEVEL", "minimal");
    vi.stubEnv("ELEVENLABS_API_KEY", "fixture-only");
    vi.stubEnv("SESSION_SECRET", "fixture-only-secret-at-least-32-characters");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const started = Date.now();
      await expect(interpret("Groceries last month?", context)).rejects.toThrow("saved activity is safe");
      expect(Date.now() - started).toBeLessThan(5000);
      expect(warn).toHaveBeenLastCalledWith("Reasoning failed", expect.objectContaining({ type: "deadline", status: undefined }));
      await expect(interpret("Groceries last month?", context, caller.signal)).rejects.toThrow("saved activity is safe");
      expect(warn).toHaveBeenLastCalledWith("Reasoning failed", expect.objectContaining({ type: "cancelled", status: undefined }));
      await vi.waitFor(() => expect(disconnected).toBe(2));
      expect(requests).toBe(2);
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 5000);

  it("handles save, spend_week, and savings goals with limits and noticed cards", () => {
    const initial = initialState();
    const initialView = toView(initial);
    expect(initialView.spendWeek.amountCents).toBe(26064);
    expect(initialView.entryNoticed?.rule).toBe("balance_lower");

    // Activity kinds
    const saveView = toView(transition(initial, ask, { ...operation, kind: "save", query: null }));
    expect(saveView.activity.kind).toBe("save");
    expect(saveView.noticed?.rule).toBe("invest_over_left");

    const spendWeekView = toView(transition(initial, ask, { ...operation, kind: "spend_week", query: null }));
    expect(spendWeekView.activity.kind).toBe("spend_week");
    expect(spendWeekView.noticed?.rule).toBe("jar_pace");

    const goalPlan: Interpretation = { ...operation, kind: "goal", query: null, goal: { amountCents: 150000, targetMonth: "2027-03" } };
    const askedGoalState = transition(initial, ask, goalPlan);
    expect(askedGoalState.goal).toBeNull();
    expect(askedGoalState.proposedGoal).toEqual({ amountCents: 150000, targetMonth: "2027-03" });

    const goalView = toView(askedGoalState);
    expect(goalView.activity.kind).toBe("goal");
    if (goalView.activity.kind !== "goal") throw new Error("Expected goal");
    expect(goalView.activity.verdict.verdict).toBe("stretch");
    expect(goalView.activity.verdict.monthsInside).toBe(3);
    expect(goalView.activity.verdict.monthlyCents).toBe(25000);
    expect(goalView.noticed?.rule).toBe("largest_category");

    // set-goal
    const setReq = { action: "set-goal", revision: 0, goal: { amountCents: 150000, targetMonth: "2027-03" }, confirmed: true } as const;
    const setGoalState = transition(initial, setReq);
    expect(setGoalState.goal).toEqual({ amountCents: 150000, targetMonth: "2027-03" });
    const setGoalView = toView(setGoalState);
    expect(setGoalView.jar.limitCents).toBe(161419);
    expect(setGoalView.jar.spentCents).toBe(128771);
    expect(setGoalView.spendWeek.amountCents).toBe(9328);
    expect(setGoalView.message).toBe(`Your goal is set. The jar limit is now ${euros(161419)} a month.`);

    // Unreachable goal throws and state stays
    const unreachableReq = { action: "set-goal", revision: 0, goal: { amountCents: 600000, targetMonth: "2027-03" }, confirmed: true } as const;
    expect(() => transition(setGoalState, unreachableReq)).toThrow("That goal is out of reach. Try a smaller amount or a later month.");
    expect(setGoalState.goal).toEqual({ amountCents: 150000, targetMonth: "2027-03" });

    // Past-date goal throws
    expect(() => transition(initial, { action: "set-goal", revision: 0, goal: { amountCents: 150000, targetMonth: "2026-08" }, confirmed: true })).toThrow();
    expect(() => transition(initial, { action: "set-goal", revision: 0, goal: { amountCents: 150000, targetMonth: "2026-09" }, confirmed: true })).toThrow();

    // changeGoalText returns fixed question
    const changeState = transition(setGoalState, { action: "ask", revision: 0, text: changeGoalText }, { ...operation, kind: "goal", query: null, goal: null, reply: "none" });
    expect(changeState.message).toBe("How much do you want to save, and by which month?");

    // Question about removing does not remove it
    const questionRemoveState = transition(setGoalState, { action: "ask", revision: 0, text: "Should I remove my goal?" }, { ...operation, kind: "goal", query: null, goal: null, reply: "none" });
    expect(questionRemoveState.message).toBe("Say “remove my goal” and I will do it.");
    expect(questionRemoveState.goal).toEqual({ amountCents: 150000, targetMonth: "2027-03" });

    // Imperative remove clears goal
    const removeState = transition(setGoalState, { action: "ask", revision: 0, text: "Remove my goal." }, { ...operation, kind: "goal", query: null, goal: null, reply: "none" });
    expect("goal" in removeState && removeState.goal).toBeFalsy();
    const removedView = toView(removeState);
    expect(removedView.jar.limitCents).toBe(220000);
    expect(removedView.spendWeek.amountCents).toBe(26064);

    // clear-goal restores limit
    const clearReq = { action: "clear-goal", revision: 0, confirmed: true } as const;
    const clearedState = transition(setGoalState, clearReq);
    expect("goal" in clearedState && clearedState.goal).toBeFalsy();
    const clearedView = toView(clearedState);
    expect(clearedView.goal).toBeNull();
    expect(clearedView.jar.limitCents).toBe(220000);
    expect(clearedView.spendWeek.amountCents).toBe(26064);
    expect(clearedView.message).toBe(`Goal removed. The jar limit is back to ${euros(220000)} a month.`);
    expect(() => transition(clearedState, clearReq)).toThrow("There is no goal to remove.");

    // Other activity noticed rules
    const usualView = toView(transition(initial, ask, { ...operation, kind: "usual", query: null }));
    expect(usualView.noticed).toBeNull();

    const profileView = toView(transition(initial, ask, { ...operation, kind: "profile", query: null }));
    expect(profileView.noticed?.rule).toBe("month_over_usual");

    // Old session (no goal property) loads through toView
    const oldSession = { ...initial };
    delete oldSession.goal;
    delete oldSession.proposedGoal;
    const oldView = toView(oldSession);
    expect(oldView.goal).toBeNull();
    expect(oldView.spendWeek.amountCents).toBe(26064);
  });
});
