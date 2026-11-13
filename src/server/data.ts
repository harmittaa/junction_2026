import "server-only";
import { z } from "zod";
import raw from "../../data/demo-transactions.json";
import { dateSchema, transactionSchema } from "@/shared/contracts";
import { isSpending } from "@/domain/spending";

export const dataset = z.object({
  customerId: z.string(), period: z.object({ start: dateSchema, end: dateSchema }),
  referenceDate: dateSchema,
  source: z.object({ url: z.string().url(), commit: z.string(), sha256: z.string() }),
  transactions: z.array(transactionSchema),
}).parse(raw);
if (dataset.transactions.some(row => row.customerId !== dataset.customerId)) throw new Error("Invalid customer slice");
export const categories = [...new Set(dataset.transactions.filter(isSpending).map(row => row.category))].sort();
