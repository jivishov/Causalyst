import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { GuestState } from "@alt-assessment/shared";
import { ExplainLogo } from "../components/ExplainLogo";
import { temporaryApi, TemporaryRequestError } from "../lib/temporaryApi";
import "../temporary.css";

export function GuestAssignmentPage() {
  const { publicId } = useParams(),
    [state, setState] = useState<GuestState | null>(null),
    [text, setText] = useState(""),
    [message, setMessage] = useState("Opening your assignment…"),
    [error, setError] = useState(""),
    [terminal, setTerminal] = useState(false),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(""),
    [saveFailed, setSaveFailed] = useState(false);
  const workPath = `/api/guest/work?publicId=${encodeURIComponent(publicId ?? "")}`;
  const boot = useRef<Promise<GuestState> | null>(null),
    version = useRef(0),
    saved = useRef(""),
    csrf = useRef(""),
    saving = useRef(false),
    submitKey = useRef(crypto.randomUUID());
  useEffect(() => {
    boot.current ??= (async () => {
      const token = window.location.hash.slice(1);
      let exchangedCsrf: string | undefined;
      if (token) {
        const exchanged = await temporaryApi<{ csrf: string }>(
          "/api/guest/exchange",
          { publicId, token },
          true,
        );
        exchangedCsrf = exchanged.csrf;
        history.replaceState(null, "", window.location.pathname);
      }
      const next = await temporaryApi<GuestState>(
        workPath,
        undefined,
        true,
        exchangedCsrf,
      );
      if (exchangedCsrf && next.csrf !== exchangedCsrf)
        throw new TemporaryRequestError("ACCESS_REVOKED");
      return next;
    })();
    let alive = true;
    boot.current
      .then((s) => {
        if (alive) {
          setState(s);
          setText(s.draft);
          saved.current = s.draft;
          version.current = s.draftVersion;
          csrf.current = s.csrf;
          setMessage("Saved");
        }
      })
      .catch((e) => {
        if (alive) {
          setError(
            e instanceof TemporaryRequestError && e.code === "ACCESS_REVOKED"
              ? "This private link is unavailable. Ask your teacher to reissue it."
              : "This assignment is unavailable or has expired.",
          );
          setTerminal(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [publicId]);
  useEffect(() => {
    if (!state?.simulation?.html) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(
      new Blob([state.simulation.html], { type: "text/html" }),
    );
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [state?.simulation?.html]);
  function requireSameSession(next: GuestState) {
    if (next.csrf !== csrf.current)
      throw new TemporaryRequestError("ACCESS_REVOKED");
  }
  async function save(submit = false) {
    if (saving.current || terminal || !state) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setMessage(submit ? "Submitting…" : "Saving…");
    const sent = text;
    try {
      await temporaryApi(
        workPath,
        {
          text: sent,
          expectedVersion: version.current,
          key: submitKey.current,
          submit,
        },
        true,
        csrf.current,
      );
      const next = await temporaryApi<GuestState>(
        workPath,
        undefined,
        true,
        csrf.current,
      );
      requireSameSession(next);
      version.current = next.draftVersion;
      saved.current = sent;
      setState(next);
      setSaveFailed(false);
      setMessage(
        submit ? "Submitted. Waiting for teacher processing." : "Saved",
      );
      if (submit) submitKey.current = crypto.randomUUID();
    } catch (e) {
      setSaveFailed(true);
      if (
        e instanceof TemporaryRequestError &&
        ["ASSIGNMENT_EXPIRED", "ACCESS_REVOKED"].includes(e.code)
      )
        setTerminal(true);
      if (
        e instanceof TemporaryRequestError &&
        e.code === "REVISION_CONFLICT"
      ) {
        const next = await temporaryApi<GuestState>(
          workPath,
          undefined,
          true,
          csrf.current,
        ).catch(() => null);
        if (next && next.csrf === csrf.current) {
          version.current = next.draftVersion;
        }
      }
      setMessage("Not saved");
      setError(
        `${e instanceof Error ? e.message : "Save failed"}. Your text is still on this page. Retry saving or ask your teacher for help.`,
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!state || terminal || busy || saveFailed || text === saved.current)
      return;
    setMessage("Unsaved changes");
    const t = setTimeout(() => {
      void save();
    }, 1600);
    return () => clearTimeout(t);
  }, [text, state?.draftVersion, busy, terminal, saveFailed]);
  useEffect(() => {
    if (!state || terminal) return;
    let stopped = false,
      t: ReturnType<typeof setTimeout>;
    let delay = 8000;
    async function poll() {
      if (stopped) return;
      if (!document.hidden && !saving.current) {
        try {
          const next = await temporaryApi<GuestState>(
            workPath,
            undefined,
            true,
            csrf.current,
          );
          requireSameSession(next);
          if (!stopped) {
            setState(next);
          }
          delay = 8000;
        } catch (e) {
          delay = Math.min(60000, delay * 2);
          if (
            e instanceof TemporaryRequestError &&
            ["ASSIGNMENT_EXPIRED", "ACCESS_REVOKED"].includes(e.code)
          ) {
            setTerminal(true);
            setError(
              "This private session has ended or changed. Reopen your own link or ask your teacher for help.",
            );
            return;
          }
        }
      }
      t = setTimeout(() => {
        void poll();
      }, delay);
    }
    t = setTimeout(() => {
      void poll();
    }, delay);
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }, [!!state, terminal]);
  const status = state?.latest?.status;
  const statusText =
    status === "ready"
      ? "Ready to explore"
      : status === "processing"
        ? "Processing in your teacher’s connected AI client"
        : status === "failed"
          ? "Generation needs attention. Your explanation is saved; ask your teacher to retry."
          : status === "queued"
            ? "Waiting for teacher processing"
            : "Write your explanation, then submit it.";
  return (
    <main className="temporary-guest">
      <header className="temporary-header">
        <ExplainLogo />
        <span>{state?.code ?? "Private assignment"}</span>
      </header>
      {error && (
        <p className="temporary-error" role="alert">
          {error}
        </p>
      )}
      {!state ? (
        <p role="status">{terminal ? "Assignment unavailable" : message}</p>
      ) : (
        <>
          <div className="temporary-deadlines">
            <span>
              Submissions close{" "}
              {new Date(state.assignment.closesAt).toLocaleString()}
            </span>
            <span>
              Hosted work expires{" "}
              {new Date(state.assignment.expiresAt).toLocaleString()}
            </span>
          </div>
          <h1>{state.question.title}</h1>
          <p className="temporary-question">{state.question.prompt}</p>
          <div className="temporary-work">
            <section>
              <h2>Explain your thinking</h2>
              <label htmlFor="guest-response">
                Describe the process and the relationships you want to test.
              </label>
              <textarea
                id="guest-response"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setSaveFailed(false);
                  submitKey.current = crypto.randomUUID();
                }}
                disabled={terminal}
                maxLength={32000}
              />
              <div className="temporary-actions">
                <button
                  disabled={terminal || busy}
                  onClick={() => {
                    void save();
                  }}
                >
                  Save draft
                </button>
                <button
                  className="temporary-primary"
                  disabled={terminal || busy || !text.trim()}
                  onClick={() => {
                    void save(true);
                  }}
                >
                  {state.latest ? "Submit revision" : "Submit explanation"}
                </button>
                <span role="status">{message}</span>
              </div>
              <p className="temporary-note">
                Keep this private link. Do not include your name or email in
                your explanation. Your teacher may send your work to their
                connected AI client to create the simulation.
              </p>
            </section>
            <section>
              <h2>Explore your model</h2>
              <p role="status">{statusText}</p>
              {preview ? (
                <iframe
                  title="Your interactive simulation"
                  src={preview}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="temporary-preview-empty">
                  Your simulation will appear here after teacher processing.
                </div>
              )}
              {state.latest && (
                <p className="temporary-note">
                  Showing submitted revision {state.latest.revision}. Changes in
                  the editor appear in a simulation only after you submit them
                  and your teacher processes the new revision.
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
