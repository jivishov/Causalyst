import { test, expect } from "@playwright/test";

test("student frontpage explains all formats, supports keyboard exploration, and works on small screens", async ({ page }, testInfo) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Explain your thinking. See your ideas. Deepen your understanding." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
  await expect(page.getByRole("tab")).toHaveCount(4);
  await page.getByRole("tab", { name: /Writing/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText("upload your written work");
  await page.getByRole("tab", { name: /Writing/ }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Voice message/ })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("Record your explanation");
  await page.getByRole("tab", { name: /Voice message/ }).press("End");
  await expect(page.getByRole("tabpanel")).toContainText("live voice assessment with AI");
  await page.getByLabel("Volume", { exact: true }).fill("50");
  await expect(page.getByTestId("example-pressure")).toHaveText("2.00×");
  await page.getByLabel("Volume", { exact: true }).fill("100");
  await expect(page.getByTestId("example-pressure")).toHaveText("1.00×");
  await page.getByRole("tab", { name: /Simulation/ }).click();
  await page.getByLabel("Volume", { exact: true }).fill("100");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  for (const width of [1366, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width === 1366 || width === 390) await page.screenshot({ path: testInfo.outputPath(`student-frontpage-${width}.png`), fullPage: true });
  }
  await expect(page.getByRole("link", { name: /For teachers/ })).toHaveAttribute("href", "/Causalyst/teacher");
});

test("gas preview keeps a fixed cylinder and rigid piston while obeying Boyle's law", async ({ page }, testInfo) => {
  await page.goto("./");
  await expect(page.getByTestId("example-pressure")).toHaveText("1.00×");
  const geometry = () => page.evaluate(() => {
    const svg = (id: string) => document.querySelector(`[data-testid="${id}"]`) as SVGGraphicsElement;
    const cylinder = svg("gas-cylinder").getBBox();
    const chamber = svg("gas-chamber").getBBox();
    const piston = svg("gas-piston");
    const pistonX = (piston as SVGGElement).transform.baseVal.getItem(0).matrix.e;
    const particles = [...document.querySelectorAll<SVGCircleElement>(".frontpage-gas-particle")];
    return {
      cylinder: { x: cylinder.x, y: cylinder.y, width: cylinder.width, height: cylinder.height },
      width: chamber.width, height: chamber.height, pistonX,
      rodLength: svg("gas-piston-rod").getBBox().width,
      handleX: pistonX + svg("gas-piston-handle").getBBox().x,
      amount: particles.length,
      contained: particles.every(p => p.cx.baseVal.value - p.r.baseVal.value >= chamber.x - 1e-6 &&
        p.cx.baseVal.value + p.r.baseVal.value <= chamber.x + chamber.width + 1e-6 &&
        p.cy.baseVal.value - p.r.baseVal.value >= chamber.y - 1e-6 &&
        p.cy.baseVal.value + p.r.baseVal.value <= chamber.y + chamber.height + 1e-6)
    };
  });
  const reference = await geometry();
  for (const [volume, pressure] of [[69,"1.45×"],[50,"2.00×"],[35,"2.86×"],[80,"1.25×"],[100,"1.00×"]] as const) {
    await page.getByLabel("Volume", { exact: true }).fill(String(volume));
    await expect(page.getByTestId("example-pressure")).toHaveText(pressure);
    const state = await geometry();
    expect(state.cylinder).toEqual(reference.cylinder);
    expect(state.height).toBe(reference.height);
    expect(state.width / reference.width).toBeCloseTo(volume / 100, 5);
    expect(state.rodLength).toBe(reference.rodLength);
    expect(state.handleX - reference.handleX).toBeCloseTo(state.pistonX - reference.pistonX, 5);
    expect(state.handleX).toBeGreaterThan(state.cylinder.x + state.cylinder.width);
    expect(state.amount).toBe(reference.amount);
    expect(state.contained).toBe(true);
  }
  const particlePositions = () => page.locator(".frontpage-gas-particle").evaluateAll(nodes => nodes.map(n => [n.getAttribute("cx"), n.getAttribute("cy")]));
  const moving = await particlePositions();
  await expect.poll(particlePositions).not.toEqual(moving);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const paused = await particlePositions();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await particlePositions()).toEqual(paused);
  await page.getByLabel("Volume", { exact: true }).fill("50");
  await expect(page.getByTestId("example-pressure")).toHaveText("2.00×");
  expect((await geometry()).contained).toBe(true);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.getByRole("complementary", { name: "Interactive simulation example" }).screenshot({ path: testInfo.outputPath("gas-preview-50.png") });
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
