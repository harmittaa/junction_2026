import { describe, expect, it } from "vitest";
import { transition, toView } from "@/server/coach";
import { initialState } from "@/server/storage/state";
import { type Interpretation, interpret } from "@/server/providers/gemini";
import { signSession, verifySession } from "@/server/session";

const query = { category: "Groceries", start: "2024-10-01", end: "2024-10-31" };
const operation: Interpretation = { kind: "spending", query, direct: false, percent: null, reply: "Untrusted model text: 752.75" };
const ask = { action: "ask", text: "Groceries last month?", revision: 0 } as const;
describe("coordinator boundaries", () => {
  it("withholds amount, evidence and model text until a reveal, including serialized payload and speech text", () => {
    const pending = transition(initialState(), ask, operation);
    const hidden = toView(pending);
    expect(hidden.activity).toEqual({ kind: "invitation", query });
    expect(JSON.stringify(hidden)).not.toMatch(/752|3251|MRC|totalCents|evidence|Untrusted/);
    const revealed = toView(transition(pending, { action: "reveal", revision: 0, guessCents: 20000 }));
    expect(revealed.activity.kind).toBe("reveal");
    if (revealed.activity.kind === "reveal") expect(revealed.activity.spending.totalCents).toBe(75275);
  });
  it("honors direct answers, remembers a declined game, and leaves a game when the topic changes", () => {
    const direct = transition(initialState(), ask, { ...operation, direct: true });
    expect(toView(direct).activity.kind).toBe("reveal");
    const pending = transition(initialState(), ask, operation);
    const skipped = transition(pending, { action: "reveal", revision: 0, guessCents: null });
    expect(toView(transition(skipped, ask, operation)).activity.kind).toBe("reveal");
    const chat = transition(pending, ask, { kind: "chat", query: null, direct: false, percent: null, reply: "That sounds like a long day. Want to talk about it?" });
    expect(toView(chat).activity.kind).toBe("none");
    expect(chat.completedDates).toEqual([]);
    expect(chat.habit).toBeNull();
    expect(() => transition(chat, { action: "reveal", revision: 0, guessCents: null })).toThrow();
  });
  it("normalizes malformed, out-of-scope and failed reasoning without trusting model output", async () => {
    const context = { categories: ["Groceries"], start: "2024-10-01", end: "2024-11-30", referenceDate: "2024-11-04", previousQuery: null };
    const future = { ...operation, query: { ...query, end: "2024-11-30" } };
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
});
