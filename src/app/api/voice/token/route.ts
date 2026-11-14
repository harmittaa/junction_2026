import { z } from "zod";
import { sessionId } from "@/server/session";
import { mintTranscriptionToken } from "@/server/providers/elevenlabs";
import { consumeBudget } from "@/server/storage/sessions";
import { body, json, failure } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await body(request, z.object({}).strict());
    const id = await sessionId();
    await consumeBudget(id, "token");
    return json(await mintTranscriptionToken(request.signal));
  } catch (error) { return failure(error); }
}
