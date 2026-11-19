import { beforeEach, describe, expect, it } from "vitest";
import {
  applyStreamEvent, clearParkedJob, isClaimable, newJob, parkJob, readParkedJob,
  PARKED_KEY, PARKED_TTL_MS, PARKED_VERSION, type AiJob,
} from "./aiJob";
import { sessionScopedKey } from "../lib/sessionScope";
import type { ConfigSuggestion } from "../api/ai";

const suggestion: ConfigSuggestion = {
  commands: ["config firewall policy", "end"],
  explanation: "Creates a policy",
  mode: "config",
};

const finished = (over: Partial<AiJob> = {}): AiJob => ({
  ...newJob({ id: "j1", deviceId: 1, prompt: "block youtube", now: Date.now() }),
  status: "done",
  result: suggestion,
  ...over,
});

beforeEach(() => localStorage.clear());

describe("stream folding", () => {
  it("appends deltas rather than replacing them", () => {
    // The server sends the answer in tokens. Replacing on each event would leave only the last
    // fragment on screen.
    const job = newJob({ id: "j", deviceId: 1, prompt: "p" });
    applyStreamEvent(job, { type: "delta", explanation: "Creates ", cli: "config " });
    applyStreamEvent(job, { type: "delta", explanation: "a policy", cli: "firewall policy" });
    expect(job.stream.explanation).toBe("Creates a policy");
    expect(job.stream.cli).toBe("config firewall policy");
  });

  it("tracks the phase the server reports", () => {
    const job = newJob({ id: "j", deviceId: 1, prompt: "p" });
    expect(job.stream.phase).toBe("device"); // reading the firewall comes first
    applyStreamEvent(job, { type: "status", phase: "model" });
    expect(job.stream.phase).toBe("model");
  });

  it("starts running, on the device it was asked about", () => {
    const job = newJob({ id: "j", deviceId: 7, prompt: "p" });
    expect(job.status).toBe("running");
    expect(job.deviceId).toBe(7);
    expect(job.stream).toEqual({ phase: "device", explanation: "", cli: "" });
  });
});

describe("claiming", () => {
  it("refuses a job that is still running — half an answer is not an answer", () => {
    expect(isClaimable(newJob({ id: "j", deviceId: 1, prompt: "p" }))).toBe(false);
  });

  it("allows a finished or failed job", () => {
    expect(isClaimable(finished())).toBe(true);
    expect(isClaimable(finished({ status: "error", error: "boom" }))).toBe(true);
  });

  it("has nothing to claim when there is no job", () => {
    expect(isClaimable(null)).toBe(false);
  });
});

describe("parking — surviving a reload between the answer and the user's return", () => {
  it("round-trips a finished job with its result", () => {
    const job = finished();
    parkJob(job);
    const back = readParkedJob();
    expect(back?.id).toBe("j1");
    expect(back?.prompt).toBe("block youtube");
    expect(back?.result?.commands).toEqual(suggestion.commands);
  });

  it("NEVER restores a job that was still running", () => {
    // The fetch feeding it died with the tab, so nothing can ever complete it. Restoring it would
    // leave the page showing a spinner that never stops.
    parkJob(newJob({ id: "j", deviceId: 1, prompt: "p" }));
    expect(readParkedJob()).toBeNull();
  });

  it("drops a job older than the TTL", () => {
    // An answer to a question asked an hour ago, appended to whatever conversation is on screen
    // now, is worse than no answer.
    const old = finished({ startedAt: Date.now() - PARKED_TTL_MS - 1 });
    parkJob(old);
    expect(readParkedJob()).toBeNull();

    const fresh = finished({ startedAt: Date.now() - 1000 });
    parkJob(fresh);
    expect(readParkedJob()?.id).toBe("j1");
  });

  it("drops a snapshot written by an older shape instead of guessing at it", () => {
    localStorage.setItem(
      sessionScopedKey(PARKED_KEY),
      JSON.stringify({ v: PARKED_VERSION - 1, job: finished() }),
    );
    expect(readParkedJob()).toBeNull();
  });

  it("survives unreadable storage rather than throwing on start-up", () => {
    localStorage.setItem(sessionScopedKey(PARKED_KEY), "{not json");
    expect(readParkedJob()).toBeNull();
  });

  it("returns null when nothing is parked", () => {
    expect(readParkedJob()).toBeNull();
  });

  it("clears on demand, so a claimed answer cannot come back", () => {
    parkJob(finished());
    expect(readParkedJob()).not.toBeNull();
    clearParkedJob();
    expect(readParkedJob()).toBeNull();
  });

  it("keeps a failed job, so the error is still reported after a reload", () => {
    parkJob(finished({ status: "error", error: "the device was unreachable", result: undefined }));
    const back = readParkedJob();
    expect(back?.status).toBe("error");
    expect(back?.error).toBe("the device was unreachable");
  });

  it("parks under the session-scoped prefix, so signing out takes it with everything else", () => {
    // Sign-out clears every session-scoped key; a job stored outside that prefix would leak one
    // user's question into the next session on a shared machine.
    parkJob(finished());
    expect(localStorage.getItem(sessionScopedKey(PARKED_KEY))).not.toBeNull();
  });
});
