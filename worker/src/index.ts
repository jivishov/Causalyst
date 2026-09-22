import { runRetention } from "./lib/retention";
export { RealtimeEvidence } from "./lib/realtimeEvidence";
import { requireStudentAuth, requireTeacherAuthSession, requireUser, type AuthContext } from "./lib/auth";
import { corsHeaders, jsonResponse, toErrorResponse } from "./lib/http";
import { serviceSupabase } from "./lib/supabase";
import type { Env } from "./lib/env";
import { validateWorkerSecrets } from "./lib/env";
import { studentLogin, studentSession } from "./routes/student";
import { attemptResult, publishedFinalResult, startAttempt } from "./routes/attempts";
import { createUploadToken, previewArtifact, uploadArtifact } from "./routes/artifacts";
import { gradeVoiceAttempt } from "./routes/voice";
import { appendRealtimeVoiceEvents, connectRealtimeVoice, finalizeRealtimeVoice } from "./routes/voiceRealtime";
import { gradeWritingAttempt } from "./routes/writing";
import { cancelSimulationGenerationJob, fallbackSimulation, generateSimulation, generateSimulationSketch, getSimulationGenerationJob, refineSimulation, submitSimulation } from "./routes/simulation";
import {
  commitTeacherRosterImport,
  createTeacherCourse,
  deleteTeacherRoster,
  listTeacherCourses,
  listTeacherRoster,
  previewTeacherRosterImport,
  setTeacherCourseArchived,
  setupTeacher,
  teacherMe,
  teacherSetupStatus,
  updateTeacherCourse
} from "./routes/teacher";
import {
  archiveTeacherAssignment,
  archiveTeacherAssessment,
  createTeacherAssignment,
  createTeacherAssessment,
  listTeacherAssignments,
  listTeacherAssessments,
  unarchiveTeacherAssignment,
  unarchiveTeacherAssessment,
  updateTeacherAssignment,
  updateTeacherAssessment
} from "./routes/teacherAssessments";
import {
  downloadTeacherArtifact,
  listTeacherAttempts,
  previewTeacherArtifact,
  teacherAttemptDetail
} from "./routes/teacherReview";
import {
  approveTeacherAttemptScore,
  clearTeacherGradebookGrade,
  exportTeacherGradebook,
  listTeacherGradebook,
  markTeacherGradebookMissing,
  rebuildTeacherGradebook,
  setTeacherGradebookOverride,
  setTeacherGradebookPublished
} from "./routes/teacherGradebook";

export type RouteAuth = "public" | "student" | "teacher";

type Handler = (request: Request, env: Env, match: RegExpMatchArray) => Promise<Response> | Response;
type AuthenticatedHandler = (request: Request, env: Env, match: RegExpMatchArray, auth: AuthContext) => Promise<Response> | Response;

export interface RouteDefinition {
  method: string;
  path: string;
  pattern: RegExp;
  auth: RouteAuth;
  handler: Handler;
}

export interface RouteMetadata {
  method: string;
  path: string;
  auth: RouteAuth;
}

