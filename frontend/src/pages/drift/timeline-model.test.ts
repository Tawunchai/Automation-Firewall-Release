import { describe, expect, it } from "vitest";
import type { TimelineItem } from "../../api/drift";
import { fallbackExplanation, statusOf } from "./timeline-model";

const item = (over: Partial<TimelineItem>): TimelineItem => ({
  kind: "console", id: 1, at: "2026-09-10T08:41:07Z", device_id: 1, action: "create",
  table: "firewall address", key: "web-01", fallback: "undo", ...over,
});

describe("statusOf", () => {
  it("reads a console row from its ledger status", () => {
    expect(statusOf(item({ status: "applied" }))).toBe("applied");
    expect(statusOf(item({ status: "failed" }))).toBe("failed");
    expect(statusOf(item({ status: "reverted" }))).toBe("reverted");
  });

  // An outside change can no longer be signed off by hand, so the only question left is whether
  // something took it back. Anything else is still on the firewall, however long ago it was found.
  it("reads an outside row from whether an undo took it back", () => {
    expect(statusOf(item({ kind: "outside" }))).toBe("standing");
    expect(statusOf(item({ kind: "outside", undo_change_id: 9 }))).toBe("undone");
  });
});

describe("fallbackExplanation", () => {
  it("says what a console undo actually does, per kind of change", () => {
    expect(fallbackExplanation(item({ action: "create" }))).toMatch(/deletes the object/);
    expect(fallbackExplanation(item({ action: "delete" }))).toMatch(/recreates the object/);
    expect(fallbackExplanation(item({ action: "update" }))).toMatch(/writes back the values/);
  });

  it("explains why a console change cannot be undone", () => {
    expect(fallbackExplanation(item({ fallback: "none", status: "failed" }))).toMatch(/never applied/);
    expect(fallbackExplanation(item({ fallback: "none", status: "reverted" }))).toMatch(/already been undone/);
    expect(fallbackExplanation(item({ fallback: "none", status: "applied", undo_note: "no snapshot was captured" })))
      .toBe("No — no snapshot was captured.");
  });

  it("says that undoing an outside-created object DELETES it, and may be refused", () => {
    const text = fallbackExplanation(item({ kind: "outside", fallback: "undo" }));
    expect(text).toMatch(/deletes it from the firewall/);
    expect(text).toMatch(/refuses if something still uses it/);
  });

  // The restore fallback replaces the WHOLE configuration and reboots. A sentence that let someone
  // think it only touched this one object would be the most dangerous text on the page.
  it("never lets restore sound like a per-object undo", () => {
    for (const action of ["update", "delete"] as const) {
      const text = fallbackExplanation(item({ kind: "outside", action, fallback: "restore" }));
      expect(text).toMatch(/whole firewall/);
      expect(text).toMatch(/reboots/);
      expect(text).toMatch(/every change made since is lost/);
    }
  });

  it("does not offer anything for an outside change that was already undone", () => {
    expect(fallbackExplanation(item({ kind: "outside", fallback: "none", undo_change_id: 3 }))).toMatch(/already been undone/);
  });
});
