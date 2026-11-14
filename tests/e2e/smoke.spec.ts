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

test("an outdated session offers explicit recovery and retains the previous saved records", async ({ page, context }) => {
  await enter(page);
  const headers = { Origin: "http://localhost:3200" };
  const saved = await page.request.post("/api/coach", { headers, data: {
    action: "habit", revision: 0, confirmed: true,
    habit: { category: "Housing", action: "Review my housing costs", goal: "" },
  } });
  expect(saved.status()).toBe(200);
  const previous = await saved.json();
  const oldCookies = await context.cookies();
  for (const invalid of [
    { headers, data: { confirmed: false } },
    { headers: { Origin: "https://unrelated.example" }, data: { confirmed: true } },
  ]) {
    expect((await page.request.post("/api/session", invalid)).ok()).toBe(false);
    expect(await (await page.request.get("/api/session")).json()).toEqual(previous);
  }
  await page.route("**/api/session", async route => {
    if (route.request().method() === "GET") await route.fulfill({ status: 409, json: {
      error: "This session uses an older demo dataset. Start a new browser session.", retryable: false,
    } });
    else await route.continue();
  });
  await page.reload();
  await page.getByRole("button", { name: "Talk to Sponky" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("older demo dataset");
  await expect(page.locator(".coach-message")).not.toContainText("Opening");
  await page.getByRole("button", { name: "Back to entry" }).click();
  await page.getByRole("button", { name: "Talk to Sponky" }).click();
  await expect(page.getByRole("button", { name: "Start new demo session" })).toBeInViewport();
  await page.getByRole("button", { name: "Start new demo session" }).click();
  await expect(page.getByRole("button", { name: "Sponky. Hold to talk", exact: true })).toBeEnabled();
  await expect(page.locator(".coach-message")).toContainText("less mysterious");
  const fresh = await (await page.request.get("/api/session")).json();
  expect(fresh.revision).toBe(0);
  expect(fresh.habit).toBeNull();
  await context.addCookies(oldCookies);
  expect(await (await page.request.get("/api/session")).json()).toEqual(previous);
});

test("a stalled startup times out and retries without losing the typed draft", async ({ page }) => {
  await page.route("**/api/session", () => {});
  await page.goto("/");
  await page.getByRole("button", { name: "Talk to Sponky" }).click();
  await expect(page.locator(".coach-message")).toContainText("Opening");
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("My draft question");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Check your connection", { timeout: 20000 });
  await expect(page.locator(".coach-message")).not.toContainText("Opening");
  await page.unroute("**/api/session");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".coach-message")).toContainText("less mysterious");
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("My draft question");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
});

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
