import { expect, it, vi } from "vitest";
import { POST } from "@/app/api/speech/route";
import { transition } from "@/server/coach";
import { initialState } from "@/server/storage/state";

const io = vi.hoisted(() => ({ read: vi.fn(), synthesize: vi.fn() }));
vi.mock("@/server/session", () => ({ sessionId: async () => "12345678-1234-1234-1234-123456789012" }));
vi.mock("@/server/storage/sessions", () => ({ readSession: io.read, consumeBudget: async () => {} }));
vi.mock("@/server/providers/elevenlabs", () => ({ synthesizeSpeech: io.synthesize }));

it("authorizes speech from the current server state, withholds pending facts, and rejects stale or arbitrary text", async () => {
  const spoken: string[] = [];
  io.synthesize.mockImplementation(async (text: string) => { spoken.push(text); return new Uint8Array([73, 68, 51]); });
  const send = (body: object) => POST(new Request("https://demo.example/api/speech", {
    method: "POST", headers: { origin: "https://demo.example", "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  const pending = { ...transition(initialState(), { action: "ask", revision: 0, text: "August groceries" }, {
    kind: "spending", query: { category: "Groceries", start: "2026-08-01", end: "2026-08-31" }, percent: null, direct: false, reply: "none",
  }), revision: 1 };
  io.read.mockResolvedValue(pending);
  expect((await send({ revision: 1 })).status).toBe(200);
  expect(spoken[0]).toContain("Want to guess");
  expect(spoken[0]).not.toMatch(/1111|7990|11 transactions|MRC/);
  io.read.mockResolvedValue({ ...transition(pending, { action: "reveal", revision: 1, guessCents: null }), revision: 2 });
  expect((await send({ revision: 1 })).status).toBe(409);
  expect((await send({ revision: 2, text: "You saved 200 euros on taxis" })).status).toBe(400);
  expect(spoken).toHaveLength(1);
  const revealed = await send({ revision: 2 });
  expect(revealed.status).toBe(200);
  expect(revealed.headers.get("Content-Type")).toBe("audio/mpeg");
  expect(spoken[1]).toContain("1111 euros and 6 cents");
  expect(spoken[1]).toContain("groceries in August 2026, across 16 payments");
  const later = transition({ ...initialState(), demoDate: "2026-09-30" }, { action: "ask", revision: 0, text: "Health in September, just show me" }, {
    kind: "spending", query: { category: "Health", start: "2026-09-01", end: "2026-09-30" }, percent: null, direct: true, reply: "none",
  });
  io.read.mockResolvedValue(later);
  expect((await send({ revision: 0 })).status).toBe(200);
  expect(spoken[2]).toContain("73 euros and 15 cents");
});
