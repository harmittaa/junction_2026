import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { readSession, updateSession, consumeBudget } from "@/server/storage/sessions";
import { transition, toView } from "@/server/coach";

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GOOGLE_CLOUD_PROJECT?.startsWith("demo-")) throw new Error("Tests require a disposable demo-* emulator");
});
describe("Firestore server persistence", () => {
  it("isolates sessions, preserves reload state, and atomically credits one completion per date", async () => {
    const a = randomUUID(), b = randomUUID();
    const habit = { category: "Groceries", action: "Pause and review my groceries", goal: "More intentional shopping" };
    await updateSession(a, 0, state => transition(state, { action: "habit", habit, confirmed: true, revision: 0 }));
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
});
