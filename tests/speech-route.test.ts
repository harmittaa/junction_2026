import { expect, it, vi } from "vitest";
import { POST } from "@/app/api/speech/route";
import { transition } from "@/server/coach";
import { initialState } from "@/server/storage/state";

const io = vi.hoisted(() => ({ read: vi.fn(), synthesize: vi.fn() }));
vi.mock("@/server/session", () => ({ sessionId: async () => "12345678-1234-1234-1234-123456789012" }));
vi.mock("@/server/storage/sessions", () => ({ readSession: io.read, consumeBudget: async () => {} }));
vi.mock("@/server/providers/elevenlabs", () => ({ synthesizeSpeech: io.synthesize }));

it("speaks the server-owned entry or answer and rejects stale revisions or arbitrary text", async () => {
  const spoken: string[] = [];
  io.synthesize.mockImplementation(async (text: string) => { spoken.push(text); return new Uint8Array([73, 68, 51]); });
  const send = (body: object) => POST(new Request("https://demo.example/api/speech", {
    method: "POST", headers: { origin: "https://demo.example", "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  io.read.mockResolvedValue(initialState());
  expect((await send({ revision: 0, entry: true })).status).toBe(200);
  expect(spoken[0]).toBe("A little check-up, or something on your mind? I'm here for both.");
  expect(spoken[0]).not.toMatch(/euros|MRC|balance|spent/);
  const answer = { ...transition(initialState(), { action: "ask", revision: 0, text: "August groceries" }, {
    kind: "spending", query: { categories: ["Groceries"], baskets: [], merchantType: null, start: "2026-08-01", end: "2026-08-31" }, percent: null, direct: false, reply: "none",
    comparePeriod: null, by: null, top: null, concept: null,
  }), revision: 1 };
  io.read.mockResolvedValue(answer);
  expect((await send({ revision: 0 })).status).toBe(409);
  expect((await send({ revision: 1, text: "You saved 200 euros on taxis" })).status).toBe(400);
  expect(spoken).toHaveLength(1);
  const revealed = await send({ revision: 1 });
  expect(revealed.status).toBe(200);
  expect(revealed.headers.get("Content-Type")).toBe("audio/mpeg");
  expect(spoken[1]).toContain("about one thousand one hundred eleven euros");
  expect(spoken[1]).not.toContain("cents");
  expect(spoken[1]).toContain("groceries in August 2026, across 16 payments");
  const later = transition({ ...initialState(), demoDate: "2026-09-30" }, { action: "ask", revision: 0, text: "Health in September, just show me" }, {
    kind: "spending", query: { categories: ["Health"], baskets: [], merchantType: null, start: "2026-09-01", end: "2026-09-30" }, percent: null, direct: true, reply: "none",
    comparePeriod: null, by: null, top: null, concept: null,
  });
  io.read.mockResolvedValue(later);
  expect((await send({ revision: 0 })).status).toBe(200);
  expect(spoken[2]).toContain("about seventy three euros");
  expect(spoken[2]).not.toContain("cents");
});
