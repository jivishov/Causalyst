import { test, expect } from "@playwright/test";

test("compact student pages preserve assignment information and instructions", async ({ page }, testInfo) => {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "student@test.invalid", is_anonymous: false, role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {} };
  await page.addInitScript((user) => {
    const token = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." + btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, email: user.email })) + ".synthetic";
    localStorage.setItem("alt-assessment.student-auth", JSON.stringify({ access_token: token, refresh_token: "synthetic", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user }));
  }, user);
  await page.route("https://auth.test/**", route => route.fulfill({ json: { user } }));
  const prompt = "Choose a neutral atom with 10–20 electrons. Your description must explicitly include: • the electron configuration using 1s, 2s, 2p; • the electrons in each occupied subshell; • relative PES peak positions and areas. Important: use energy levels and electron–nucleus attraction. Submit only after inspecting the final simulation.";
  const assignments = [
    { assignmentId: "voice", assessment: { id: "voice", type: "voice", title: "Chemical nomenclature", prompt: "Pronounce NaCl and H2SO4.", rubric: [], config: {} }, state: "draft" },
    { assignmentId: "simulation", assessment: { id: "simulation", type: "simulation", title: "Unit 1 — Atomic Fingerprint: Electron Configuration & PES", prompt, rubric: [], config: {} }, state: "draft" },
    { assignmentId: "writing", assessment: { id: "writing", type: "writing", title: "Finding-to-Question: Building Testable Scientific Questions", prompt: "Complete each section. 1. Main finding: State the finding. 2. Evidence: List two details. 3. Final question: Revise your question. Preserve the 1.5 mol quantity.", rubric: [], config: {} }, state: "draft" },
    { assignmentId: "gas", assessment: { id: "gas", type: "simulation", title: "Gas Laws", prompt: "Describe a real-life application of a gas law.", rubric: [], config: {} }, state: "submitted" }
  ].map(a => ({ ...a, classId: "course", classCode: "APCHEM-2627", className: "AP CHEMISTRY", opensAt: null, dueAt: "2026-05-26T23:59:00Z", dueState: a.state === "submitted" ? "none" : "overdue", latestAttempt: { attemptId: "attempt-" + a.assignmentId, status: a.state }, publishedGrade: null }));
  const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  await page.route("http://127.0.0.1:8787/api/**", async route => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/student/me") {
      await route.fulfill({ headers, json: { profile: { id: user.id, displayName: "Student", email: user.email }, enrollmentStatus: "matched", courses: [{ classId: "course", classCode: "APCHEM-2627", className: "AP CHEMISTRY", assignments }] } });
    } else if (path === "/api/attempts/start") {
      const assignment = assignments.find(a => a.assignmentId === route.request().postDataJSON()?.assignmentId)!;
      await route.fulfill({ headers, json: { attemptId: "attempt-" + assignment.assignmentId, assignment } });
    } else await route.fulfill({ headers, json: {} });
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "My assignments", exact: true })).toBeVisible();
  await expect(page.locator(".student-assignment-card")).toHaveCount(4);
  const header = await page.locator(".student-dashboard-header").boundingBox();
  expect(header!.height).toBeLessThanOrEqual(65);
  const firstCard = await page.locator(".student-assignment-card").first().boundingBox();
  expect(firstCard!.height).toBeLessThan(200);
  await expect(page.getByRole("link", { name: /Continue my work/ })).toBeVisible();
  const filtersBox = await page.getByRole("group", { name: "Filter assignments" }).boundingBox();
  expect(Math.abs(header!.y - filtersBox!.y)).toBeLessThan(10);
  await page.screenshot({ path: testInfo.outputPath("compact-student-dashboard.png") });
  await page.getByRole("button", { name: /To do/ }).click();
  await expect(page.locator(".student-assignment-card")).toHaveCount(3);
  await page.getByRole("button", { name: /Submitted/ }).click();
  await expect(page.locator(".student-assignment-card")).toHaveCount(1);
  await page.getByRole("button", { name: /All assignments/ }).click();
  await page.getByRole("searchbox", { name: "Search assignments" }).fill("Atomic Fingerprint");
  await expect(page.locator(".student-assignment-card")).toHaveCount(1);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.locator(".student-assignment-prompt")).toHaveText(prompt);
  await page.getByRole("button", { name: "Less", exact: true }).click();
  await expect(page.getByRole("button", { name: "More", exact: true })).toHaveAttribute("aria-expanded", "false");

  for (const width of [1366, 1024, 390]) {
    await page.setViewportSize({ width, height: 768 });
    await page.goto("./");
    await expect(page.locator(".student-assignment-card")).toHaveCount(4);
    await expect(page.getByText("4 assessments", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const id of ["simulation", "writing"]) {
      await page.goto(`./assignment/${id}`);
      const instructions = page.getByLabel("Assignment instructions", { exact: true });
      await expect(instructions.locator("li")).toHaveCount(3);
      // Instructions must use the available width instead of a character cap
      // or narrow columns that wrap sentences while leaving room on the right.
      const textLayout = await instructions.evaluate(element => {
        const width = element.getBoundingClientRect().width;
        return { width, paragraphs: [...element.querySelectorAll("p")].map(p => ({
          width: p.getBoundingClientRect().width,
          whiteSpace: getComputedStyle(p).whiteSpace
        })), items: [...element.querySelectorAll("li")].map(li => li.getBoundingClientRect().width) };
      });
      for (const p of textLayout.paragraphs) {
        expect(p.width).toBeGreaterThanOrEqual(textLayout.width - 1);
        expect(p.whiteSpace).toBe("normal");
      }
      for (const itemWidth of textLayout.items) expect(itemWidth).toBeGreaterThanOrEqual(textLayout.width - 24);
      await expect(page.locator(".assessment-course-context")).toHaveText("APCHEM-2627 · AP CHEMISTRY");
      if (id === "simulation") {
        await expect(instructions).toContainText("1s, 2s, 2p");
        await expect(instructions).toContainText("Submit only after inspecting the final simulation.");
      } else {
        await expect(instructions).toContainText("Preserve the 1.5 mol quantity.");
      }
      const overflow = await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll("body *")].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right}))}));
      expect(overflow.scroll, JSON.stringify({id,...overflow})).toBeLessThanOrEqual(width);
      if (width === 1366) await page.screenshot({ path: testInfo.outputPath(`compact-${id}-prompt.png`) });
    }
  }
});
