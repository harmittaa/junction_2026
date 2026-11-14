import { z } from "zod";

export const dateSchema = z.iso.date();
export const basketSchema = z.enum(["regular", "unexpected", "everyday"]);
export type Basket = z.infer<typeof basketSchema>;
export const basketLabels: Record<Basket, string> = {
  regular: "Regular essentials",
  unexpected: "Unexpected necessities",
  everyday: "Everyday spending",
};
export const merchantTypeSchema = z.enum(["taxi", "fuel", "parking", "transit", "fast_food", "bars", "restaurants", "pharmacies"]);
export type MerchantType = z.infer<typeof merchantTypeSchema>;
export const periodSchema = z.object({ start: dateSchema, end: dateSchema }).strict();
export const querySchema = periodSchema.extend({
  categories: z.array(z.string().min(1).max(60)).max(15),
  baskets: z.array(basketSchema).max(3),
  merchantType: merchantTypeSchema.nullable(),
}).strict();
export type SpendingQuery = z.infer<typeof querySchema>;
export const analysisKindSchema = z.enum(["breakdown", "comparison", "trend", "cashflow", "whatif", "profile"]);
export const analysisOperationSchema = z.object({
  kind: analysisKindSchema, query: querySchema,
  comparePeriod: periodSchema.nullable(),
  by: z.enum(["category", "basket", "merchantType", "month"]).nullable(),
  top: z.number().int().min(1).max(24).nullable(),
  percent: z.number().int().min(0).max(100).nullable(),
}).strict();
export type AnalysisOperation = z.infer<typeof analysisOperationSchema>;
// The planner cannot choose a customer or write amounts. A correction is only
// user-supplied matching criteria; the application resolves current evidence.
export const planSchema = analysisOperationSchema.extend({
  kind: z.enum(["spending", "breakdown", "comparison", "trend", "cashflow", "whatif", "profile", "scenario", "reveal", "chat", "clarify", "explain", "checkin", "habit", "jar", "pace", "usual", "overspend", "weekly_checkup", "move"]),
  query: querySchema.nullable(), direct: z.boolean(),
  reply: z.enum(["none", "listen", "tired", "positive", "scope", "question", "items"]),
  concept: z.enum(["baskets", "budget", "interest", "inflation", "saving", "investing", "gross_net", "compound_interest"]).nullable(),
  correction: z.object({ amountCents: z.number().int().safe().positive().nullable(), date: dateSchema.nullable(),
    merchant: z.string().max(80).nullable(), category: z.string().max(60).nullable(),
    necessityQuote: z.string().min(1).max(600) }).strict().nullable().optional(),
}).strict();
export type Plan = z.infer<typeof planSchema>;
export const transactionSchema = z.object({
  id: z.string(), sourceRow: z.number().int().positive(), customerId: z.string(),
  accountId: z.string(), date: dateSchema, timestamp: z.string(), category: z.string(),
  amountCents: z.number().int().safe(), transactionType: z.string(),
  merchantId: z.string().nullable(), mcc: z.string().nullable(),
});
export type Transaction = z.infer<typeof transactionSchema>;
export const habitSchema = z.object({
  category: z.string().min(1).max(60), action: z.string().trim().min(3).max(160),
  goal: z.string().trim().max(80),
}).strict();
export type Habit = z.infer<typeof habitSchema>;
const money = z.number().int().safe().nonnegative();
export const evidenceSchema = z.object({
  id: z.string(), sourceRow: z.number().int(), date: dateSchema,
  category: z.string(), merchant: z.string(), amountCents: money, basket: basketSchema,
});
export const spendingSchema = z.object({
  query: querySchema, totalCents: money,
  evidence: z.array(evidenceSchema),
  evidenceCount: z.number().int().nonnegative(),
  missingMccCount: z.number().int().nonnegative(),
  assumptions: z.array(z.string()),
  baskets: z.object({ regular: money, unexpected: money, everyday: money }),
});
export type Spending = z.infer<typeof spendingSchema>;
export const scenarioSchema = z.object({
  percent: z.number().int().min(0).max(100), baseCents: money,
  reductionCents: money, remainingCents: money,
});
export type Scenario = z.infer<typeof scenarioSchema>;
export const analysisSchema = z.object({
  kind: analysisKindSchema, query: querySchema, title: z.string(),
  sections: z.array(z.object({ label: z.string(), rows: z.array(z.object({
    label: z.string(), amountCents: z.number().int().safe(),
    count: z.number().int().nonnegative().nullable(),
    sharePercent: z.number().min(0).max(100).nullable(),
  })) })),
  evidence: z.array(evidenceSchema), evidenceCount: z.number().int().nonnegative(),
  assumptions: z.array(z.string()),
});
export type Analysis = z.infer<typeof analysisSchema>;
const revision = z.number().int().nonnegative();
export const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ask"), revision, text: z.string().trim().min(1).max(600) }).strict(),
  z.object({ action: z.literal("weekly-checkup"), revision }).strict(),
  z.object({ action: z.literal("next-week"), revision }).strict(),
  z.object({ action: z.literal("undo-move"), revision }).strict(),
  z.object({ action: z.literal("reveal"), revision, guessCents: money.max(10000000).nullable() }).strict(),
  z.object({ action: z.literal("correct"), revision, transactionId: z.string().max(60), basket: basketSchema, confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("scenario"), revision, percent: z.number().int().min(0).max(100) }).strict(),
  z.object({ action: z.literal("habit"), revision, habit: habitSchema, confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("checkin"), revision }).strict(),
  z.object({ action: z.literal("complete"), revision, reflection: z.enum(["done", "adjust", "reflect"]), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("advance"), revision, confirmed: z.literal(true) }).strict(),
]);
export type CoachRequest = z.infer<typeof requestSchema>;
export const speechRequestSchema = z.object({ revision, entry: z.boolean().optional() }).strict();
export const voiceTokenSchema = z.object({ token: z.string().min(1), modelId: z.string().min(1) });
export const apiErrorSchema = z.object({ error: z.string(), retryable: z.boolean() });

