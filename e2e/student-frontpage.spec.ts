import { test, expect } from "@playwright/test";

test("student frontpage explains all formats, supports keyboard exploration, and works on small screens", async ({ page }, testInfo) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Explain your thinking. Build understanding." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
  await expect(page.getByRole("tab")).toHaveCount(4);
  await page.getByRole("tab", { name: /Writing/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText("upload your written work");
  await page.getByRole("tab", { name: /Writing/ }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Voice message/ })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("Record your explanation");
  await page.getByRole("tab", { name: /Voice message/ }).press("End");
  await expect(page.getByRole("tabpanel")).toContainText("live voice assessment");
  await page.getByLabel("Volume", { exact: true }).fill("50");
  await expect(page.getByTestId("example-pressure")).toHaveText("2.00×");
  await page.getByLabel("Volume", { exact: true }).fill("100");
  await expect(page.getByTestId("example-pressure")).toHaveText("1.00×");
  await page.getByRole("tab", { name: /Simulation/ }).click();
  await page.getByLabel("Volume", { exact: true }).fill("80");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  for (const width of [1366, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width === 1366 || width === 390) await page.screenshot({ path: testInfo.outputPath(`student-frontpage-${width}.png`), fullPage: true });
  }
  await expect(page.getByRole("link", { name: /For teachers/ })).toHaveAttribute("href", "/Causalyst/teacher");
});

test("frontpage preserves protected student routes and starts the existing Google OAuth flow", async ({ page }) => {
  await page.route("https://auth.test/**", route => route.fulfill({ contentType: "text/html", body: "<p>OAuth redirect fixture</p>" }));
  await page.goto("assignment/private-assignment");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
  const authorize = page.waitForRequest(request => request.url().includes("/auth/v1/authorize"));
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  const url = new URL((await authorize).url());
  expect(url.searchParams.get("provider")).toBe("google");
  expect(url.searchParams.get("redirect_to")).toContain("127.0.0.1:5173/Causalyst/");
  expect(url.searchParams.get("code_challenge")).toBeTruthy();
});
