import { expect, test, type Page } from "@playwright/test";

async function enter(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Talk to Sponky" }).click();
  await expect(page.locator(".coach-message")).toContainText("less mysterious");
  await page.getByRole("button", { name: "Sound on", exact: true }).click();
}
async function ask(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Message", exact: true });
  await box.fill(text);
  const response = page.waitForResponse(response => response.url().endsWith("/api/coach"));
  await box.press("Enter");
  return await (await response).json();
}

test("provider failure and fabricated prose preserve typing, saved state and session boundaries", async ({ page, context }) => {
  await enter(page);
  const before = await (await page.request.get("/api/session")).json();
  await ask(page, "fabricated reply");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("couldn't interpret");
  await expect(page.locator(".coach-message")).not.toContainText("saved 200");
  expect(await (await page.request.get("/api/session")).json()).toEqual(before);
  // The production per-session burst limit is intentionally preserved in E2E.
  await page.waitForTimeout(750);
  const direct = await ask(page, "August groceries, just show me");
  expect(direct.activity.spending.totalCents).toBe(111106);
  await expect(page.locator(".coach-message")).toContainText(/1\s111,06/);
  await page.waitForTimeout(750);
  await ask(page, "provider failure");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("couldn't interpret");
  expect((await (await page.request.get("/api/session")).json()).revision).toBe(direct.revision);
  await page.waitForTimeout(750);
  await ask(page, "I've had a long day");
  await expect(page.locator(".coach-message")).toContainText("We can skip the money talk");
  const headers = { Origin: "http://localhost:3200" };
  const forged = await page.request.post("/api/coach", { headers, data: { action: "ask", revision: direct.revision + 1, text: "another customer", customerId: "CUST00002" } });
  expect(forged.status()).toBe(400);
  const unconfirmed = await page.request.post("/api/coach", { headers, data: { action: "complete", revision: direct.revision + 1, reflection: "done" } });
  expect(unconfirmed.status()).toBe(400);
  const arbitrarySpeech = await page.request.post("/api/speech", { headers, data: { revision: direct.revision + 1, text: "Invented savings" } });
  expect(arbitrarySpeech.status()).toBe(400);
  const cookies = await context.cookies();
  expect(cookies.find(cookie => cookie.name === "__session")).toMatchObject({ httpOnly: true, sameSite: "Strict" });
  await context.clearCookies();
  const other = await (await page.request.get("/api/session")).json();
  expect(other.revision).toBe(0);
  expect(other.completedDates).toEqual([]);
});

