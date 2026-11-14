import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { viewSchema } from "../../src/shared/contracts";

const headers = { Origin: "http://localhost:3200" };
const questions = {
  pace: "Am I still on track?", usual: "What have I spent more on than usual?",
  profile: "What kind of spender am I?", taxi: "How much did I spend on taxis this year?",
  whatif: "What if I cut dining out by 20%?", days: "Which days pushed me over?", jar: "Show my jar",
};
test.use({ video: "on" });
test.beforeEach(async ({ page }) => {
  await page.route("**/api/speech", route => route.fulfill({ contentType: "audio/mpeg", body: readFileSync("tests/fixtures/reply.mp3") }));
  await page.route("**/api/voice/token", route => route.fulfill({ json: { token: "fixture-single-use", modelId: "scribe_v3_live" } }));
});

async function enter(page: Page, mute = true) {
  const loaded = page.waitForResponse(response => response.url().endsWith("/api/session") && response.request().method() === "GET");
  await page.goto("/");
  await loaded;
  await page.getByRole("button", { name: /Talk to Sponky/ }).click();
  await expect(page.locator(".coach-message")).toContainText("check-up");
  await expect(page.locator(".sp-coach-trigger")).toBeEnabled();
  if (mute) await page.getByRole("button", { name: "Sound on", exact: true }).click();
}

