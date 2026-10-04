import { test, expect, type Page } from "@playwright/test";
import type { AttemptResult, GradeFeedback, StudentPublishedGrade } from "@alt-assessment/shared";

const prompt = "A grassland food chain is: grass → grasshopper → frog → snake. Assume the producer trophic level contains 40,000 kJ of usable energy. Describe how energy changes between trophic levels. Your description must explicitly include: • the direction of the arrows; • the energy available at each level using the 10% rule; • the distinction between energy flow and matter cycling. Important: 10% is an approximation. Energy flows through ecosystems and is ultimately dissipated as heat, while matter is recycled.";
const description = "A trophic level pyramid of a grassland food chain shows energy flowing from grass (40,000 kJ) to grasshoppers (4,000 kJ), frogs (400 kJ), and snakes (40 kJ). Each arrow points from the food source to the consumer. The 10% rule is an approximate model of ecological energy transfer.\n\nOrganisms use most of the energy they consume for metabolism and other life processes, and energy is dissipated as heat. This leaves less energy available at higher trophic levels. Energy flows through the ecosystem; matter cycles through organisms, decomposers, and the environment.";
const feedback: GradeFeedback = { score: 82, overallComment: "Your energy values and arrow directions are clear. Explain the role of decomposers in matter cycling in more detail.", confidence: "high", reviewFlags: [], criteria: [{ name: "Scientific and quantitative accuracy", score: 5, maxPoints: 5, comment: "Energy values follow the approximate 10% transfer model." }, { name: "Causal reasoning", score: 2, maxPoints: 3, comment: "You connect lower energy availability to metabolism and heat loss." }, { name: "Scientific precision", score: 1.2, maxPoints: 2, comment: "Develop the explanation of matter cycling." }] };
const html = `<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;padding:34px;background:#fbfaf7;color:#362e27;font:16px system-ui}small{color:#8b7154}h1{font-size:26px;margin:8px 0 10px}p{color:#827362;line-height:1.6}article{display:flex;justify-content:space-between;align-items:center;padding:21px 24px;margin:10px 0;border-radius:9px;background:#f0e4d1}article:nth-of-type(2){background:#ead7b7}article:nth-of-type(3){background:#d3b587}article:nth-of-type(4){background:#b68e5e;color:white}strong{font-size:22px}span{display:block;font-size:12px;margin-top:5px}button{margin-top:14px;background:#493c32;color:white;border:0;border-radius:7px;padding:13px 18px;font:inherit}output{margin-left:16px;color:#6e5234;font-size:14px}</style></head><body><small>GRASSLAND ECOSYSTEM</small><h1>Follow the energy</h1><p>Explore the approximate 10% transfer of energy between trophic levels.</p><article><div>Grass<span>Producer</span></div><strong>40,000 kJ</strong></article><article><div>Grasshopper<span>Primary consumer</span></div><strong>4,000 kJ</strong></article><article><div>Frog<span>Secondary consumer</span></div><strong>400 kJ</strong></article><article><div>Snake<span>Tertiary consumer</span></div><strong>40 kJ</strong></article><button id="transfer">Transfer energy</button><output id="result">Ready to explore</output><script>document.getElementById("transfer").addEventListener("click",function(){document.getElementById("result").textContent="Next level: 4,000 kJ";});</script></body></html>`;

