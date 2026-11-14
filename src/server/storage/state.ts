import { z } from "zod";
import { analysisOperationSchema, basketSchema, dateSchema, habitSchema, querySchema } from "@/shared/contracts";
import { dataset } from "@/server/data";

export const sessionStateSchema = z.object({
  version: z.literal(2), customerId: z.string(), revision: z.number().int().nonnegative(),
  demoDate: dateSchema, habit: habitSchema.nullable(),
  completedDates: z.array(dateSchema), reflections: z.record(dateSchema, z.enum(["done", "adjust", "reflect"])),
  corrections: z.record(z.string(), basketSchema), query: querySchema.nullable(),
  mode: z.enum(["none", "invitation", "reveal", "checkin", "analysis"]),
  analysis: analysisOperationSchema.nullable(), itemLimitation: z.boolean(),
  guessCents: z.number().int().nonnegative().nullable(), percent: z.number().int().min(0).max(100).nullable(),
  skipGuess: z.boolean(), message: z.string().max(1200),
});
export type SessionState = z.infer<typeof sessionStateSchema>;
// Explicit, lossless V1 migration: retain habits, corrections, dates and revision.
// Old-customer sessions are still rejected by the storage authorization check.
const legacySchema = sessionStateSchema.omit({ analysis: true, itemLimitation: true }).extend({
  version: z.literal(1), mode: z.enum(["none", "invitation", "reveal", "checkin"]),
  query: z.object({ category: z.string(), start: dateSchema, end: dateSchema }).strict().nullable(),
});
export function migrateSessionState(value: unknown): SessionState {
  const legacy = legacySchema.safeParse(value);
  if (!legacy.success) return sessionStateSchema.parse(value);
  const { query, ...state } = legacy.data;
  return sessionStateSchema.parse({ ...state, version: 2, analysis: null, itemLimitation: false,
    query: query ? { start: query.start, end: query.end, categories: [query.category], baskets: [], merchantType: null } : null });
}
export function initialState(): SessionState {
  return {
    version: 2, customerId: dataset.customerId, revision: 0, demoDate: dataset.referenceDate,
    habit: null, completedDates: [], reflections: {}, corrections: {}, query: null,
    analysis: null, itemLimitation: false,
    mode: "none", guessCents: null, percent: null, skipGuess: false,
    message: "Hey, I'm Sponky! Let's make your money a little less mysterious. Ask me about your August spending, or just tell me how your day's going.",
  };
}
