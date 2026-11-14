import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { transition, toView } from "@/server/coach";
import { initialState } from "@/server/storage/state";
import { type Interpretation, interpret } from "@/server/providers/gemini";
import { signSession, verifySession } from "@/server/session";

const query = { categories: ["Groceries"], baskets: [], merchantType: null, start: "2026-08-01", end: "2026-08-31" };
const operation: Interpretation = { kind: "spending", query, direct: false, percent: null, reply: "none", comparePeriod: null, by: null, top: null, concept: null };
const ask = { action: "ask", text: "Groceries last month?", revision: 0 } as const;
describe("coordinator boundaries", () => {
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
      expect(Date.now() - started).toBeLessThan(22000);
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
  }, 25000);
});