async function fixture(page: Page, overrides: Partial<AttemptResult> = {}) {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "student@test.invalid", is_anonymous: false, role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {} };
  await page.addInitScript(user => {
    const token = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." + btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, email: user.email })) + ".synthetic";
    localStorage.setItem("alt-assessment.student-auth", JSON.stringify({ access_token: token, refresh_token: "synthetic", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user }));
  }, user);
  await page.route("https://auth.test/**", route => route.fulfill({ json: { user } }));
  const result: AttemptResult = {
    attemptId: "saved", assignmentId: "energy", status: "submitted", assessment: { id: "energy", type: "simulation", title: "Unit 1 — Energy Pyramid: Follow the Energy", prompt, rubric: [{ name: "Scientific and quantitative accuracy", maxPoints: 5, description: "Represent the food chain, trophic roles, and approximate 10% transfer accurately." }, { name: "Causal reasoning", maxPoints: 3, description: "Explain why less energy is available at higher trophic levels." }, { name: "Scientific precision", maxPoints: 2, description: "Distinguish energy flow from matter cycling." }], config: {} },
    simulationDescription: description, transcript: null, ocrText: null, simulationSpec: null, provisionalScore: null, provisionalFeedback: null, publishedGrade: null, submittedAt: "2026-10-04T20:04:00Z",
    simulationPreview: { artifactId: "saved-html", previewPath: "/artifacts/saved-html/preview", previewToken: "synthetic-preview", outputKind: "html", htmlViewport: { width: 960, height: 680 } }, ...overrides
  };
  const requests = { previews: 0, mutations: 0 };
  const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  await page.route("http://127.0.0.1:8787/api/**", async route => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    if (route.request().method() !== "GET") requests.mutations++;
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/student/me") await route.fulfill({ headers, json: { profile: { id: user.id, displayName: "Student", email: user.email }, enrollmentStatus: "matched", courses: [{ classId: "course", classCode: "APES-2627", className: "AP Environmental Science", assignments: [{ assignmentId: "energy", classId: "course", classCode: "APES-2627", className: "AP Environmental Science", assessment: result.assessment, opensAt: null, dueAt: null, dueState: "none", state: result.publishedGrade ? "final_published" : "submitted", latestAttempt: { attemptId: "saved", status: result.status }, publishedGrade: result.publishedGrade }] }] } });
    else if (path === "/api/attempts/saved/result") await route.fulfill({ headers, json: result });
    else if (path === "/api/assignments/energy/final") await route.fulfill({ headers, json: { assignmentId: "energy", classId: "course", classCode: "APES-2627", className: "AP Environmental Science", opensAt: null, dueAt: null, assessment: result.assessment, publishedGrade: result.publishedGrade, latestAttempt: { attemptId: "saved", status: result.status } } });
    else if (path === "/api/artifacts/saved-html/preview") { requests.previews++; await route.fulfill({ headers, contentType: "text/html", body: html }); }
    else await route.fulfill({ headers, json: {} });
  });
  return { result, requests };
}

test("saved submission keeps interactive evidence through keyboard tabs and responsive layouts", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1640, height: 900 });
  const { requests } = await fixture(page);
  await page.goto("./attempt/saved");
  await expect(page.getByRole("tab", { name: "Your submission" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".submission-response-text")).toHaveText(description);
  const frame = page.frameLocator('iframe[title="Recovered simulation preview"]');
  await expect(frame.getByRole("heading", { name: "Follow the energy" })).toBeVisible();
  await expect(page.locator('iframe[title="Recovered simulation preview"]')).toHaveAttribute("sandbox", "allow-scripts");
  await page.screenshot({ path: testInfo.outputPath("submitted-assignment-desktop.png"), fullPage: true });
  await frame.getByRole("button", { name: "Transfer energy" }).click();
  await expect(frame.locator("output")).toHaveText("Next level: 4,000 kJ");
  const submission = page.getByRole("tab", { name: "Your submission" });
  await submission.focus();
  await submission.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Feedback" })).toBeFocused();
  await expect(page.getByText("Feedback has not been published yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rubric", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Feedback" }).press("ArrowRight");
  const instructions = page.getByLabel("Assignment instructions", { exact: true });
  await expect(instructions.locator("li")).toHaveCount(3);
  await expect(instructions).toContainText("40,000 kJ");
  await expect(instructions).toContainText("while matter is recycled.");
  await page.getByRole("tab", { name: "Assessment prompt", exact: true }).press("Home");
  await expect(frame.locator("output")).toHaveText("Next level: 4,000 kJ");
  expect(requests.previews).toBe(1);
  if (await page.getByRole("button", { name: "Expand preview" }).count()) {
    await page.getByRole("button", { name: "Expand preview" }).click();
    await expect(page.getByRole("button", { name: "Exit full screen" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Exit full screen" }).click();
    await expect(page.getByRole("button", { name: "Expand preview" })).toHaveAttribute("aria-pressed", "false");
    await expect(frame.locator("output")).toHaveText("Next level: 4,000 kJ");
  }
  for (const width of [1366, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".submission-response-text")).toHaveText(description);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width === 390) {
      const heading = await page.locator(".submission-heading").boundingBox();
      const header = await page.locator(".submission-header").boundingBox();
      expect(heading!.width).toBeGreaterThanOrEqual(header!.width - 45);
      await testInfo.attach("submission-mobile-layout", { contentType: "application/json", body: JSON.stringify(await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight },
        elements: ["html", "body", "#root", ".app-shell", ".content-shell", ".student-submission-page", ".simulation-preview-frame", ".simulation-preview-iframe"].map(selector => {
          const element = document.querySelector(selector)!;
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { selector, top: box.top, bottom: box.bottom, height: box.height, scrollHeight: element.scrollHeight, minHeight: style.minHeight, overflow: style.overflow, position: style.position };
        })
      }))) });
      await page.screenshot({ path: testInfo.outputPath("submitted-assignment-mobile.png"), fullPage: true });
    }
  }
  expect(requests.mutations).toBe(0);
});

