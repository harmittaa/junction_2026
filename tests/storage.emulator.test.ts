import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { readSession, updateSession, consumeBudget } from "@/server/storage/sessions";
import { transition, toView } from "@/server/coach";

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GOOGLE_CLOUD_PROJECT?.startsWith("demo-")) throw new Error("Tests require a disposable demo-* emulator");
});
describe("Firestore server persistence", () => {
  it("rejects the previous demo customer without changing their saved records", async () => {
    const id = randomUUID();
    const state = { ...await readSession(id), customerId: "CUST00001" };
    const ref = getFirestore().collection("demoSessionsV1").doc(id);
    await ref.set({ state });
    await expect(readSession(id)).rejects.toMatchObject({ status: 409 });
    expect((await ref.get()).data()?.state).toEqual(state);
  });
  it("isolates sessions, preserves reload state, and atomically credits one completion per date", async () => {
    const a = randomUUID(), b = randomUUID();
    const habit = { category: "Groceries", action: "Pause and review my groceries", goal: "More intentional shopping" };
    await updateSession(a, 0, state => transition({ ...state, demoDate: "2026-09-01" }, { action: "habit", habit, confirmed: true, revision: 0 }));
    const opened = await updateSession(a, 1, state => transition(state, { action: "checkin", revision: 1 }));
    const writes = await Promise.allSettled(Array.from({ length: 6 }, () => updateSession(a, 2, state => transition(state, { action: "complete", revision: 2, confirmed: true, reflection: "reflect" }))));
    expect(writes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(opened.completedDates).toEqual([]);
    const reloaded = await readSession(a);
    expect(reloaded.habit).toEqual(habit);
    expect(reloaded.completedDates).toEqual(["2026-09-01"]);
    expect((await readSession(b)).habit).toBeNull();
    expect((await readSession(b)).completedDates).toEqual([]);
    await updateSession(a, 3, state => transition(state, { action: "complete", revision: 3, confirmed: true, reflection: "done" }));
    expect((await readSession(a)).completedDates).toEqual(["2026-09-01"]);
    const tomorrow = await updateSession(a, 4, state => transition(state, { action: "advance", revision: 4, confirmed: true }));
    const view = toView(tomorrow);
    expect(view.demoDate).toBe("2026-09-02");
    expect(view.activity.kind).toBe("checkin");
    if (view.activity.kind === "checkin") expect(view.activity.spending.totalCents).toBe(0);
    await updateSession(a, 5, state => transition(state, { action: "complete", revision: 5, confirmed: true, reflection: "adjust" }));
    expect((await readSession(a)).completedDates).toEqual(["2026-09-01", "2026-09-02"]);
  });
  it("bounds concurrent paid work and denies direct unauthenticated database access", async () => {
    const id = randomUUID();
    const results = await Promise.allSettled([consumeBudget(id, "reasoning"), consumeBudget(id, "reasoning")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const root = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${process.env.GOOGLE_CLOUD_PROJECT}/databases/(default)/documents`;
    const read = await fetch(`${root}/demoSessionsV1/${id}`);
    expect(read.status).toBe(403);
    const write = await fetch(`${root}/demoSessionsV1/forbidden`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: { value: { stringValue: "no" } } }) });
    expect(write.status).toBe(403);
  });
  it("migrates legacy query state without losing saved choices and still rejects another customer", async () => {
    const id = randomUUID();
    const current = await readSession(id);
    const legacy = { ...current, version: 1, revision: 4,
      query: { category: "Groceries", start: "2026-08-01", end: "2026-08-31" }, mode: "reveal",
      habit: { category: "Groceries", action: "Review my groceries", goal: "" },
      corrections: { "row-2898292": "regular" }, completedDates: ["2026-09-01"] };
    const ref = getFirestore().collection("demoSessionsV1").doc(id);
    await ref.set({ state: legacy });
    const loaded = await readSession(id);
    expect(loaded).toMatchObject({ version: 5, mode: "none", revision: 4, habit: legacy.habit, corrections: legacy.corrections,
      completedDates: legacy.completedDates, query: { categories: ["Groceries"], baskets: [], merchantType: null } });
    await updateSession(id, 4, state => transition(state, { action: "checkin", revision: 4 }));
    expect((await ref.get()).data()?.state.version).toBe(5);
    await ref.set({ state: { ...legacy, customerId: "CUST00001" } });
    await expect(readSession(id)).rejects.toMatchObject({ status: 409 });
  });
  it("reserves every possible model call without raising the existing per-session budget", async () => {
    const id = randomUUID(), now = Date.now();
    for (let i = 0; i < 10; i++) await consumeBudget(id, "reasoning", new Date(now + i * 1000), 3);
    await expect(consumeBudget(id, "reasoning", new Date(now + 11000))).rejects.toMatchObject({ status: 429 });
  });
  it("atomically completes one weekly check-up, preserves daily history and isolates sessions", async () => {
    const a = randomUUID(), b = randomUUID();
    const writes = await Promise.allSettled(Array.from({ length: 6 }, () =>
      updateSession(a, 0, state => transition(state, { action: "weekly-checkup", revision: 0 }))));
    expect(writes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const saved = await readSession(a);
    expect(saved.weeklyCompletedDates).toEqual(["2026-09-02", "2026-09-09", "2026-09-16"]);
    expect(saved.completedDates).toEqual([]);
    expect((await readSession(b)).weeklyCompletedDates).toEqual(["2026-09-02", "2026-09-09"]);
    await updateSession(a, 1, state => transition({ ...state, demoDate: "2026-09-20" }, { action: "weekly-checkup", revision: 1 }));
    expect((await readSession(a)).weeklyCompletedDates).toEqual(saved.weeklyCompletedDates);
    const next = await updateSession(a, 2, state => transition({ ...state, demoDate: "2026-09-23" }, { action: "weekly-checkup", revision: 2 }));
    expect(next.weeklyCompletedDates).toEqual([...saved.weeklyCompletedDates, "2026-09-23"]);
    expect(next.message).toContain("4 weeks");
  });
  it("loads a stored version 4 state with goal: null and starts a new session at version 5", async () => {
    const id = randomUUID();
    const fresh = await readSession(randomUUID());
    expect(fresh.version).toBe(5);
    expect(fresh.goal).toBeNull();
    const v4State = {
      customerId: "CUST04060",
      version: 4,
      revision: 3,
      mode: "none" as const,
      demoDate: "2026-09-16",
      weeklyCompletedDates: ["2026-09-02", "2026-09-09"],
      completedDates: ["2026-09-02"],
      reflections: {},
      corrections: { "row-2898292": "regular" as const },
      query: null,
      profile: { firstName: "Matti", everydayLimit: { amountCents: 220000, activeSince: "2026-02" } },
      habit: null,
      analysis: null,
      itemLimitation: false,
      move: null,
      guessCents: null,
      percent: null,
      skipGuess: true,
      message: "hello",
      jarMonth: null,
    };
    const ref = getFirestore().collection("demoSessionsV1").doc(id);
    await ref.set({ state: v4State });
    const loaded = await readSession(id);
    expect(loaded.version).toBe(5);
    expect(loaded.goal).toBeNull();
    expect(loaded.proposedGoal).toBeNull();
    expect(loaded.revision).toBe(3);
    expect(loaded.demoDate).toBe("2026-09-16");
    expect(loaded.completedDates).toEqual(["2026-09-02"]);
    expect(loaded.corrections).toEqual({ "row-2898292": "regular" });
  });
});