const routes: readonly RouteDefinition[] = [
  publicRoute("GET", "/api/health", /^\/api\/health$/, (request, env) => jsonResponse(request, env, { ok: true })),
  publicRoute("GET", "/api/teacher/setup-status", /^\/api\/teacher\/setup-status$/, (request, env) => {
    const db = serviceSupabase(env);
    return teacherSetupStatus(db).then((body) => jsonResponse(request, env, body));
  }),
  teacherRoute("POST", "/api/teacher/setup", /^\/api\/teacher\/setup$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await setupTeacher(request, env, db, auth.userId, auth.token, auth.email));
  }),
  teacherRoute("GET", "/api/teacher/me", /^\/api\/teacher\/me$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await teacherMe(env, db, auth.userId, auth.token, auth.email));
  }),
  teacherRoute("GET", "/api/teacher/courses", /^\/api\/teacher\/courses$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    return jsonResponse(request, env, await listTeacherCourses(db, auth.userId, includeArchived));
  }),
  teacherRoute("POST", "/api/teacher/courses", /^\/api\/teacher\/courses$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await createTeacherCourse(request, db, auth.userId));
  }),
  teacherRoute("GET", "/api/teacher/assessments", /^\/api\/teacher\/assessments$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    return jsonResponse(request, env, await listTeacherAssessments(db, auth.userId, includeArchived));
  }),
  teacherRoute("POST", "/api/teacher/assessments", /^\/api\/teacher\/assessments$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await createTeacherAssessment(request, db, auth.userId));
  }),
  teacherRoute("PUT", "/api/teacher/assessments/:assessmentId", /^\/api\/teacher\/assessments\/([^/]+)$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await updateTeacherAssessment(request, db, auth.userId, match[1]));
  }),
  teacherRoute("POST", "/api/teacher/assessments/:assessmentId/archive", /^\/api\/teacher\/assessments\/([^/]+)\/archive$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await archiveTeacherAssessment(db, auth.userId, match[1]));
  }),
  teacherRoute("POST", "/api/teacher/assessments/:assessmentId/unarchive", /^\/api\/teacher\/assessments\/([^/]+)\/unarchive$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await unarchiveTeacherAssessment(db, auth.userId, match[1]));
  }),
  teacherRoute("GET", "/api/teacher/assignments", /^\/api\/teacher\/assignments$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const courseId = url.searchParams.get("courseId") ?? undefined;
    return jsonResponse(request, env, await listTeacherAssignments(db, auth.userId, includeArchived, courseId));
  }),
  teacherRoute("GET", "/api/teacher/attempts", /^\/api\/teacher\/attempts$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await listTeacherAttempts(request, db, auth.userId));
  }),
  teacherRoute("GET", "/api/teacher/gradebook", /^\/api\/teacher\/gradebook$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await listTeacherGradebook(request, db, auth.userId));
  }),
  teacherRoute("POST", "/api/teacher/gradebook/export", /^\/api\/teacher\/gradebook\/export$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await exportTeacherGradebook(request, db, auth.userId));
  }),
  teacherRoute("POST", "/api/teacher/gradebook/rebuild", /^\/api\/teacher\/gradebook\/rebuild$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await rebuildTeacherGradebook(request, db, auth.userId));
  }),
  teacherRoute("POST", "/api/teacher/attempts/:attemptId/approve-score", /^\/api\/teacher\/attempts\/([^/]+)\/approve-score$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await approveTeacherAttemptScore(db, auth.userId, match[1]));
  }),
  teacherRoute("POST", "/api/teacher/gradebook/entries/:entryId/override", /^\/api\/teacher\/gradebook\/entries\/([^/]+)\/override$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await setTeacherGradebookOverride(request, db, auth.userId, match[1]));
  }),
  teacherRoute("POST", "/api/teacher/gradebook/entries/:entryId/missing", /^\/api\/teacher\/gradebook\/entries\/([^/]+)\/missing$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await markTeacherGradebookMissing(db, auth.userId, match[1]));
  }),
  teacherRoute("POST", "/api/teacher/gradebook/entries/:entryId/clear", /^\/api\/teacher\/gradebook\/entries\/([^/]+)\/clear$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await clearTeacherGradebookGrade(db, auth.userId, match[1]));
  }),
  teacherRoute("POST", "/api/teacher/gradebook/entries/:entryId/publish", /^\/api\/teacher\/gradebook\/entries\/([^/]+)\/publish$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await setTeacherGradebookPublished(db, auth.userId, match[1], true));
  }),
  teacherRoute("POST", "/api/teacher/gradebook/entries/:entryId/unpublish", /^\/api\/teacher\/gradebook\/entries\/([^/]+)\/unpublish$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await setTeacherGradebookPublished(db, auth.userId, match[1], false));
  }),
  teacherRoute("GET", "/api/teacher/attempts/:attemptId", /^\/api\/teacher\/attempts\/([^/]+)$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await teacherAttemptDetail(db, auth.userId, match[1]));
  }),
  teacherRoute("GET", "/api/teacher/artifacts/:artifactId/preview", /^\/api\/teacher\/artifacts\/([^/]+)\/preview$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return previewTeacherArtifact(request, env, db, auth.userId, match[1]);
  }),
  teacherRoute("GET", "/api/teacher/artifacts/:artifactId/download", /^\/api\/teacher\/artifacts\/([^/]+)\/download$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return downloadTeacherArtifact(request, env, db, auth.userId, match[1]);
  }),
  teacherRoute("POST", "/api/teacher/assignments", /^\/api\/teacher\/assignments$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await createTeacherAssignment(request, db, auth.userId));
  }),
  teacherRoute("PUT", "/api/teacher/assignments/:assignmentId", /^\/api\/teacher\/assignments\/([^/]+)$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await updateTeacherAssignment(request, db, auth.userId, match[1]));
  }),
  teacherRoute("POST", "/api/teacher/assignments/:assignmentId/archive", /^\/api\/teacher\/assignments\/([^/]+)\/archive$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await archiveTeacherAssignment(db, auth.userId, match[1]));
  }),
  teacherRoute("POST", "/api/teacher/assignments/:assignmentId/unarchive", /^\/api\/teacher\/assignments\/([^/]+)\/unarchive$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await unarchiveTeacherAssignment(db, auth.userId, match[1]));
  }),
  teacherRoute("POST", "/api/teacher/courses/:courseId/roster/preview", /^\/api\/teacher\/courses\/([^/]+)\/roster\/preview$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await previewTeacherRosterImport(request, db, auth.userId, match[1]));
  }),
  teacherRoute("POST", "/api/teacher/courses/:courseId/roster/commit", /^\/api\/teacher\/courses\/([^/]+)\/roster\/commit$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await commitTeacherRosterImport(request, env, db, auth.userId, match[1]));
  }),
  teacherRoute("GET", "/api/teacher/courses/:courseId/roster", /^\/api\/teacher\/courses\/([^/]+)\/roster$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await listTeacherRoster(db, auth.userId, match[1]));
  }),
  teacherRoute("POST", "/api/teacher/courses/:courseId/roster/delete", /^\/api\/teacher\/courses\/([^/]+)\/roster\/delete$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await deleteTeacherRoster(request, db, auth.userId, match[1]));
  }),
  teacherRoute("PUT", "/api/teacher/courses/:courseId", /^\/api\/teacher\/courses\/([^/]+)$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await updateTeacherCourse(request, db, auth.userId, match[1]));
  }),
  teacherRoute("POST", "/api/teacher/courses/:courseId/archive", /^\/api\/teacher\/courses\/([^/]+)\/archive$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await setTeacherCourseArchived(db, auth.userId, match[1], true));
  }),
  teacherRoute("POST", "/api/teacher/courses/:courseId/unarchive", /^\/api\/teacher\/courses\/([^/]+)\/unarchive$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await setTeacherCourseArchived(db, auth.userId, match[1], false));
  }),
  studentRoute("POST", "/api/student/login", /^\/api\/student\/login$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await studentLogin(request, env, db, auth.userId, auth.email as string));
  }),
  studentRoute("GET", "/api/student/me", /^\/api\/student\/me$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await studentSession(db, auth.userId, auth.email as string));
  }),
  studentRoute("POST", "/api/attempts/start", /^\/api\/attempts\/start$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await startAttempt(request, env, db, auth.userId));
  }),
  studentRoute("GET", "/api/attempts/:attemptId/result", /^\/api\/attempts\/([^/]+)\/result$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await attemptResult(db, env, auth.userId, match[1]));
  }),
  studentRoute("GET", "/api/assignments/:assignmentId/final", /^\/api\/assignments\/([^/]+)\/final$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await publishedFinalResult(db, auth.userId, match[1]));
  }),
  studentRoute("POST", "/api/artifacts/upload-token", /^\/api\/artifacts\/upload-token$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await createUploadToken(request, env, db, auth.userId));
  }),
  studentRoute("PUT", "/api/artifacts/:artifactId/upload", /^\/api\/artifacts\/([^/]+)\/upload$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await uploadArtifact(request, env, db, auth.userId, match[1]));
  }),
  studentRoute("GET", "/api/artifacts/:artifactId/preview", /^\/api\/artifacts\/([^/]+)\/preview$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return previewArtifact(request, env, db, auth.userId, match[1]);
  }),
  studentRoute("POST", "/api/voice/grade", /^\/api\/voice\/grade$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await gradeVoiceAttempt(request, env, db, auth.userId));
  }),
  studentRoute("POST", "/api/voice/realtime/connect", /^\/api\/voice\/realtime\/connect$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await connectRealtimeVoice(request, env, db, auth.userId));
  }),
  studentRoute("POST", "/api/voice/realtime/events", /^\/api\/voice\/realtime\/events$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await appendRealtimeVoiceEvents(request, db, auth.userId));
  }),
  studentRoute("POST", "/api/voice/realtime/finalize", /^\/api\/voice\/realtime\/finalize$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await finalizeRealtimeVoice(request, env, db, auth.userId));
  }),
  studentRoute("POST", "/api/writing/grade", /^\/api\/writing\/grade$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await gradeWritingAttempt(request, env, db, auth.userId));
  }),
  studentRoute("POST", "/api/simulation/sketch", /^\/api\/simulation\/sketch$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await generateSimulationSketch(request, env, db, auth.userId));
  }),
  studentRoute("POST", "/api/simulation/generate", /^\/api\/simulation\/generate$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await generateSimulation(request, env, db, auth.userId));
  }),
  studentRoute("POST", "/api/simulation/refine", /^\/api\/simulation\/refine$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await refineSimulation(request, env, db, auth.userId));
  }),
  studentRoute("POST", "/api/simulation/fallback", /^\/api\/simulation\/fallback$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await fallbackSimulation(request, env, db, auth.userId));
  }),
  studentRoute("GET", "/api/simulation/jobs/:jobId", /^\/api\/simulation\/jobs\/([^/]+)$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await getSimulationGenerationJob(request, env, db, auth.userId, match[1]));
  }),
  studentRoute("POST", "/api/simulation/jobs/:jobId/cancel", /^\/api\/simulation\/jobs\/([^/]+)\/cancel$/, async (request, env, match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await cancelSimulationGenerationJob(request, env, db, auth.userId, match[1]));
  }),
  studentRoute("POST", "/api/simulation/submit", /^\/api\/simulation\/submit$/, async (request, env, _match, auth) => {
    const db = serviceSupabase(env);
    return jsonResponse(request, env, await submitSimulation(request, env, db, auth.userId));
  })
];

