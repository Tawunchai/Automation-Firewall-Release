import type { AIStreamEvent, ConfigSuggestion } from "../api/ai";
import { readSessionScoped, removeSessionScoped, writeSessionScoped } from "../lib/sessionScope";

// The AI job's state machine and its parking lot, kept apart from the React provider so the parts
// that can go wrong quietly are testable on their own.
//
// Two of them are worth spelling out, because both fail SILENTLY if they are wrong:
//
//   · a job restored as "running" after a reload would spin forever — the fetch that was feeding
//     it died with the tab, so nothing will ever complete it;
//   · a claimed job must be handed over exactly once, or a re-render appends the same answer to
//     the transcript twice.

export type AiStreamView = { phase: "device" | "model"; explanation: string; cli: string };

export type AiJobStatus = "running" | "done" | "error";

export type AiJob = {
  id: string;
  deviceId: number;
  /** What the user typed — what the transcript shows. */
  prompt: string;
  startedAt: number;
  status: AiJobStatus;
  /** Live text as the model writes it. Preview only; never used to build a draft. */
  stream: AiStreamView;
  result?: ConfigSuggestion;
  error?: string;
};

/** Storage name for a finished job nobody has collected yet. */
export const PARKED_KEY = "ai-job";

/** Bump when the parked shape changes; an older one is dropped rather than migrated. */
export const PARKED_VERSION = 1;

/**
 * How long a finished-but-unclaimed job stays worth restoring.
 *
 * It is parked only to survive a browser reload between "the model answered" and "the user came
 * back". Beyond an hour the conversation it belonged to has almost certainly moved on, and
 * appending a stale answer to a live transcript is worse than losing it.
 */
export const PARKED_TTL_MS = 60 * 60 * 1000;

type ParkedJob = { v: number; job: AiJob };

export const newJob = (args: {
  id: string; deviceId: number; prompt: string; now?: number;
}): AiJob => ({
  id: args.id,
  deviceId: args.deviceId,
  prompt: args.prompt,
  startedAt: args.now ?? Date.now(),
  status: "running",
  stream: { phase: "device", explanation: "", cli: "" },
});

/**
 * Folds one stream event into a job, in place.
 *
 * Mutating is deliberate: the provider holds the authoritative job in a ref and copies it out for
 * rendering, so tokens arriving faster than the paint rate cost nothing.
 */
export const applyStreamEvent = (job: AiJob, ev: AIStreamEvent): void => {
  if (ev.type === "status") job.stream.phase = ev.phase;
  else if (ev.type === "delta") {
    job.stream.explanation += ev.explanation;
    job.stream.cli += ev.cli;
  }
};

/** A job is collectable only once it has stopped. Half an answer is not an answer. */
export const isClaimable = (job: AiJob | null): boolean =>
  !!job && job.status !== "running";

export const parkJob = (job: AiJob): void => {
  try {
    writeSessionScoped(PARKED_KEY, JSON.stringify({ v: PARKED_VERSION, job } satisfies ParkedJob));
  } catch {
    // A quota failure here costs one recovered answer, never the running app.
  }
};

export const clearParkedJob = (): void => removeSessionScoped(PARKED_KEY);

/**
 * Reads back a parked job, or null when there is nothing safe to restore.
 *
 * Refuses, in order: nothing stored, unreadable JSON, a different shape version, a job that was
 * still RUNNING when the tab went away, and anything older than the TTL.
 */
export const readParkedJob = (now: number = Date.now()): AiJob | null => {
  const raw = readSessionScoped(PARKED_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ParkedJob;
    if (parsed?.v !== PARKED_VERSION || !parsed.job) return null;
    if (parsed.job.status === "running") return null;
    if (now - parsed.job.startedAt > PARKED_TTL_MS) return null;
    return parsed.job;
  } catch {
    return null;
  }
};
