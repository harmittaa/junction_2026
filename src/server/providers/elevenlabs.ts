import "server-only";
import { z } from "zod";
import { config } from "../config";

const failure = "Voice service is unavailable. Please try typing instead.";

async function request(path: string, body: unknown, limit: number, signal?: AbortSignal) {
  try {
    const settings = config();
    const response = await fetch(`https://api.elevenlabs.io/v1/${path}`, {
      method: "POST",
      headers: { "xi-api-key": settings.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(failure);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error(failure);
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (!size) throw new Error(failure);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } catch {
    throw new Error(failure);
  }
}

export async function mintTranscriptionToken(signal?: AbortSignal): Promise<{ token: string; modelId: string }> {
  try {
    const modelId = config().ELEVENLABS_STT_MODEL;
    const bytes = await request("single-use-token/realtime_scribe", undefined, 8_192, signal);
    const { token } = z.object({ token: z.string().min(1).max(4096) }).parse(JSON.parse(new TextDecoder().decode(bytes)));
    return { token, modelId };
  } catch {
    throw new Error(failure);
  }
}

export async function synthesizeSpeech(text: string, signal?: AbortSignal): Promise<Uint8Array> {
  try {
    if (!text.trim() || text.length > 600) throw new Error(failure);
    const settings = config();
    return await request(`text-to-speech/${encodeURIComponent(settings.ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_128`,
      { text, model_id: settings.ELEVENLABS_TTS_MODEL }, 1_048_576, signal);
  } catch {
    throw new Error(failure);
  }
}
