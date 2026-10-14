import { z } from "zod";
import { requireUser, requireTeacherAuthSession } from "../lib/auth";
import type { Env } from "../lib/env";
import { readJson, HttpError } from "../lib/http";
import { serviceSupabase } from "../lib/supabase";
import {
  admitTeacher,
  capabilities,
  claim,
  command,
  digest,
  distribute,
  draftEvidence,
  evidence,
  guestState,
  listTemporary,
  publishSchema,
  publishTemporary,
  randomCapability,
  reissue,
  resultSchema,
  saveGrade,
  saveGuest,
  saveResult,
  temporaryDetail,
  temporaryFailure,
  temporarySite,
} from "../lib/temporary";

const uuid = z.string().uuid(),
  cookieName = "__Host-explain-guest";
const guestInput = z
  .object({
    text: z.string().max(32000),
    expectedVersion: z.number().int().nonnegative(),
    key: uuid,
    submit: z.boolean(),
  })
  .strict();
export function temporaryHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (request.headers.get("Origin") === temporarySite(env)) {
    headers.set("Access-Control-Allow-Origin", temporarySite(env));
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "Authorization,Content-Type,X-Explain-CSRF",
    );
  }
  return headers;
}
export async function temporaryHttp(
  request: Request,
  env: Env,
): Promise<Response> {
  const headers = temporaryHeaders(request, env);
  const send = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: new Headers([...headers, ["Content-Type", "application/json"]]),
    });
  try {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    const origin = request.headers.get("Origin");
    if (origin && origin !== temporarySite(env))
      throw temporaryFailure("ACCESS_REVOKED");
    const db = serviceSupabase(env),
      url = new URL(request.url),
      path = url.pathname;
    if (path.startsWith("/api/guest/")) {
      const api = new URL(env.TEMPORARY_API_ORIGIN ?? "https://api.explain.az");
      if (
        url.origin !== api.origin ||
        api.hostname.endsWith("workers.dev") ||
        api.protocol !== "https:"
      )
        throw temporaryFailure("UNAVAILABLE");
      if (request.method === "POST" && origin !== temporarySite(env))
        throw temporaryFailure("ACCESS_REVOKED");
      if (path === "/api/guest/exchange" && request.method === "POST") {
        const input = z
          .object({ publicId: uuid, token: z.string().regex(/^[a-f0-9]{64}$/) })
          .strict()
          .parse(await readJson(request));
        const credential = randomCapability(),
          hash = await digest(credential);
        const r = await command(db, "exchange", null, null, {
          publicId: input.publicId,
          tokenHash: await digest(input.token),
          sessionHash: hash,
        });
        headers.set(
          "Set-Cookie",
          `${cookieName}=${credential}; Path=/; Secure; HttpOnly; SameSite=Strict; Expires=${new Date(String(r.expiresAt)).toUTCString()}`,
        );
        return send({ csrf: await digest(`${credential}:csrf`) });
      }
      const cookie = request.headers
        .get("Cookie")
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1);
      if (!cookie || !/^[a-f0-9]{64}$/.test(cookie))
        throw temporaryFailure("ACCESS_REVOKED");
      const csrf = await digest(`${cookie}:csrf`),
        hash = await digest(cookie);
      const publicId = uuid.parse(url.searchParams.get("publicId"));
      if (path === "/api/guest/work" && request.method === "GET")
        return send({ ...(await guestState(db, hash, publicId)), csrf });
      if (path === "/api/guest/work" && request.method === "POST") {
        const supplied = request.headers.get("X-Explain-CSRF") ?? "";
        let mismatch = supplied.length ^ csrf.length;
        for (let i = 0; i < csrf.length; i++)
          mismatch |= (supplied.charCodeAt(i) || 0) ^ csrf.charCodeAt(i);
        if (mismatch !== 0) throw temporaryFailure("ACCESS_REVOKED");
        return send(
          await saveGuest(
            db,
            hash,
            guestInput.parse(await readJson(request)),
            publicId,
          ),
        );
      }
      throw temporaryFailure("NOT_FOUND");
    }
    const auth = requireTeacherAuthSession(await requireUser(request, env));
    await admitTeacher(db, auth);
    if (
      path === "/api/teacher/temporary/capabilities" &&
      request.method === "GET"
    )
      return send(await capabilities(db, auth));
    if (path === "/api/teacher/temporary" && request.method === "GET")
      return send(await listTemporary(db, auth));
    if (path === "/api/teacher/temporary/admin" && request.method === "GET")
      return send(
        await command(db, "admin_list", auth.userId, auth.sessionId ?? null),
      );
    if (path === "/api/teacher/temporary/admin" && request.method === "POST") {
      const b = z
        .discriminatedUnion("operation", [
          z
            .object({
              operation: z.literal("invite"),
              email: z.string().email().max(254),
              active: z.boolean(),
            })
            .strict(),
          z
            .object({
              operation: z.literal("settings"),
              enabled: z.boolean(),
              processingEnabled: z.boolean(),
              enforceAdmission: z.boolean(),
              maxHours: z.number().int().min(24).max(72),
            })
            .strict(),
        ])
        .parse(await readJson(request));
      return send(
        await command(
          db,
          `admin_${b.operation}`,
          auth.userId,
          auth.sessionId ?? null,
          b,
        ),
      );
    }
    if (path === "/api/teacher/temporary" && request.method === "POST")
      return send(
        await publishTemporary(
          db,
          auth,
          publishSchema.parse(await readJson(request)),
        ),
      );
    const m = path.match(
      /^\/api\/teacher\/temporary\/([a-f0-9-]{36})(?:\/(participants|reissue|revoke|evidence|draft-evidence|grade|claim|renew|release|result|retry))?$/i,
    );
    if (!m) throw temporaryFailure("NOT_FOUND");
    const assignmentId = uuid.parse(m[1]);
    if (!m[2] && request.method === "GET")
      return send(await temporaryDetail(db, auth, assignmentId));
    if (request.method !== "POST") throw temporaryFailure("NOT_FOUND");
    const b = await readJson<Record<string, unknown>>(request);
    switch (m[2]) {
      case "participants":
        return send(
          await distribute(
            db,
            auth,
            assignmentId,
            z
              .object({ count: z.number().int().min(1).max(40) })
              .strict()
              .parse(b).count,
            temporarySite(env),
          ),
        );
      case "reissue":
        return send(
          await reissue(
            db,
            auth,
            assignmentId,
            z.object({ participantId: uuid }).strict().parse(b).participantId,
            temporarySite(env),
          ),
        );
      case "revoke":
        return send(
          await command(db, "revoke", auth.userId, auth.sessionId ?? null, {
            assignmentId,
          }),
        );
      case "evidence":
        return send(
          await evidence(db, auth, {
            assignmentId,
            ...z
              .object({
                responseId: uuid,
                artifactId: uuid.nullable().optional(),
                gradeId: uuid.nullable().optional(),
              })
              .strict()
              .parse(b),
          }),
        );
      case "draft-evidence":
        return send(
          await draftEvidence(db, auth, {
            assignmentId,
            ...z
              .object({
                participantId: uuid,
                draftVersion: z.number().int().nonnegative(),
              })
              .strict()
              .parse(b),
          }),
        );
      case "retry":
        return send(
          await command(db, "retry", auth.userId, auth.sessionId ?? null, {
            assignmentId,
            ...z.object({ responseId: uuid }).strict().parse(b),
          }),
        );
      case "grade":
        return send(
          await saveGrade(db, auth, {
            assignmentId,
            ...z
              .object({
                responseId: uuid,
                artifactId: uuid.nullable(),
                score: z.number().min(0).max(100),
                comment: z.string().max(6000),
                expectedGradeVersion: z.number().int().min(0).max(20),
                key: uuid,
                approved: z.literal(true),
              })
              .strict()
              .parse(b),
          }),
        );
      case "claim":
        return send(
          await claim(db, auth, {
            assignmentId,
            ...z
              .object({ key: uuid, limit: z.number().int().min(1).max(3) })
              .strict()
              .parse(b),
          }),
        );
      case "renew":
      case "release":
        return send(
          await command(db, m[2], auth.userId, auth.sessionId ?? null, {
            assignmentId,
            ...z
              .object({
                jobId: uuid,
                responseId: uuid,
                fence: z.number().int().positive(),
              })
              .strict()
              .parse(b),
          }),
        );
      case "result":
        return send(
          await saveResult(
            db,
            auth,
            resultSchema.parse({ ...b, assignmentId }),
          ),
        );
      default:
        throw temporaryFailure("NOT_FOUND");
    }
  } catch (error) {
    const failure =
      error instanceof z.ZodError
        ? temporaryFailure("VALIDATION_FAILED")
        : error;
    const status = failure instanceof HttpError ? failure.status : 503;
    const code =
      failure instanceof HttpError && typeof failure.code === "string"
        ? failure.code
        : [401, 403].includes(status)
          ? "ACCESS_REVOKED"
          : status < 500
            ? "VALIDATION_FAILED"
            : "UNAVAILABLE";
    return send(
      {
        error: code.replaceAll("_", " "),
        code,
        retryable: [
          "RATE_LIMITED",
          "UNAVAILABLE",
          "REVISION_CONFLICT",
        ].includes(code),
      },
      status,
    );
  }
}
