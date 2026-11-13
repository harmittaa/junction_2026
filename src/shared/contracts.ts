import { z } from "zod";

export const dateSchema = z.iso.date();
export const basketSchema = z.enum(["regular", "unexpected", "everyday"]);
export type Basket = z.infer<typeof basketSchema>;
export const basketLabels: Record<Basket, string> = {
  regular: "Regular essentials",
  unexpected: "Unexpected necessities",
  everyday: "Everyday spending",
};
export const querySchema = z.object({
  category: z.string().min(1).max(60),
  start: dateSchema,
  end: dateSchema,
}).strict();
export type SpendingQuery = z.infer<typeof querySchema>;
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
  baskets: z.object({ regular: money, unexpected: money, everyday: money }),
});
export type Spending = z.infer<typeof spendingSchema>;
export const scenarioSchema = z.object({
  percent: z.number().int().min(0).max(100), baseCents: money,
  reductionCents: money, remainingCents: money,
});
export type Scenario = z.infer<typeof scenarioSchema>;
export const activitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("invitation"), query: querySchema }),
  z.object({ kind: z.literal("reveal"), spending: spendingSchema, guessCents: money.nullable(), scenario: scenarioSchema.nullable() }),
  z.object({ kind: z.literal("checkin"), spending: spendingSchema, completed: z.boolean() }),
]);
export type Activity = z.infer<typeof activitySchema>;
export const viewSchema = z.object({
  revision: z.number().int().nonnegative(), demoDate: dateSchema,
  message: z.string().max(1200), activity: activitySchema,
  habit: habitSchema.nullable(), completedDates: z.array(dateSchema),
  categories: z.array(z.string()), period: z.object({ start: dateSchema, end: dateSchema }),
});
export type CoachView = z.infer<typeof viewSchema>;
const revision = z.number().int().nonnegative();
export const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ask"), revision, text: z.string().trim().min(1).max(600) }).strict(),
  z.object({ action: z.literal("reveal"), revision, guessCents: money.max(10000000).nullable() }).strict(),
  z.object({ action: z.literal("correct"), revision, transactionId: z.string().max(60), basket: basketSchema, confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("scenario"), revision, percent: z.number().int().min(0).max(100) }).strict(),
  z.object({ action: z.literal("habit"), revision, habit: habitSchema, confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("checkin"), revision }).strict(),
  z.object({ action: z.literal("complete"), revision, reflection: z.enum(["done", "adjust", "reflect"]), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("advance"), revision, confirmed: z.literal(true) }).strict(),
]);
export type CoachRequest = z.infer<typeof requestSchema>;
export const speechRequestSchema = z.object({ revision }).strict();
export const voiceTokenSchema = z.object({ token: z.string().min(1), modelId: z.string().min(1) });
export const apiErrorSchema = z.object({ error: z.string(), retryable: z.boolean() });
