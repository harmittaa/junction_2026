import { describe, expect, it } from "vitest";
import {
  analysisSchema,
  goalVerdictSchema,
  safeToSaveSchema,
  viewSchema,
} from "../src/shared/contracts";
import {
  dayHeading,
  goalAmount,
  lastDayOfMonth,
  minusEuros,
  monthRange,
} from "../src/components/answer-format";
import {
  onTrackFixture,
  onTrackViewFixture,
  outOfReachFixture,
  outOfReachViewFixture,
  profileEvidence,
  profileFixture,
  profileViewFixture,
  saveFixture,
  saveViewFixture,
  stretchFixture,
  stretchViewFixture,
} from "../src/components/answer-cards.fixtures";

describe("answer-format helpers", () => {
  it("formats goalAmount without trailing cents for whole euros and keeps cents otherwise", () => {
    // 150000 cents = 1 500 € (whole euros)
    const whole = goalAmount(150000);
    expect(whole.replace(/\s/g, " ")).toBe("1 500 €");
    expect(whole).not.toContain(",00");

    // 123450 cents = 1 234,50 €
    const withCents = goalAmount(123450);
    expect(withCents.replace(/\s/g, " ")).toBe("1 234,50 €");
  });

  it("calculates lastDayOfMonth for target months including leap years and non-leap years", () => {
    expect(lastDayOfMonth("2027-03")).toBe("31 March 2027");
    expect(lastDayOfMonth("2027-02")).toBe("28 February 2027");
    expect(lastDayOfMonth("2028-02")).toBe("29 February 2028");
    expect(lastDayOfMonth("2026-04")).toBe("30 April 2026");
  });

  it("formats monthRange for same year, different years, and single months", () => {
    expect(monthRange("2026-03-01", "2026-08-31")).toBe("March–August 2026");
    expect(monthRange("2025-03-01", "2026-08-31")).toBe("March 2025–August 2026");
    expect(monthRange("2026-08-01", "2026-08-31")).toBe("August 2026");
  });

  it("formats dayHeading from date string into weekday day month", () => {
    expect(dayHeading("2026-08-29")).toBe("Sat 29 Aug");
    expect(dayHeading("2026-08-28")).toBe("Fri 28 Aug");
    expect(dayHeading("2026-08-27")).toBe("Thu 27 Aug");
  });

  it("formats minus sign with U+2212 and space", () => {
    const formatted = minusEuros(106678);
    expect(formatted.startsWith("\u2212 ")).toBe(true);
    expect(formatted.replace(/\s/g, " ")).toBe("− 1 066,78 €");
  });
});

describe("answer-cards fixtures schema validation and financial invariants", () => {
  it("validates saveFixture against safeToSaveSchema and holds arithmetic invariants", () => {
    const parsed = safeToSaveSchema.parse(saveFixture);
    const { incomeCents, regularCents, unexpectedCents, everydayCents } = parsed.usual;
    expect(incomeCents - regularCents - unexpectedCents - everydayCents).toBe(parsed.safeToSaveCents);
    expect(parsed.safeToSaveCents).toBe(1690);

    const view = viewSchema.parse(saveViewFixture);
    expect(view.activity.kind).toBe("save");
    expect(view.noticed?.rule).toBe("invest_over_left");
  });

  it("validates goal verdict fixtures and verifies stretch and out-of-reach counts", () => {
    const stretch = goalVerdictSchema.parse(stretchFixture);
    expect(stretch.verdict).toBe("stretch");
    expect(stretch.monthsInside).toBe(3);
    const insideCount = stretch.history.filter(h => h.inside).length;
    expect(insideCount).toBe(3);

    const outOfReach = goalVerdictSchema.parse(outOfReachFixture);
    expect(outOfReach.verdict).toBe("out_of_reach");
    expect(outOfReach.monthsInside).toBe(0);
    expect(outOfReach.lowestMonthCents).toBe(99581);
    expect(outOfReach.history.every(h => !h.inside)).toBe(true);

    const onTrack = goalVerdictSchema.parse(onTrackFixture);
    expect(onTrack.verdict).toBe("on_track");
    expect(onTrack.cutCents).toBe(0);

    // Validate full views
    expect(viewSchema.parse(stretchViewFixture).activity.kind).toBe("goal");
    expect(viewSchema.parse(outOfReachViewFixture).activity.kind).toBe("goal");
    expect(viewSchema.parse(onTrackViewFixture).activity.kind).toBe("goal");
  });

  it("validates profileFixture against analysisSchema and verifies 4/3/52=59 counts and sums", () => {
    const parsed = analysisSchema.parse(profileFixture);
    expect(parsed.kind).toBe("profile");
    expect(parsed.evidenceCount).toBe(59);
    expect(parsed.evidence.length).toBe(59);

    const regularRows = profileEvidence.filter(r => r.basket === "regular");
    const unexpectedRows = profileEvidence.filter(r => r.basket === "unexpected");
    const everydayRows = profileEvidence.filter(r => r.basket === "everyday");

    expect(regularRows.length).toBe(4);
    expect(unexpectedRows.length).toBe(3);
    expect(everydayRows.length).toBe(52);

    const regSum = regularRows.reduce((sum, r) => sum + r.amountCents, 0);
    const unexpSum = unexpectedRows.reduce((sum, r) => sum + r.amountCents, 0);
    const everySum = everydayRows.reduce((sum, r) => sum + r.amountCents, 0);

    expect(regSum).toBe(98719);
    expect(unexpSum).toBe(12507);
    expect(everySum).toBe(333652);
    expect(regSum + unexpSum + everySum).toBe(444878);

    const view = viewSchema.parse(profileViewFixture);
    expect(view.activity.kind).toBe("analysis");
    expect(view.noticed?.rule).toBe("month_over_usual");
  });
});
