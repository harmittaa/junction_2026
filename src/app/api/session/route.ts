import { z } from "zod";
import { newSession, sessionId } from "@/server/session";
import { readSession } from "@/server/storage/sessions";
import { toView } from "@/server/coach";
import { initialState } from "@/server/storage/state";
import { body, json, failure } from "@/server/http";
export const runtime = "nodejs";
export async function GET() {
  try { return json(toView(await readSession(await sessionId(true)))); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    await body(request, z.object({ confirmed: z.literal(true) }).strict());
    await newSession();
    return json(toView(initialState()));
  } catch (error) { return failure(error); }
}