test("published grades retain their distinction from provisional feedback", async ({ page }, testInfo) => {
  const publishedGrade: StudentPublishedGrade = { finalScore: 91, finalStatus: "teacher_override", publishedAt: "2026-10-04T21:00:00Z" };
  const { result } = await fixture(page, { status: "graded", provisionalScore: 82, provisionalFeedback: feedback, publishedGrade });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("./attempt/saved");
  await page.getByRole("tab", { name: "Feedback", exact: true }).click();
  await expect(page.getByLabel("Published final grade", { exact: true })).toContainText("Teacher Override");
  await expect(page.locator(".submission-grade-score strong")).toHaveText("91");
  await expect(page.getByRole("heading", { name: "Provisional Automated Feedback" })).toBeVisible();
  await expect(page.getByLabel("Score 82 percent")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("submitted-assignment-feedback.png"), fullPage: true });
  await page.getByRole("link", { name: "View final result", exact: true }).click();
  await expect(page.locator(".submission-grade-score strong")).toHaveText("91");
  await expect(page.getByRole("heading", { name: "Provisional Automated Feedback" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View submission evidence" })).toHaveAttribute("href", "/Causalyst/attempt/saved");
  result.publishedGrade = { finalScore: 82, finalStatus: "approved_ai", publishedAt: "2026-10-04T21:00:00Z", feedback };
  await page.goto("./final/energy");
  await expect(page.getByRole("heading", { name: "Published Feedback" })).toBeVisible();
  await expect(page.locator(".submission-grade-score strong")).toHaveText("82");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const heading = await page.locator(".submission-heading").boundingBox();
  const header = await page.locator(".submission-header").boundingBox();
  expect(heading!.width).toBeGreaterThanOrEqual(header!.width - 45);
  const score = await page.getByLabel("Score 82 percent").boundingBox();
  const feedbackTitle = await page.getByRole("heading", { name: "Published Feedback" }).boundingBox();
  expect(Math.abs(score!.y - feedbackTitle!.y)).toBeLessThan(2);
  await page.screenshot({ path: testInfo.outputPath("published-result-mobile.png"), fullPage: true });
  result.publishedGrade = { finalScore: null, finalStatus: "missing", publishedAt: "2026-10-04T21:00:00Z" };
  await page.goto("./final/energy");
  await expect(page.locator(".submission-grade-score strong")).toHaveText("Not scored");
  await expect(page.getByLabel("Published final grade", { exact: true })).toContainText("Missing");
  await expect(page.getByRole("heading", { name: "Published Feedback" })).toHaveCount(0);
});

test("writing and spoken submissions preserve line breaks without simulation controls", async ({ page }) => {
  const text = "My scientific explanation.\n\nEvidence and the revised question.";
  const { result } = await fixture(page, { simulationDescription: null, simulationPreview: null, ocrText: text });
  result.assessment.type = "writing";
  await page.goto("./attempt/saved");
  await expect(page.getByRole("heading", { name: "Transcribed Writing" })).toBeVisible();
  await expect(page.locator(".submission-response-text")).toHaveText(text);
  await expect(page.getByRole("button", { name: "Reload preview" })).toHaveCount(0);
  expect(await page.locator(".submission-response-text").evaluate(e => getComputedStyle(e).whiteSpace)).toBe("pre-wrap");
  result.assessment.type = "voice";
  result.ocrText = null;
  result.transcript = text;
  await page.goto("./attempt/saved");
  await expect(page.getByRole("heading", { name: "Transcript", exact: true })).toBeVisible();
  await expect(page.locator(".submission-response-text")).toHaveText(text);
});
