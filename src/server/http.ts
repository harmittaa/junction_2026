import "server-only";
import { z } from "zod";
import { AppError } from "./errors";

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export function failure(error: unknown) {
  if (error instanceof AppError) return json({ error: error.message, retryable: error.retryable }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "Please check your input and try again.", retryable: false }, 400);
  // Never expose provider responses, credential errors, or stored session data.
  return json({ error: "The demo couldn't connect just now. Your saved state is safe. Please retry.", retryable: true }, 503);
}
export async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const origin = request.headers.get("origin");
  const expectedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  if (!origin || new URL(origin).host !== expectedHost || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError("Open Sponky directly before sending a request.", 403);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError("JSON required", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("Missing request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) { await reader.cancel(); throw new AppError("Message too long", 413); }
    chunks.push(value);
  }
  return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