export const monthlyLimitSchema = z.object({
  amountCents: money.positive(), activeSince: z.string().regex(/^\d{4}-\d{2}$/),
}).strict();
export type MonthlyLimit = z.infer<typeof monthlyLimitSchema>;
export const customerProfileSchema = z.object({
  firstName: z.string().min(1).max(60), everydayLimit: monthlyLimitSchema,
}).strict();
export const jarSchema = z.object({
  period: periodSchema, limitCents: money, spentCents: money,
  leftCents: money, overCents: money,
  elapsedDays: z.number().int().positive(), daysLeft: z.number().int().nonnegative(),
  dailySpentCents: money, dailyRemainingCents: money,
  projectedCents: money, projectedOverCents: money,
  unexpectedCents: money,
  months: z.array(z.object({ month: z.string(), spentCents: money, inside: z.boolean() })),
  contributionPeriod: periodSchema,
  topDays: z.array(z.object({ date: dateSchema, amountCents: money, count: z.number().int().positive() })),
  evidence: z.array(evidenceSchema),
}).strict();
export type JarStatus = z.infer<typeof jarSchema>;
export const usualComparisonSchema = z.object({
  period: periodSchema, baseline: periodSchema, monthCount: z.number().int().positive(),
  rows: z.array(z.object({ category: z.string(), currentCents: money, usualCents: money,
    paymentDates: z.array(dateSchema), count: z.number().int().nonnegative() })),
  evidence: z.array(evidenceSchema),
}).strict();
export type UsualComparison = z.infer<typeof usualComparisonSchema>;
export const weeklyCheckupSchema = z.object({
  weekStart: dateSchema, completed: z.boolean(), due: z.boolean(),
  streak: z.number().int().nonnegative(), completedDates: z.array(dateSchema),
}).strict();
export type WeeklyCheckup = z.infer<typeof weeklyCheckupSchema>;
export const basketMoveSchema = z.object({
  transactionId: z.string(), amountCents: money, from: basketSchema, to: basketSchema,
}).strict();
export type BasketMove = z.infer<typeof basketMoveSchema>;

export const activitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("invitation"), query: querySchema }),
  z.object({ kind: z.literal("reveal"), spending: spendingSchema, guessCents: money.nullable(), scenario: scenarioSchema.nullable() }),
  z.object({ kind: z.literal("checkin"), spending: spendingSchema, completed: z.boolean() }),
  z.object({ kind: z.literal("analysis"), analysis: analysisSchema }),
  z.object({ kind: z.literal("jar") }),
  z.object({ kind: z.literal("pace") }),
  z.object({ kind: z.literal("overspend") }),
  z.object({ kind: z.literal("usual"), comparison: usualComparisonSchema }),
]);
export type Activity = z.infer<typeof activitySchema>;
export const viewSchema = z.object({
  revision: z.number().int().nonnegative(), demoDate: dateSchema,
  message: z.string().max(1200), entryMessage: z.string().max(1200), activity: activitySchema,
  profile: customerProfileSchema, checkup: weeklyCheckupSchema, jar: jarSchema, move: basketMoveSchema.nullable(),
  habit: habitSchema.nullable(), completedDates: z.array(dateSchema),
  categories: z.array(z.string()), period: z.object({ start: dateSchema, end: dateSchema }),
});
export type CoachView = z.infer<typeof viewSchema>;
