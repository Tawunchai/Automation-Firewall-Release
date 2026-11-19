import { describe, expect, it } from "vitest";
import {
  nextNotice, noticeTitle, noticeBody, isAiPagePath, AI_PAGE_PATH, NOTICE_MS,
} from "./noticeRules";
import type { AiJob } from "../../contexts/aiJob";

const job = (over: Partial<AiJob> = {}): AiJob => ({
  id: "j1",
  deviceId: 1,
  prompt: "block youtube for the guest vlan",
  startedAt: Date.now(),
  status: "done",
  stream: { phase: "model", explanation: "", cli: "" },
  ...over,
});

describe("when the popup appears", () => {
  it("announces a finished job while the user is elsewhere", () => {
    const n = nextNotice({ job: job(), onAiPage: false, announcedId: null });
    expect(n).toEqual({
      id: "j1", kind: "done", prompt: "block youtube for the guest vlan", detail: "",
    });
  });

  it("stays quiet while the answer is still being written", () => {
    // Half an answer is not an answer — and the provider publishes the running job every 80ms.
    expect(nextNotice({ job: job({ status: "running" }), onAiPage: false, announcedId: null }))
      .toBeNull();
  });

  it("stays quiet on the AI Assistant page, which is already showing the answer", () => {
    expect(nextNotice({ job: job(), onAiPage: true, announcedId: null })).toBeNull();
  });

  it("announces one job exactly once", () => {
    // THE bug this guards: a finished job stays parked until the assistant claims it, and the
    // provider republishes it on every upstream re-render. Without the id check the popup would
    // re-raise itself indefinitely.
    expect(nextNotice({ job: job(), onAiPage: false, announcedId: "j1" })).toBeNull();
    // …but the NEXT question still gets its own.
    expect(nextNotice({ job: job({ id: "j2" }), onAiPage: false, announcedId: "j1" })?.id)
      .toBe("j2");
  });

  it("says nothing when there is no job at all", () => {
    expect(nextNotice({ job: null, onAiPage: false, announcedId: null })).toBeNull();
  });
});

describe("a failed job", () => {
  it("is announced as an error, carrying the reason", () => {
    const n = nextNotice({
      job: job({ status: "error", error: "device 1 is unreachable" }),
      onAiPage: false, announcedId: null,
    });
    expect(n?.kind).toBe("error");
    expect(n?.detail).toBe("device 1 is unreachable");
    expect(noticeBody(n!)).toBe("device 1 is unreachable");
  });

  it("still says something when the failure carried no message", () => {
    const n = nextNotice({ job: job({ status: "error" }), onAiPage: false, announcedId: null });
    // A blank card would look like a rendering fault rather than a failed request.
    expect(n?.detail).toBe("The AI request failed");
  });
});

describe("what the card says", () => {
  it("titles the two outcomes differently", () => {
    expect(noticeTitle("done")).toMatch(/ready/i);
    expect(noticeTitle("error")).toMatch(/failed/i);
  });

  it("shows the question back on a successful notice", () => {
    const n = nextNotice({ job: job(), onAiPage: false, announcedId: null })!;
    expect(noticeBody(n)).toBe("block youtube for the guest vlan");
  });

  it("falls back to a prompt when the question was blank", () => {
    const n = nextNotice({ job: job({ prompt: "   " }), onAiPage: false, announcedId: null })!;
    expect(noticeBody(n)).toBe("Open the assistant to review it");
  });
});

describe("which route counts as the assistant", () => {
  it("matches the page and anything under it, and nothing else", () => {
    expect(isAiPagePath(AI_PAGE_PATH)).toBe(true);
    expect(isAiPagePath(`${AI_PAGE_PATH}/whatever`)).toBe(true);
    expect(isAiPagePath("/admin/firewall-policy")).toBe(false);
    // A prefix that is a different page must NOT count — "/admin/ai-assistant-logs" is not it.
    expect(isAiPagePath("/admin/ai-assistant-logs")).toBe(false);
  });
});

describe("the dismiss clock", () => {
  it("is long enough to read a question back", () => {
    // Not a style preference: the card shows the prompt, and a 3s toast duration would make that
    // text pointless.
    expect(NOTICE_MS).toBeGreaterThanOrEqual(8000);
  });
});
