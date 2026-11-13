import { sessionId } from "@/server/session";
import { coach } from "@/server/coach";
import { requestSchema } from "@/shared/contracts";
import { body, json, failure } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return json(await coach(await sessionId(), await body(request, requestSchema), request.signal)); }
  catch (error) { return failure(error); }
}
