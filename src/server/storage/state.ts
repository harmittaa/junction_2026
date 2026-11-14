import { z } from "zod";
import { basketSchema, dateSchema, habitSchema, querySchema } from "@/shared/contracts";
import { dataset } from "@/server/data";

export const sessionStateSchema = z.object({
  version: z.literal(1), customerId: z.string(), revision: z.number().int().nonnegative(),
  demoDate: dateSchema, habit: habitSchema.nullable(),
  completedDates: z.array(dateSchema), reflections: z.record(dateSchema, z.enum(["done", "adjust", "reflect"])),
  corrections: z.record(z.string(), basketSchema), query: querySchema.nullable(),
  mode: z.enum(["none", "invitation", "reveal", "checkin"]),
  guessCents: z.number().int().nonnegative().nullable(), percent: z.number().int().min(0).max(100).nullable(),
  skipGuess: z.boolean(), message: z.string().max(1200),
});
export type SessionState = z.infer<typeof sessionStateSchema>;
export function initialState(): SessionState {
  return {
    version: 1, customerId: dataset.customerId, revision: 0, demoDate: dataset.referenceDate,
    habit: null, completedDates: [], reflections: {}, corrections: {}, query: null,
    mode: "none", guessCents: null, percent: null, skipGuess: false,
    message: "Hey, I'm Sponky! Let's make your money a little less mysterious. Ask me about your October spending, or just tell me how your day's going.",
  };
}
