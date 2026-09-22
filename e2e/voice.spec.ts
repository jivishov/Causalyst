import { test, expect } from "@playwright/test";

test("automatic voice completion uses the server deadline and keeps the connection open while finalizing", async ({ page }) => {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "student@test.invalid", is_anonymous: false, role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {} };
  await page.addInitScript((user) => {
    const token = `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600, email: user.email }))}.synthetic`;
    const session = { access_token: token, refresh_token: "synthetic-refresh", expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: "bearer", user };
    localStorage.setItem("alt-assessment.student-auth", JSON.stringify(session));
    (window as any).__peerClosed = false;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => ({ getAudioTracks: () => [{ enabled: true, stop() {} }], getTracks: () => [{ stop() {} }] }) });
    (window as any).RTCPeerConnection = class {
      ontrack = null;
      addTrack() {}
      createDataChannel() { return { addEventListener() {}, send() {}, close() {} }; }
      async createOffer() { return { type: "offer", sdp: "synthetic-offer" }; }
      async setLocalDescription() {}
      async setRemoteDescription() { await new Promise((resolve) => setTimeout(resolve, 1000)); }
      close() { (window as any).__peerClosed = true; }
    };
  }, user);
  await page.route("https://auth.test/**", (route) => route.fulfill({ json: { user } }));
  const assessment = { id: "assessment", type: "voice_realtime", title: "Deadline fixture", prompt: "Explain diffusion.", rubric: [{ name: "Reasoning", maxPoints: 10, description: "Explain" }], config: { maxSessionSec: 60 } };
  const assignment = { assignmentId: "assignment", assessment, classId: "course", classCode: "TEST", className: "Test course", opensAt: null, dueAt: null, state: "available", lifecycle: "available", dueState: "none", latestAttempt: null, publishedGrade: null, canStart: true };
  let finalizations = 0;
  let connectedAtFinalize = false;
  await page.route("http://127.0.0.1:8787/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    if (path === "/api/student/me") await route.fulfill({ headers, json: { profile: { id: user.id, displayName: "Student", email: user.email }, enrollmentStatus: "matched", courses: [{ classId: "course", classCode: "TEST", className: "Test course", assignments: [assignment] }] } });
    else if (path === "/api/attempts/start") await route.fulfill({ headers, json: { attemptId: "attempt", assignment } });
    else if (path === "/api/voice/realtime/connect") await route.fulfill({ headers, json: { sessionId: "session", sdpAnswer: "synthetic-answer", model: "synthetic", maxSessionSec: 60, expiresAt: new Date(Date.now() + 3500).toISOString() } });
    else if (path === "/api/voice/realtime/finalize") {
      finalizations++;
      connectedAtFinalize = await page.evaluate(() => !(window as any).__peerClosed);
      await route.fulfill({ headers, json: { attemptId: "attempt", transcript: "Student: synthetic audio", score: 80, feedback: null } });
    } else await route.fulfill({ headers, json: {} });
  });
  await page.goto("./assignment/assignment");
  await page.getByRole("button", { name: "Start live assessment" }).click();
  await expect.poll(() => finalizations, { timeout: 6500 }).toBe(1);
  await expect(page).toHaveURL(/\/attempt\/attempt$/);
  expect(connectedAtFinalize).toBe(true);
  expect(finalizations).toBe(1);
});
