import { describe, expect, it } from "vitest";
import { merchantSpike } from "@/domain/merchant-spike";
import { noticedSchema, transactionSchema, type Transaction } from "@/shared/contracts";
import raw from "../data/demo-transactions.json";

const rows = raw.transactions.map(row => transactionSchema.parse(row));
const input = { rows, customerId: raw.customerId, month: "2026-08", referenceDate: "2026-09-16" };
const payment = (id: string, date: string, amountCents: number, merchantId = "merchant"): Transaction => ({
  ...rows[0], id, date, amountCents: -amountCents, merchantId, transactionType: "purchase",
});

describe("merchant spike", () => {
  it("checks all August merchants and keeps only the largest qualifying total", () => {
    const result = merchantSpike(input);
    expect(result?.merchantId).toBe("MRC-ENT-0052");
    expect(result?.noticed.text.replaceAll("\u00a0", " ")).toBe(
      "4 payments here in August, 445,98 €. In the 11 months before: 177,46 €.",
    );
    expect(noticedSchema.safeParse(result?.noticed).success).toBe(true);
    expect(result?.noticed.question).toBe("Still worth it to you?");
  });

  it("does not flag flat monthly spending", () => {
    const flat = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 8 + index, 1)).toISOString().slice(0, 10);
      return [1, 2, 3].map(n => payment(`${index}-${n}`, date, 10000));
    }).flat();
    expect(merchantSpike({ ...input, rows: flat })).toBeNull();
  });

  it("enforces count, minimum amount and exact twice-average boundary", () => {
    const monthRows = [1, 2, 3].map(n => payment(`${n}`, "2026-08-05", n === 3 ? 6668 : 6666));
    expect(merchantSpike({ ...input, rows: monthRows })).not.toBeNull();
    expect(merchantSpike({ ...input, rows: monthRows.slice(1) })).toBeNull();
    expect(merchantSpike({ ...input, rows: monthRows.map(row => ({ ...row, amountCents: -6666 })) })).toBeNull();
    const prior = payment("prior", "2025-09-01", 110000);
    expect(merchantSpike({ ...input, rows: [...monthRows, prior] })).not.toBeNull();
    expect(merchantSpike({ ...input, rows: [...monthRows, { ...prior, amountCents: -110001 }] })).toBeNull();
  });

  it("scopes the customer, dates and spending rows and breaks ties consistently", () => {
    const valid = [1, 2, 3].map(n => payment(`valid-${n}`, "2026-08-05", 10000, "A"));
    const ignored = [
      ...valid.map(row => ({ ...row, customerId: "other", merchantId: "other" })),
      ...valid.map(row => ({ ...row, date: "2026-08-20", merchantId: "future" })),
      ...valid.map(row => ({ ...row, transactionType: "transfer", merchantId: "transfer" })),
      ...valid.map(row => ({ ...row, amountCents: 10000, merchantId: "refund" })),
      payment("old", "2025-08-31", 1000000, "A"),
    ];
    expect(merchantSpike({ ...input, rows: [...valid, ...ignored], referenceDate: "2026-08-10" })?.merchantId).toBe("A");
    const tied = valid.map(row => ({ ...row, id: `tie-${row.id}`, merchantId: "B" }));
    expect(merchantSpike({ ...input, rows: [...tied, ...valid] })?.merchantId).toBe("A");
    expect(merchantSpike({ ...input, referenceDate: "2026-07-31" })).toBeNull();
  });
});
