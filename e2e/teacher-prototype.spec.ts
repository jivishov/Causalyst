import { test, expect } from "@playwright/test";

const prototype = "./prototypes/Causalyst_Teacher_UI_Demo.html";
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(prototype);
  await expect(page.getByRole("heading", { name: "Assessments", exact: true })).toBeVisible();
});

test("teacher demo keeps assessment edits and assigned settings after reload", async ({ page }, testInfo) => {
  const builder = page.locator(".builder-panel");
  const library = await page.locator(".library-panel").boundingBox();
  const editor = await builder.boundingBox();
  expect(editor!.x).toBeGreaterThanOrEqual(library!.x + library!.width);
  const title = await builder.getByRole("heading", { name: "Assessment Builder" }).boundingBox();
  const tabs = await builder.getByRole("group", { name: "Builder section" }).boundingBox();
  expect(Math.abs(title!.y + title!.height / 2 - tabs!.y - tabs!.height / 2)).toBeLessThan(5);
  await page.screenshot({ path: testInfo.outputPath("teacher-assessment-builder.png"), fullPage: true });
  await page.getByRole("button", { name: "Demo controls", exact: true }).click();
  const htmlDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download the HTML mockup/ }).click();
  expect((await htmlDownloadPromise).suggestedFilename()).toBe("Causalyst_Teacher_UI_Demo.html");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Assessment title", { exact: true }).fill("Atomic fingerprint — revised");
  await page.getByLabel("Student instructions", { exact: true }).fill("Use sodium to explain electron configuration, subshell occupancy, relative binding energy, and the limitations of a schematic spectrum.");
  await expect(page.locator("#save-message")).toHaveText("Unsaved changes");
  await builder.getByRole("button", { name: "Models", exact: true }).click();
  await expect(page.getByLabel("Use Fast processing for this assessment")).not.toBeChecked();
  await page.getByLabel("Reasoning effort", { exact: true }).selectOption("Medium");
  await page.getByLabel("Use Fast processing for this assessment").check();
  await expect(page.locator("#model-summary-preview")).toContainText("Medium reasoning · Fast on");
  await builder.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Assessment title", { exact: true })).toHaveValue("Atomic fingerprint — revised");
  await builder.getByRole("button", { name: "Models", exact: true }).click();
  await expect(page.getByLabel("Reasoning effort", { exact: true })).toHaveValue("Medium");
  await expect(page.getByLabel("Use Fast processing for this assessment")).toBeChecked();
  await builder.getByRole("button", { name: "Student preview", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Atomic fingerprint — revised");
  await expect(dialog).toContainText("Medium reasoning · Fast on");
  await dialog.getByRole("button", { name: "Close preview", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search assessments" }).fill("research");
  await expect(page.locator(".template-row")).toHaveCount(1);
  await expect(page.locator(".template-row")).toContainText("From finding to question");
});

test("teacher demo creates an assignment and publishes a reviewed grade", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Assign to class", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Class", { exact: true }).selectOption("apes");
  await dialog.getByLabel("Due date and time", { exact: true }).fill("2026-10-12T15:30");
  await dialog.getByRole("button", { name: "Assign in demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Assignments", exact: true })).toBeVisible();
  const row = page.locator("tbody tr").last();
  await expect(row).toContainText("Atomic fingerprint");
  await expect(row).toContainText("AP Environmental Science");
  await expect(row).toContainText("3:30");
  await page.locator(".nav").getByRole("link", { name: /Response review/ }).click();
  await expect(page.getByRole("heading", { name: "Response review", exact: true })).toBeVisible();
  await page.getByLabel("Scientific accuracy score", { exact: true }).fill("8");
  await page.getByLabel("Clear relationships score", { exact: true }).fill("6");
  await page.getByLabel("Testing and reflection score", { exact: true }).fill("6");
  await page.getByLabel("Feedback for the student", { exact: true }).fill("Your revised explanation correctly connects electron configuration, peak areas, and qualitative binding-energy order.");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.locator(".response-row.selected")).toContainText("Reviewed");
  await page.screenshot({ path: testInfo.outputPath("teacher-response-review.png"), fullPage: true });
  await page.getByRole("button", { name: "Publish feedback", exact: true }).click();
  await expect(dialog).toContainText("20 / 20");
  await dialog.getByRole("button", { name: "Publish in demo", exact: true }).click();
  await expect(page.locator(".response-row.selected")).toContainText("Published");
  await page.locator(".nav").getByRole("link", { name: "Gradebook", exact: true }).click();
  const published = page.locator("tbody tr").filter({ hasText: "Maya Rivera" });
  await expect(published).toContainText("100%");
  await expect(published).toContainText("Published");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export demo CSV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Causalyst_Demo_Gradebook.csv");
  await page.reload();
  await expect(page.locator("tbody tr").filter({ hasText: "Maya Rivera" })).toContainText("100%");
});

test("teacher demo responds to small screens and keeps model samples accurate", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByLabel("Student instructions", { exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(e => ({ tag: e.tagName, cls: e.className, right: e.getBoundingClientRect().right })) }));
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(width);
    if (width === 390) await page.screenshot({ path: testInfo.outputPath("teacher-mobile-builder.png"), fullPage: true });
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator(".nav").getByRole("link", { name: /Response review/ }).click();
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(page.getByRole("img", { name: /Preset sodium spectrum/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("teacher-model-review.png"), fullPage: true });
  await page.locator('[data-response="r2"]').click();
  await expect(page.getByText("No model preview in this sample", { exact: true })).toBeVisible();
  await expect(page.locator("#science-preview")).toHaveCount(0);
  expect(errors).toEqual([]);
});
