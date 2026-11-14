import { z } from "zod";
import { analysisOperationSchema, basketMoveSchema, basketSchema, customerProfileSchema, dateSchema, goalSchema, habitSchema, querySchema } from "@/shared/contracts";
import { customerProfile, dataset } from "@/server/data";

export const sessionStateSchema = z.object({
  version: z.literal(5), customerId: z.string(), revision: z.number().int().nonnegative(),
  profile: customerProfileSchema, weeklyCompletedDates: z.array(dateSchema),
  demoDate: dateSchema, habit: habitSchema.nullable(),
  completedDates: z.array(dateSchema), reflections: z.record(dateSchema, z.enum(["done", "adjust", "reflect"])),
  corrections: z.record(z.string(), basketSchema), query: querySchema.nullable(),
  mode: z.enum(["none", "invitation", "reveal", "checkin", "analysis", "jar", "pace", "usual", "overspend", "save", "goal", "spend_week"]),
  move: basketMoveSchema.nullable(),
  goal: goalSchema.nullable().optional(), proposedGoal: goalSchema.nullable().optional(),
  analysis: analysisOperationSchema.nullable(), itemLimitation: z.boolean(),
  guessCents: z.number().int().nonnegative().nullable(), percent: z.number().int().min(0).max(100).nullable(),
  skipGuess: z.boolean(), message: z.string().max(1200),
  jarMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
});
export type SessionState = z.infer<typeof sessionStateSchema>;
const v4Schema = sessionStateSchema.omit({ goal: true, proposedGoal: true }).extend({
  version: z.literal(4),
  mode: z.enum(["none", "invitation", "reveal", "checkin", "analysis", "jar", "pace", "usual", "overspend"]),
});
// V3 adds the seeded profile and weekly history without reinterpreting daily
// check-ins. Existing dates, corrections, habits and revision remain unchanged.
const v3Schema = sessionStateSchema.omit({ move: true, jarMonth: true, goal: true, proposedGoal: true }).extend({ version: z.literal(3),
  mode: z.enum(["none", "invitation", "reveal", "checkin", "analysis"]) });
const v2Schema = v3Schema.omit({ profile: true, weeklyCompletedDates: true }).extend({ version: z.literal(2) });
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
  if (v2.success) value = { ...v2.data, version: 3, profile: customerProfile,
    weeklyCompletedDates: ["2026-09-02", "2026-09-09"].filter(date => date <= v2.data.demoDate) };
  const v3 = v3Schema.safeParse(value);
  // Retain old activity data, but open the new entry rather than showing a
  // retired guessing/daily-habit screen or outdated stored narration.
  if (v3.success) value = { ...v3.data, version: 4, move: null, mode: "none",
    message: welcomeMessage, skipGuess: true, guessCents: null, jarMonth: null };
  const v4 = v4Schema.safeParse(value);
  if (v4.success) value = { ...v4.data, version: 5, goal: null, proposedGoal: null };
  return sessionStateSchema.parse(value);
}
const welcomeMessage = "A little check-up, or something on your mind? I'm here for both.";
export function initialState(): SessionState {
  return {
    version: 5, customerId: dataset.customerId, revision: 0, demoDate: "2026-09-16",
    profile: structuredClone(customerProfile), weeklyCompletedDates: ["2026-09-02", "2026-09-09"],
    habit: null, completedDates: [], reflections: {}, corrections: {}, query: null,
    analysis: null, itemLimitation: false, move: null,
    goal: null, proposedGoal: null,
    mode: "none", guessCents: null, percent: null, skipGuess: true,
    message: welcomeMessage, jarMonth: null,
  };
}
