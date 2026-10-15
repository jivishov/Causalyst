import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { buildTemporaryReport } from "../frontend/src/lib/temporaryReports";
import type { TemporaryReport } from "@alt-assessment/shared";
const assignment = {
  id: "10000000-0000-4000-8000-000000000001",
  publicId: "10000000-0000-4000-8000-000000000002",
  assessmentId: "10000000-0000-4000-8000-000000000003",
  publishedAt: "2026-10-14T12:00:00Z",
  closesAt: "2026-10-15T12:00:00Z",
  expiresAt: "2026-10-17T12:00:00Z",
};
const html =
  '<!doctype html><html><head></head><body><button id="play">Play</button><output id="value">0</output><script>document.getElementById("play").onclick=()=>{document.getElementById("value").textContent="1"}</script></body></html>';
const report: TemporaryReport = {
  assignment,
  question: {
    title: "Pressure model",
    prompt: "Explain volume and pressure.",
    rubric: [],
  },
  revision: {
    id: "r1",
    participantId: "p1",
    code: "P01-ABCD",
    revision: 1,
    submittedAt: "2026-10-14T12:01:00Z",
    status: "ready",
    artifactId: "s1",
    gradeId: null,
  },
  response:
    "At constant temperature, pressure increases when volume decreases.\nŞ α </p><script>window.bad=true</script>",
  simulation: {
    html,
    model: null,
    client: null,
    assumptions: [],
    generatedAt: "2026-10-14T12:05:00Z",
  },
  grade: null,
};
test("downloaded report runs with networking disabled, preserving source and reset", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  const requests: string[] = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  const reportFile = testInfo.outputPath("standalone-report.html");
  await mkdir(dirname(reportFile), { recursive: true });
  await writeFile(
    reportFile,
    buildTemporaryReport(
      report,
      "2026-10-14T13:00:00Z",
      "<script>window.bad=true</script>",
    ),
    "utf8",
  );
  await page.goto(pathToFileURL(reportFile).href);
  await expect(page.locator("#response")).toHaveText(report.response);
  await expect(page.locator("#source")).toHaveText(html);
  await page
    .frameLocator("#simulation")
    .getByRole("button", { name: "Play" })
    .click();
  await expect(page.frameLocator("#simulation").locator("#value")).toHaveText(
    "1",
  );
  await page.getByRole("button", { name: "Reset simulation" }).click();
  await expect(page.frameLocator("#simulation").locator("#value")).toHaveText(
    "0",
  );
  expect(await page.evaluate(() => Reflect.get(window, "bad"))).toBeUndefined();
  expect(requests).toEqual([]);
});
test("guest deep link and refresh remain outside student login", async ({
  page,
}) => {
  let exchanges = 0;
  const state = {
    assignment,
    question: report.question,
    code: "P01-ABCD",
    draft: "Saved draft explanation",
    draftVersion: 1,
    latest: null,
    simulation: null,
    csrf: "synthetic-csrf",
  };
  await page.route("https://api.explain.az/api/guest/**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers": "content-type,x-explain-csrf",
        },
      });
    const exchange = route.request().url().includes("exchange");
    if (exchange) exchanges++;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify(exchange ? { csrf: state.csrf } : state),
    });
  });
  await page.goto(`s/${assignment.publicId}#${"a".repeat(64)}`);
  await expect(
    page.getByRole("heading", { name: "Pressure model" }),
  ).toBeVisible();
  await expect(
    page.getByLabel(
      "Describe the process and the relationships you want to test.",
    ),
  ).toHaveValue(state.draft);
  expect(page.url()).not.toContain("#");
  expect(page.url()).not.toContain("login");
  expect(exchanges).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Pressure model" }),
  ).toBeVisible();
  expect(exchanges).toBe(1);
  await page.screenshot({
    path: "test-results/temporary-guest-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
