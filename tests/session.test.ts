import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sessionId, signSession, verifySession } from "@/server/session";

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.values.has(name) ? { value: jar.values.get(name) } : undefined,
  set: jar.set,
}) }));
vi.mock("@/server/config", () => ({ config: () => ({ SESSION_SECRET: "test-only-session-secret" }) }));

const secret = "test-only-session-secret";
const now = 1800000000;
const id = "12345678-1234-1234-1234-123456789012";
const otherId = "87654321-4321-4321-4321-210987654321";
beforeEach(() => {
  jar.values.clear();
  jar.set.mockReset();
  vi.spyOn(Date, "now").mockReturnValue(now * 1000);
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("uses the forwarded session cookie in preference to a different legacy session", async () => {
  jar.values.set("__session", signSession(id, now + 120, secret));
  jar.values.set("sponky_session", signSession(otherId, now + 120, secret));
  expect(await sessionId()).toBe(id);
  expect(jar.set).not.toHaveBeenCalled();
});

it("migrates an authenticated legacy session without extending its lifetime", async () => {
  const token = signSession(id, now + 120, secret);
  jar.values.set("sponky_session", token);
  expect(await sessionId()).toBe(id);
  expect(jar.set).toHaveBeenCalledWith("__session", token, {
    httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 120,
  });
});

it.each(["__session", "sponky_session"])("rejects expired or tampered %s cookies before accessing a session", async name => {
  for (const token of [signSession(id, now, secret), signSession(id, now + 120, secret).replace(id, otherId)]) {
    jar.values.set(name, token);
    await expect(sessionId()).rejects.toMatchObject({ status: 401 });
    expect(jar.set).not.toHaveBeenCalled();
  }
});

it("creates a signed secure cookie that Firebase Hosting can forward", async () => {
  const created = await sessionId(true);
  const [name, token, options] = jar.set.mock.calls[0];
  expect(name).toBe("__session");
  expect(verifySession(token, secret, now)).toBe(created);
  expect(options).toEqual({ httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 604800 });
});