export const routeMetadata: readonly RouteMetadata[] = routes.map(({ method, path, auth }) => ({ method, path, auth }));

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runRetention(serviceSupabase(env), env));
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      validateWorkerSecrets(env);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }

      const { pathname } = new URL(request.url);
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = pathname.match(route.pattern);
        if (match) return await route.handler(request, env, match);
      }

      return jsonResponse(request, env, { error: "Not found" }, { status: 404 });
    } catch (error) {
      return toErrorResponse(request, env, error);
    }
  }
};

export function publicRoute(method: string, path: string, pattern: RegExp, handler: Handler): RouteDefinition {
  return { method, path, pattern, auth: "public", handler };
}

export function studentRoute(method: string, path: string, pattern: RegExp, handler: AuthenticatedHandler): RouteDefinition {
  return { method, path, pattern, auth: "student", handler: withStudent(handler) };
}

export function teacherRoute(method: string, path: string, pattern: RegExp, handler: AuthenticatedHandler): RouteDefinition {
  return { method, path, pattern, auth: "teacher", handler: withTeacher(handler) };
}

function withStudent(handler: AuthenticatedHandler): Handler {
  return async (request, env, match) => {
    const auth = requireStudentAuth(await requireUser(request, env));
    return handler(request, env, match, auth);
  };
}

function withTeacher(handler: AuthenticatedHandler): Handler {
  return async (request, env, match) => {
    const auth = requireTeacherAuthSession(await requireUser(request, env));
    return handler(request, env, match, auth);
  };
}
