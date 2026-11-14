import { z } from "zod";
import { analysisOperationSchema, basketSchema, customerProfileSchema, dateSchema, habitSchema, querySchema } from "@/shared/contracts";
import { customerProfile, dataset } from "@/server/data";

export const sessionStateSchema = z.object({
  version: z.literal(3), customerId: z.string(), revision: z.number().int().nonnegative(),
  profile: customerProfileSchema, weeklyCompletedDates: z.array(dateSchema),
  demoDate: dateSchema, habit: habitSchema.nullable(),
  completedDates: z.array(dateSchema), reflections: z.record(dateSchema, z.enum(["done", "adjust", "reflect"])),
  corrections: z.record(z.string(), basketSchema), query: querySchema.nullable(),
  mode: z.enum(["none", "invitation", "reveal", "checkin", "analysis"]),
  analysis: analysisOperationSchema.nullable(), itemLimitation: z.boolean(),
  guessCents: z.number().int().nonnegative().nullable(), percent: z.number().int().min(0).max(100).nullable(),
  skipGuess: z.boolean(), message: z.string().max(1200),
});
export type SessionState = z.infer<typeof sessionStateSchema>;
// V3 adds the seeded profile and weekly history without reinterpreting daily
// check-ins. Existing dates, corrections, habits and revision remain unchanged.
const v2Schema = sessionStateSchema.omit({ profile: true, weeklyCompletedDates: true }).extend({ version: z.literal(2) });
const legacySchema = v2Schema.omit({ analysis: true, itemLimitation: true }).extend({
  version: z.literal(1), mode: z.enum(["none", "invitation", "reveal", "checkin"]),
  query: z.object({ category: z.string(), start: dateSchema, end: dateSchema }).strict().nullable(),
});
export function migrateSessionState(value: unknown): SessionState {
  const legacy = legacySchema.safeParse(value);
  if (legacy.success) {
    const { query, ...state } = legacy.data;
    value = { ...state, version: 2, analysis: null, itemLimitation: false,
      query: query ? { start: query.start, end: query.end, categories: [query.category], baskets: [], merchantType: null } : null };
  }
  const v2 = v2Schema.safeParse(value);
  if (!v2.success) return sessionStateSchema.parse(value);
  return sessionStateSchema.parse({ ...v2.data, version: 3, profile: customerProfile,
    weeklyCompletedDates: ["2026-09-02", "2026-09-09"].filter(date => date <= v2.data.demoDate) });
}
export function initialState(): SessionState {
  return {
    version: 3, customerId: dataset.customerId, revision: 0, demoDate: "2026-09-16",
    profile: structuredClone(customerProfile), weeklyCompletedDates: ["2026-09-02", "2026-09-09"],
    habit: null, completedDates: [], reflections: {}, corrections: {}, query: null,
    analysis: null, itemLimitation: false,
    mode: "none", guessCents: null, percent: null, skipGuess: false,
    message: "Hey, I'm Sponky! Let's make your money a little less mysterious. Ask me about your August spending, or just tell me how your day's going.",
  };
}
