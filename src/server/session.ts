import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { config } from "@/server/config";
import { AppError } from "@/server/errors";

const cookieName = "sponky_session";
const maxAge = 60 * 60 * 24 * 7;
export function signSession(id: string, expires: number, secret: string) {
  const value = `${id}.${expires}`;
  return `${value}.${createHmac("sha256", secret).update(value).digest("base64url")}`;
}
export function verifySession(token: string, secret: string, now: number): string | null {
  const [id, expiry, signature, extra] = token.split(".");
  if (extra || !/^[0-9a-f-]{36}$/.test(id ?? "") || !/^\d{10}$/.test(expiry ?? "") || !signature) return null;
  const expected = signSession(id, Number(expiry), secret).split(".")[2];
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b) || Number(expiry) <= now) return null;
  return id;
}
export async function sessionId(create = false): Promise<string> {
  const jar = await cookies();
  const secret = config().SESSION_SECRET;
  const now = Math.floor(Date.now() / 1000);
  const current = verifySession(jar.get(cookieName)?.value ?? "", secret, now);
  if (current) return current;
  if (!create) throw new AppError("Your demo session expired. Refresh to start a new session.", 401, true);
  const id = randomUUID();
  jar.set(cookieName, signSession(id, now + maxAge, secret), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge,
  });
  return id;
}
