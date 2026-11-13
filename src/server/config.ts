import "server-only";
import { z } from "zod";

export function config() {
  return z.object({
    GEMINI_API_KEY: z.string().min(1),
    ELEVENLABS_API_KEY: z.string().min(1),
    SESSION_SECRET: z.string().min(32),
    GOOGLE_CLOUD_PROJECT: z.string().default("sponky-junction-2026"),
    GEMINI_MODEL: z.string().default("gemini-4-hydrogen"),
    ELEVENLABS_STT_MODEL: z.string().default("scribe_v3_live"),
    ELEVENLABS_TTS_MODEL: z.string().default("eleven_flash_v2_5"),
    ELEVENLABS_VOICE_ID: z.string().default("JBFqnCBsd6RMkjVDRZzb"),
  }).parse(process.env);
}
