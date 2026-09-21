import { afterEach, describe, expect, it, vi } from "vitest";

describe("student submission request timeouts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@supabase/supabase-js");
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps uploads and grading requests alive beyond the default API timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });

    const { gradeVoice, gradeWriting, uploadArtifact } = await importApiWithStudentSession();

    await expectLongRunningTimeout(() => uploadArtifact({
      artifactId: "artifact-1",
      uploadUrl: "https://worker.example/api/artifacts/artifact-1/upload",
      uploadToken: "upload-token"
    }, new Blob(["student work"], { type: "text/plain" })));

    await expectLongRunningTimeout(() => gradeVoice({
      attemptId: "attempt-voice",
      artifactId: "artifact-voice",
      browserTranscript: "student answer"
    }));

    await expectLongRunningTimeout(() => gradeWriting({
      attemptId: "attempt-writing",
      artifactId: "artifact-writing"
    }));

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

async function importApiWithStudentSession() {
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("VITE_WORKER_URL", "https://worker.example");
  vi.doMock("@supabase/supabase-js", () => ({
    createClient: vi.fn(() => ({
      auth: {
        exchangeCodeForSession: vi.fn(),
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        setSession: vi.fn(),
        signInWithOAuth: vi.fn(),
        signOut: vi.fn()
      }
    }))
  }));

  vi.stubGlobal("window", {
    history: { replaceState: vi.fn() },
    location: {
      href: "https://school.example/",
      origin: "https://school.example",
      pathname: "/"
    },
    localStorage: createStorage({
      "alt-assessment.student-auth": JSON.stringify({
        access_token: "student-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          email: "student@example.com",
          is_anonymous: false
        }
      })
    }),
    sessionStorage: createStorage()
  });

  return import("../src/lib/api");
}

async function expectLongRunningTimeout(startRequest: () => Promise<unknown>) {
  let settled = false;
  let rejection: unknown;
  const request = startRequest().then(
    () => {
      settled = true;
    },
    (error) => {
      settled = true;
      rejection = error;
    }
  );

  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(12_500);
  expect(settled).toBe(false);

  await vi.advanceTimersByTimeAsync(107_500);
  await request;
  expect(rejection).toBeInstanceOf(Error);
  expect((rejection as Error).message).toBe("Request timed out after 120s. Check Worker and Supabase status.");
}

function createStorage(entries: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(entries));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    }
  } as Storage;
}