test("phone visit keeps the answer hidden, corrects a scenario, and persists one check-in per date", async ({ page }, testInfo) => {
  await enter(page);
  await page.screenshot({ path: testInfo.outputPath("ready-light.png"), fullPage: true });
  const hidden = await ask(page, "August groceries");
  expect(hidden.activity.kind).toBe("invitation");
  expect(JSON.stringify(hidden)).not.toMatch(/1111|totalCents|evidence|MRC/);
  await expect(page.locator("body")).not.toContainText(/1\s111,06/);
  await page.getByRole("button", { name: "Guess first", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("guess-light.png"), fullPage: true });
  await page.getByRole("button", { name: "Lock in my guess", exact: true }).click();
  await expect(page.locator(".coach-message")).toContainText(/1\s111,06/);
  await expect(page.locator(".sp-amount [aria-hidden]")).toHaveText(/1\s111,06/);
  await page.screenshot({ path: testInfo.outputPath("reveal-light.png"), fullPage: true });
  await page.getByRole("button", { name: "Explore this", exact: true }).click();
  await page.getByText("Evidence & basket corrections (16)", { exact: true }).click();
  await page.getByLabel("Basket interpretation", { exact: true }).first().selectOption("regular");
  await page.getByRole("button", { name: "Confirm correction", exact: true }).click();
  await expect(page.locator(".coach-message")).toContainText("The amount stays the same");
  await expect(page.locator(".sp-basket[data-basket=regular]")).toContainText("79,90");
  await page.getByText("Evidence & basket corrections (16)", { exact: true }).click();
  await page.getByRole("button", { name: "Confirm what-if", exact: true }).click();
  await expect(page.locator(".coach-message")).toContainText("206,23");
  await expect(page.locator(".coach-message")).toContainText("hypothetical");
  await page.getByRole("button", { name: "Dark appearance", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("explore-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Keep an eye on it", exact: true }).click();
  await page.getByRole("textbox", { name: "Category", exact: true }).fill("Housing");
  await page.getByRole("textbox", { name: "My daily action", exact: true }).fill("Review my essential housing costs");
  await page.getByRole("button", { name: "Confirm habit", exact: true }).click();
  await expect(page.locator(".coach-message")).toContainText("Habit saved");
  await page.getByRole("button", { name: "Daily check-in", exact: true }).click();
  await expect(page.locator(".coach-message")).toContainText("903,42");
  await page.getByRole("radio", { name: "I’m just reflecting today", exact: true }).check();
  await page.getByRole("button", { name: "Complete check-in", exact: true }).click();
  await expect(page.locator(".sp-days")).toContainText("1 completed reflection day");
  await page.reload();
  await page.getByRole("button", { name: "Talk to Sponky" }).click();
  await page.getByRole("button", { name: "Sound on", exact: true }).click();
  await expect(page.locator(".sp-days")).toContainText("1 completed reflection day");
  await expect(page.getByRole("button", { name: "Complete check-in", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("complete-light.png"), fullPage: true });
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByRole("button", { name: "Advance simulated day", exact: true }).click();
  await expect(page.locator(".demo-date")).toContainText("2026-09-02");
  await expect(page.locator(".coach-message")).toContainText("no housing spending recorded");
  await page.getByRole("radio", { name: "I followed my action", exact: true }).check();
  await page.getByRole("button", { name: "Complete check-in", exact: true }).click();
  await expect(page.locator(".sp-days")).toContainText("2 completed reflection days");
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Dark appearance", exact: true }).click();
  await page.getByText("Demo controls", { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("no-spending-dark-360.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  expect(await page.locator(".sp-coach-motion").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
});

test("free-form breakdown shows scoped rows and a rejected writer still completes the turn", async ({ page }) => {
  await enter(page);
  const result = await ask(page, "Where did my money go in August?");
  expect(result.activity.kind).toBe("analysis");
  expect(result.activity.analysis.kind).toBe("breakdown");
  const rows = result.activity.analysis.sections.flatMap((section: { rows: { label: string; amountCents: number }[] }) => section.rows);
  expect(rows).toContainEqual(expect.objectContaining({ label: "Total spending", amountCents: 444878 }));
  expect(rows).toContainEqual(expect.objectContaining({ label: "Groceries", amountCents: 111106 }));
  expect(result.activity.analysis.evidenceCount).toBe(59);
  expect(result.activity.analysis.evidence).toHaveLength(40);
  await expect(page.locator(".sp-activities")).toContainText("2026-08-01");
  await expect(page.locator(".sp-activities")).toContainText(/4\s448,78/);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Dark appearance", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.waitForTimeout(750);
  const fallback = await ask(page, "fabricated composition");
  expect(fallback.activity.spending.totalCents).toBe(38472);
  await expect(page.locator(".coach-message")).toContainText("384,72");
  await expect(page.locator(".coach-message")).not.toContainText("99999");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.waitForTimeout(750);
  const whatif = await ask(page, "What if I cut restaurants by 20%?");
  expect(whatif.activity.analysis.kind).toBe("whatif");
  expect(whatif.activity.analysis.evidenceCount).toBe(30);
  await expect(page.locator(".sp-card p").filter({ hasText: /^Historical ·/ })).not.toContainText("30 transactions");
  await expect(page.getByRole("region", { name: "Projection basis: 2026-06-01 to 2026-08-31" })).toContainText("602,16");
  await expect(page.getByRole("region", { name: "Selected period: 2026-08-01 to 2026-08-31" })).toContainText("10 transactions");
});

for (const action of ["complete", "advance"] as const) {
  test(`a lost ${action} response never re-confirms the action on a newer date`, async ({ page }) => {
    await enter(page);
    const headers = { Origin: "http://localhost:3200" };
    const state = async () => await (await page.request.get("/api/session")).json();
    const mutate = async (payload: object) => {
      const current = await state();
      const response = await page.request.post("/api/coach", { headers, data: { revision: current.revision, ...payload } });
      expect(response.status()).toBe(200);
    };
    await mutate({ action: "habit", confirmed: true, habit: { category: "Housing", action: "Review my housing costs", goal: "" } });
    await mutate({ action: "checkin" });
    await page.reload();
    await page.getByRole("button", { name: "Talk to Sponky" }).click();
    await page.getByRole("button", { name: "Sound on", exact: true }).click();
    let loseResponse = true;
    await page.route("**/api/coach", async route => {
      if (loseResponse && route.request().postDataJSON().action === action) {
        loseResponse = false;
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    if (action === "complete") {
      await page.getByRole("radio", { name: "I followed my action", exact: true }).check();
      await page.getByRole("button", { name: "Complete check-in", exact: true }).click();
    } else {
      await page.getByText("Demo controls", { exact: true }).click();
      await page.getByRole("button", { name: "Advance simulated day", exact: true }).click();
    }
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    if (action === "complete") await mutate({ action: "advance", confirmed: true }); // A second tab.
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Review the current activity");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    const after = await state();
    expect(after.demoDate).toBe("2026-09-02");
    expect(after.completedDates).toEqual(action === "complete" ? ["2026-09-01"] : []);
    await expect(page.getByRole("button", { name: "Complete check-in", exact: true })).toBeDisabled();
  });
}