async function chip(page: Page, name: string) {
  await page.waitForTimeout(750); // Preserve the production per-session reasoning burst limit.
  const response = page.waitForResponse(response => response.url().endsWith("/api/coach"));
  await page.getByRole("button", { name, exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  return viewSchema.parse(await result.json());
}

async function installVoice(page: Page) {
  let transcript = "", chunks = 0;
  await page.routeWebSocket("wss://api.elevenlabs.io/**", socket => {
    setTimeout(() => socket.send(JSON.stringify({ message_type: "session_started" })), 25);
    socket.onMessage(message => {
      const chunk = JSON.parse(String(message));
      if (chunk.commit) socket.send(JSON.stringify({ message_type: "committed_transcript", text: transcript }));
      else { chunks++; socket.send(JSON.stringify({ message_type: "partial_transcript", text: "unfinished" })); }
    });
  });
  return async (text: string) => {
    transcript = text;
    await page.waitForTimeout(750);
    const trigger = page.locator(".sp-coach-trigger");
    await trigger.focus();
    const before = chunks;
    await page.keyboard.down("Space");
    await expect(page.locator(".sp-coach")).toHaveAttribute("data-state", "listening");
    await expect.poll(() => chunks).toBeGreaterThan(before);
    const response = page.waitForResponse(response => response.url().endsWith("/api/coach"));
    await page.keyboard.up("Space");
    return await response;
  };
}

test("welcome, weekly reward, jar, spoken necessity correction, undo and hidden reset", async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const say = await installVoice(page);
  const speech: object[] = [], spoken: string[] = [];
  page.on("request", request => {
    if (request.url().endsWith("/api/speech")) speech.push(request.postDataJSON());
    if (request.url().endsWith("/api/coach") && request.postDataJSON().action === "ask") spoken.push(request.postDataJSON().text);
  });
  await enter(page, false);
  await expect(page.getByRole("heading", { name: "Hey Matti" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect.poll(() => speech).toEqual([{ revision: 0, entry: true }]);
  await expect(page.locator(".sp-coach")).toHaveAttribute("data-state", "ready", { timeout: 8000 });
  expect(speech).toHaveLength(1); // Entry speech ends naturally and does not replay on rerender.
  await page.screenshot({ path: testInfo.outputPath("welcome.png"), fullPage: true });
  await page.getByRole("button", { name: "Sound on", exact: true }).click();
  const completed = await chip(page, "Let's do my check-up");
  expect(completed.checkup).toMatchObject({ streak: 3, completed: true, due: false,
    completedDates: ["2026-09-02", "2026-09-09", "2026-09-16"] });
  const reward = page.getByRole("button", { name: "3 weeks in a row. Check-up complete. Continue." });
  await expect(reward).toBeVisible();
  await expect(reward).toHaveAttribute("data-landed", "true");
  await page.screenshot({ path: testInfo.outputPath("weekly-reward.png"), fullPage: true });
  await reward.press("Enter");
  const jar = page.getByRole("region", { name: "September spending jar" });
  await expect(jar).toContainText(/912,29\s€ left/);
  await expect(jar.locator("[data-counter]")).toHaveText(/912,29/);
  await expect(page.getByLabel("3 week check-up streak")).toBeVisible();
  await expect(page.getByRole("button", { name: "Let's do my check-up", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Guess first|Confirm habit|Daily check-in/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("jar.png"), fullPage: true });

  const advanced = page.waitForResponse(response => response.url().endsWith("/api/coach"));
  await page.keyboard.press("n");
  expect(viewSchema.parse(await (await advanced).json())).toMatchObject({ demoDate: "2026-09-23",
    checkup: { streak: 3, completed: false, due: true }, jar: { spentCents: 232720, overCents: 12720 } });
  await expect(jar).toContainText(/127,20\s€ over the rim/);
  await expect(jar.locator("[data-counter]")).toHaveText(/127,20/);
  await page.screenshot({ path: testInfo.outputPath("over-limit.png"), fullPage: true });
  const days = await chip(page, questions.days);
  expect(days.jar.topDays).toEqual([{ date: "2026-09-21", amountCents: 35915, count: 4 }, { date: "2026-09-19", amountCents: 28004, count: 6 }]);
  await expect(page.getByRole("heading", { name: "The days that filled your jar" })).toBeVisible();
  await expect(page.locator(".sp-activities")).toContainText("177,96");
  const exactWords = "The 177,96 € payment on 2026-09-21 was necessary because of a burst pipe.";
  const correctedResponse = await say(exactWords);
  expect(correctedResponse.status()).toBe(200);
  const corrected = viewSchema.parse(await correctedResponse.json());
  expect(corrected).toMatchObject({ jar: { spentCents: 214924, leftCents: 5076, overCents: 0 },
    move: { transactionId: "row-2898396", amountCents: 17796, from: "everyday", to: "unexpected" } });
  expect(spoken).toEqual([questions.days, exactWords]);
  await expect(jar).toContainText(/50,76\s€ left/);
  await expect(jar.locator("[data-counter]")).toHaveText(/50,76/);
  await page.screenshot({ path: testInfo.outputPath("corrected.png"), fullPage: true });
  const undone = await chip(page, "Undo basket move");
  expect(undone.jar).toMatchObject({ spentCents: 232720, overCents: 12720 });
  expect(undone.move).toBeNull();
  await expect(jar.locator("[data-counter]")).toHaveText(/127,20/);
  await page.reload();
  await page.getByRole("button", { name: /Talk to Sponky/ }).click();
  await expect(page.getByLabel("3 week check-up streak")).toBeVisible();
  await expect(jar).toContainText(/127,20\s€ over the rim/);
  const reset = page.waitForResponse(response => response.url().endsWith("/api/session") && response.request().method() === "POST");
  await page.getByRole("heading", { name: "Sponky", exact: true }).hover();
  await page.mouse.down();
  await page.waitForTimeout(1250);
  await page.mouse.up();
  expect(viewSchema.parse(await (await reset).json())).toMatchObject({ revision: 0, demoDate: "2026-09-16",
    checkup: { due: true, streak: 2 }, jar: { spentCents: 128771, leftCents: 91229 }, move: null });
  await expect(page.getByRole("heading", { name: "Hey Matti" })).toBeVisible();
});

for (const order of [["usual", "pace"], ["pace", "usual"]] as const) {
test(`free questions in ${order.join(" then ")} order do not complete a week`, async ({ page }) => {
  await enter(page);
  for (const question of order) {
    const result = await chip(page, questions[question]);
    expect(result.activity.kind).toBe(question);
    expect(result.checkup).toMatchObject({ due: true, completed: false, streak: 2, completedDates: ["2026-09-02", "2026-09-09"] });
    await expect(page.getByLabel("2 week check-up streak")).toBeVisible();
    await expect(page.locator(".checkup-reward")).toHaveCount(0);
  }
  const advanced = page.waitForResponse(response => response.url().endsWith("/api/coach"));
  await page.locator(".checkup-heading time").click({ clickCount: 3, delay: 80 });
  expect(viewSchema.parse(await (await advanced).json())).toMatchObject({ demoDate: "2026-09-23",
    checkup: { due: true, completed: false, streak: 0, completedDates: ["2026-09-02", "2026-09-09"] }, jar: { overCents: 12720 } });
  await expect(page.getByRole("button", { name: questions.days, exact: true })).toBeVisible();
});
}

test("profile, taxi and six-month hypothetical reduction remain grounded direct answers", async ({ page }, testInfo) => {
  await enter(page);
  const profile = await chip(page, questions.profile);
  expect(profile.activity.kind).toBe("analysis");
  if (profile.activity.kind !== "analysis") throw new Error("Expected profile");
  expect(profile.activity.analysis.kind).toBe("profile");
  const taxi = await chip(page, questions.taxi);
  expect(taxi.activity.kind).toBe("reveal");
  if (taxi.activity.kind !== "reveal") throw new Error("Expected direct taxi result");
  expect(taxi.activity.spending.query).toMatchObject({ merchantType: "taxi", start: "2026-01-01", end: "2026-09-16" });
  expect(taxi.activity.spending).toMatchObject({ totalCents: 28337, evidenceCount: 6 });
  expect(taxi.activity.spending.evidence.every(row => row.category === "Transportation")).toBe(true);
  await expect(page.getByRole("button", { name: "Guess first", exact: true })).toHaveCount(0);
  const whatif = await chip(page, questions.whatif);
  expect(whatif.activity.kind).toBe("analysis");
  if (whatif.activity.kind !== "analysis") throw new Error("Expected hypothetical reduction");
  expect(whatif.activity.analysis.kind).toBe("whatif");
  const basis = whatif.activity.analysis.sections.find(section => section.label === "Projection basis: 2026-03-01 to 2026-08-31");
  expect(basis).toBeDefined();
  expect(basis?.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: "Monthly average (complete months)", amountCents: 18891 }),
    expect.objectContaining({ label: "Hypothetical monthly reduction (20%)", amountCents: 3778 }),
    expect.objectContaining({ label: "Hypothetical annual reduction (20%)", amountCents: 45336 }),
  ]));
  expect(whatif.checkup).toMatchObject({ due: true, streak: 2 });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Dark appearance", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("whatif-dark-360.png"), fullPage: true });
  const jar = await chip(page, questions.jar);
  expect(jar).toMatchObject({ activity: { kind: "jar" }, jar: { leftCents: 91229 }, checkup: { due: true, streak: 2 } });
});

test("provider failure and fabricated prose preserve suggestions, saved state and session isolation", async ({ page, context }) => {
  const say = await installVoice(page);
  await enter(page);
  const before = await (await page.request.get("/api/session")).json();
  for (const text of ["fabricated reply", "provider failure"]) {
    expect((await say(text)).status()).toBe(503);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("couldn't interpret");
    await expect(page.locator(".coach-message")).not.toContainText("saved 200");
    expect(await (await page.request.get("/api/session")).json()).toEqual(before);
    await expect(page.getByRole("button", { name: questions.pace, exact: true })).toBeEnabled();
  }
  const recovered = await chip(page, questions.pace);
  expect(recovered.activity.kind).toBe("pace");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  const fallbackResponse = await say("fabricated composition");
  expect(fallbackResponse.status()).toBe(200);
  const fallback = viewSchema.parse(await fallbackResponse.json());
  expect(fallback.activity).toMatchObject({ kind: "reveal", spending: { totalCents: 38472 } });
  await expect(page.locator(".coach-message")).not.toContainText(/99999|saved 200/);
  expect((await page.request.post("/api/coach", { headers, data: { action: "ask", revision: recovered.revision, text: "another customer", customerId: "CUST00002" } })).status()).toBe(400);
  expect((await page.request.post("/api/speech", { headers, data: { revision: recovered.revision, text: "Invented savings" } })).status()).toBe(400);
  expect((await context.cookies()).find(cookie => cookie.name === "__session")).toMatchObject({ httpOnly: true, sameSite: "Strict" });
  await context.clearCookies();
  const other = viewSchema.parse(await (await page.request.get("/api/session")).json());
  expect(other).toMatchObject({ revision: 0, demoDate: "2026-09-16", checkup: { streak: 2, due: true } });
});

test("startup failure retries with chip recovery instead of obsolete typing controls", async ({ page }) => {
  await page.route("**/api/session", () => {});
  await page.goto("/");
  await page.getByRole("button", { name: /Talk to Sponky/ }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Check your connection", { timeout: 20000 });
  await expect(page.locator(".coach-message")).not.toContainText("Opening");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.unroute("**/api/session");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: questions.pace, exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Sound on", exact: true }).click();
  expect((await chip(page, questions.pace)).activity.kind).toBe("pace");
});

test("outdated-session recovery creates a fresh session without destroying the previous saved week", async ({ page, context }) => {
  await enter(page);
  await chip(page, "Let's do my check-up");
  const previous = await (await page.request.get("/api/session")).json();
  const oldCookies = await context.cookies();
  for (const invalid of [{ headers, data: { confirmed: false } }, { headers: { Origin: "https://unrelated.example" }, data: { confirmed: true } }]) {
    expect((await page.request.post("/api/session", invalid)).ok()).toBe(false);
    expect(await (await page.request.get("/api/session")).json()).toEqual(previous);
  }
  await page.route("**/api/session", async route => {
    if (route.request().method() === "GET") await route.fulfill({ status: 409, json: { error: "This session uses an older demo dataset. Start a new browser session.", retryable: false } });
    else await route.continue();
  });
  await page.reload();
  await page.getByRole("button", { name: /Talk to Sponky/ }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("older demo dataset");
  await page.getByRole("button", { name: "Start fresh", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hey Matti" })).toBeVisible();
  await page.unroute("**/api/session");
  const fresh = await (await page.request.get("/api/session")).json();
  expect(fresh).toMatchObject({ revision: 0, checkup: { due: true, streak: 2 } });
  await context.addCookies(oldCookies);
  expect(await (await page.request.get("/api/session")).json()).toEqual(previous);
});

test("a lost weekly completion response cannot award the newer week on retry", async ({ page }) => {
  await enter(page);
  let loseResponse = true;
  await page.route("**/api/coach", async route => {
    if (loseResponse && route.request().postDataJSON().action === "weekly-checkup") {
      loseResponse = false;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Let's do my check-up", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  const saved = await (await page.request.get("/api/session")).json();
  const next = await page.request.post("/api/coach", { headers, data: { revision: saved.revision, action: "next-week" } });
  expect(next.status()).toBe(200);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Review the current answer");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  expect(await (await page.request.get("/api/session")).json()).toMatchObject({ demoDate: "2026-09-23",
    checkup: { due: true, completed: false, completedDates: ["2026-09-02", "2026-09-09", "2026-09-16"] } });
});
