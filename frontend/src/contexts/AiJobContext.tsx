import React, { useCallback, useEffect, useRef, useState } from "react";
import { GenerateConfigStream } from "../api/ai";
import {
  applyStreamEvent, clearParkedJob, isClaimable, newJob, parkJob, readParkedJob,
  type AiJob,
} from "./aiJob";
import { AiJobContext } from "./AiJobContext.logic";
import type { StartArgs } from "./AiJobContext.logic";
import { apiErrorText } from "../api/errorText";

export type { AiJob, AiJobStatus, AiStreamView } from "./aiJob";

// The AI request, lifted out of the page so it survives navigation.
//
// THE BUG THIS FIXES
// Asking the assistant for a policy takes the model ~30 seconds. That is long enough that people
// go and do something else — and the request lived inside the AI Assistant page component, so
// walking to Firewall Policy unmounted it. The HTTP request kept running (nothing aborted it) but
// its answer landed in a `setItems` on a component that no longer existed. The work was done, paid
// for, and thrown away; coming back showed an empty composer as if nothing had been asked.
//
// So the request now runs HERE, in a provider mounted above the router. Navigating away unmounts
// the page, not the job. Coming back, the page finds either a job still streaming — and shows it
// mid-flight — or a finished one waiting to be claimed.
//
// ONE JOB AT A TIME, deliberately. The composer already disables its send button while a request
// is in flight, so a queue would be machinery for a state the UI does not offer. A second `start`
// replaces the first.
//
// WHO INTERPRETS THE RESULT
// Not this file. It carries the server-validated ConfigSuggestion and nothing more; turning that
// into wizard drafts is ~30 CLI parsers' worth of work that belongs with the page that renders
// them. This is a transport that outlives its passenger, not a second copy of the page's brain.

/** Delta coalescing. The model emits tokens far faster than anything needs to repaint. */
const FLUSH_MS = 80;

export const AiJobProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // A job that finished while the tab was closed or reloading is recovered in the INITIALISER,
  // not in a mount effect. An effect would render the app once with no job and then again with
  // one — a visible flash of "nothing is running" on every reload that happens to land on a
  // finished proposal — and it is the same read either way, done one render earlier.
  const [job, setJob] = useState<AiJob | null>(() => readParkedJob());

  // The authoritative copy. State is for rendering; callbacks that fire from a stream read this,
  // because they close over whatever `job` was when the request started.
  const jobRef = useRef<AiJob | null>(job);
  const abortRef = useRef<AbortController | null>(null);
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publish = useCallback(() => {
    setJob(jobRef.current ? { ...jobRef.current, stream: { ...jobRef.current.stream } } : null);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushRef.current) return;
    flushRef.current = setTimeout(() => {
      flushRef.current = null;
      publish();
    }, FLUSH_MS);
  }, [publish]);

  useEffect(() => () => {
    if (flushRef.current) clearTimeout(flushRef.current);
    // NOT aborted on unmount: this provider only unmounts when the whole app does, and aborting
    // here would reintroduce the very bug it exists to fix.
  }, []);

  const start = useCallback((args: StartArgs) => {
    // Replace anything in flight — the composer only ever offers one question at a time.
    abortRef.current?.abort();
    if (flushRef.current) { clearTimeout(flushRef.current); flushRef.current = null; }

    const controller = new AbortController();
    abortRef.current = controller;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fresh = newJob({ id, deviceId: args.deviceId, prompt: args.prompt });
    jobRef.current = fresh;
    clearParkedJob(); // a new question supersedes an uncollected old answer
    setJob(fresh);

    void (async () => {
      try {
        const result = await GenerateConfigStream(
          { device_id: args.deviceId, prompt: args.sentPrompt, history: args.history, images: args.images },
          (ev) => {
            // Ignore anything arriving for a job that has since been replaced.
            const cur = jobRef.current;
            if (!cur || cur.id !== id) return;
            applyStreamEvent(cur, ev);
            scheduleFlush();
          },
          controller.signal,
        );

        const cur = jobRef.current;
        if (!cur || cur.id !== id) return;
        if (flushRef.current) { clearTimeout(flushRef.current); flushRef.current = null; }
        cur.status = "done";
        cur.result = result;
        parkJob(cur);
        publish();
      } catch (e) {
        const cur = jobRef.current;
        if (!cur || cur.id !== id) return;
        // An abort is a deliberate replacement or cancel, not a failure to report.
        if (controller.signal.aborted) return;
        if (flushRef.current) { clearTimeout(flushRef.current); flushRef.current = null; }
        cur.status = "error";
        cur.error = apiErrorText(e, "The AI request failed");
        parkJob(cur);
        publish();
      }
    })();
  }, [publish, scheduleFlush]);

  const claim = useCallback((): AiJob | null => {
    const cur = jobRef.current;
    if (!isClaimable(cur)) return null;
    jobRef.current = null;
    clearParkedJob();
    setJob(null);
    return cur;
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (flushRef.current) { clearTimeout(flushRef.current); flushRef.current = null; }
    jobRef.current = null;
    clearParkedJob();
    setJob(null);
  }, []);

  // The session ended — logout, a 401, or the maintenance force-logout.
  //
  // This provider sits above the router, so it does NOT unmount when the login screen replaces the
  // console: without this, an answer (or a request still streaming) crossed the sign-out and was
  // handed to whoever signed in next, in memory, where clearSessionScoped could not reach it.
  // `cancel` is exactly the right teardown — abort the request, drop the parked copy, forget the
  // job — so this is one line of behaviour, not a second version of it.
  useEffect(() => {
    window.addEventListener("session:ended", cancel);
    return () => window.removeEventListener("session:ended", cancel);
  }, [cancel]);

  return (
    <AiJobContext.Provider value={{ job, start, claim, cancel }}>
      {children}
    </AiJobContext.Provider>
  );
};

export default AiJobContext;
