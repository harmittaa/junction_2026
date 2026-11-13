import { sessionId } from "@/server/session";
import { readSession } from "@/server/storage/sessions";
import { toView } from "@/server/coach";
import { json, failure } from "@/server/http";
export const runtime = "nodejs";
export async function GET() {
  try { return json(toView(await readSession(await sessionId(true)))); }
  catch (error) { return failure(error); }
}
