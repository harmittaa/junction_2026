import { sessionId } from "@/server/session";
import { synthesizeSpeech } from "@/server/providers/elevenlabs";
import { readSession, consumeBudget } from "@/server/storage/sessions";
import { toView } from "@/server/coach";
import { speechText } from "@/domain/replies";
import { speechRequestSchema } from "@/shared/contracts";
import { AppError } from "@/server/errors";
import { body, failure } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { revision, entry } = await body(request, speechRequestSchema);
    const id = await sessionId();
    const state = await readSession(id);
    if (revision !== state.revision) throw new AppError("That reply is no longer current.", 409);
    // Only the same server-authorized text sent to the UI is eligible for speech.
    // Pending amounts and evidence never enter either payload.
    // Spell out Finnish-formatted currency for the English voice; the raw €
    // symbol was pronounced as "arrow" in the live acceptance recording.
    const view = toView(state);
    const text = speechText(entry ? view.entryMessage : view.message);
    await consumeBudget(id, "speech");
    const audio = await synthesizeSpeech(text, request.signal);
    return new Response(Buffer.from(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
