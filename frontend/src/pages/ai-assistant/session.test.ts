import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAiSession, isEmptySession, loadAiSession, saveAiSession, serialiseSession,
  type AiSessionState,
} from "./session";
import { sessionScopedKey } from "../../lib/sessionScope";
import type { ChatItem } from "./index";

// The AI Assistant conversation now outlives navigation, so the rules for putting it back have to
// hold in the cases that are not the happy one:
//
//   · a snapshot taken against ANOTHER firewall must not be restored — the drafts inside it name
//     interfaces, addresses and profiles that exist on that device, and a wizard replaying them
//     against a different one creates a policy pointing at objects that are not there;
//   · a conversation that has grown past what the storage quota will take must lose its OLDEST
//     messages, never fail the write — a failed write loses the newest, which is the half anyone
//     wants;
//   · corrupt or older-shaped data must read as "no snapshot", never crash the page or, worse,
//     feed a malformed draft to a wizard that writes to a live firewall.

const KEY = sessionScopedKey("ai-chat");

const item = (text: string, role: ChatItem["role"] = "user"): ChatItem => ({ role, text });

const state = (over: Partial<AiSessionState> = {}): AiSessionState => ({
  deviceId: 1,
  items: [item("show me the policies")],
  input: "",
  appliedWizards: [],
  appliedObjects: [],
  groupAnchors: [],
  ...over,
});

// The snapshot lives in sessionStorage: the transcript can hold `set psk <key>` for a VPN, and a
// tunnel credential must not sit in a file under the browser profile waiting for the next sign-in.
// localStorage is still cleared here because two tests below are about the copy this console used
// to leave there, and one is about a preference that shares it.
beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("round trip", () => {
  it("restores everything the page needs to carry on", () => {
    const saved = state({
      items: [item("create a policy"), item("here it is", "assistant")],
      input: "half-typed question",
      appliedWizards: ["0:policy", "0:deploy"],
      appliedObjects: [[0, [{ kind: "policy", label: "Policy", name: "LAN-to-WAN" }]]] as AiSessionState["appliedObjects"],
      groupAnchors: [["0:port1→wan1", 12]],
    });

    saveAiSession(saved);
    const back = loadAiSession(1);

    expect(back).not.toBeNull();
    expect(back!.items.map((i) => i.text)).toEqual(["create a policy", "here it is"]);
    expect(back!.input).toBe("half-typed question");
    expect(back!.appliedWizards).toEqual(["0:policy", "0:deploy"]);
    expect(back!.appliedObjects[0][1][0].name).toBe("LAN-to-WAN");
    expect(back!.groupAnchors).toEqual([["0:port1→wan1", 12]]);
  });

  it("survives a Map and a Set having been flattened to entries", () => {
    // The page holds these as Map/Set; JSON has neither. The shapes handed back must be exactly
    // what `new Map(...)` and `new Set(...)` accept.
    saveAiSession(state({ appliedWizards: ["3:address"], groupAnchors: [["3:any→any", null]] }));
    const back = loadAiSession(1)!;

    expect(new Set(back.appliedWizards).has("3:address")).toBe(true);
    expect(new Map(back.groupAnchors).get("3:any→any")).toBeNull();
  });

  it("reads as absent when nothing was ever saved", () => {
    expect(loadAiSession(1)).toBeNull();
  });

  it("forgets the conversation on request", () => {
    saveAiSession(state());
    clearAiSession();
    expect(loadAiSession(1)).toBeNull();
  });
});

describe("refusing a snapshot that does not belong here", () => {
  it("does not restore a conversation about a different firewall", () => {
    saveAiSession(state({ deviceId: 1 }));
    expect(loadAiSession(2)).toBeNull();
  });

  it("restores when the device matches", () => {
    saveAiSession(state({ deviceId: 7 }));
    expect(loadAiSession(7)).not.toBeNull();
  });

  it("restores a device-less snapshot anywhere — there is nothing to disagree with", () => {
    saveAiSession(state({ deviceId: null }));
    expect(loadAiSession(4)).not.toBeNull();
  });

  it("restores when the caller has no device selected", () => {
    saveAiSession(state({ deviceId: 3 }));
    expect(loadAiSession(null)).not.toBeNull();
  });
});

describe("rejecting data it cannot trust", () => {
  it("ignores a truncated or hand-edited entry", () => {
    window.sessionStorage.setItem(KEY, "{not json");
    expect(loadAiSession(1)).toBeNull();
  });

  it("ignores a snapshot written by an older shape", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ v: 1, items: [], deviceId: 1 }));
    expect(loadAiSession(1)).toBeNull();
  });

  it("ignores a payload whose items are not a list", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ v: 3, items: "nope", deviceId: 1 }));
    expect(loadAiSession(1)).toBeNull();
  });

  it("ignores a JSON scalar", () => {
    window.sessionStorage.setItem(KEY, "42");
    expect(loadAiSession(1)).toBeNull();
  });

  it("fills in fields that are missing rather than handing back undefined", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ v: 3, items: [], deviceId: 1 }));
    // v3 with items present but the optional collections absent — the page destructures these
    // straight into `new Set(...)` / `new Map(...)`, which throw on undefined.
    const back = loadAiSession(1);
    expect(back).not.toBeNull();
    expect(back!.input).toBe("");
    expect(back!.appliedWizards).toEqual([]);
    expect(back!.appliedObjects).toEqual([]);
    expect(back!.groupAnchors).toEqual([]);
  });

  it("drops non-string entries out of appliedWizards", () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ v: 3, items: [], deviceId: 1, appliedWizards: ["0:policy", 5, null] }),
    );
    expect(loadAiSession(1)!.appliedWizards).toEqual(["0:policy"]);
  });
});

describe("staying inside the storage quota", () => {
  it("keeps only the most recent messages", () => {
    const many = Array.from({ length: 60 }, (_, i) => item(`message ${i}`));
    saveAiSession(state({ items: many }));

    const back = loadAiSession(1)!;
    expect(back.items).toHaveLength(40);
    // The newest survive; the oldest are what goes.
    expect(back.items[0].text).toBe("message 20");
    expect(back.items[39].text).toBe("message 59");
  });

  it("sheds older messages when the payload is too large, instead of failing the write", () => {
    // ~400 KB each: four of these are over the 1.5 MB ceiling, so the write has to give something
    // up rather than throw the whole conversation away.
    const fat = Array.from({ length: 6 }, (_, i) => item("x".repeat(400_000) + `#${i}`));

    const json = serialiseSession(state({ items: fat }));
    expect(json).not.toBeNull();
    expect(new TextEncoder().encode(json!).length).toBeLessThanOrEqual(1_500_000);

    saveAiSession(state({ items: fat }));
    const back = loadAiSession(1)!;
    expect(back.items.length).toBeGreaterThan(0);
    expect(back.items.length).toBeLessThan(6);
    // Whatever survived is the tail.
    expect(back.items[back.items.length - 1].text.endsWith("#5")).toBe(true);
  });

  it("gives up rather than loop forever when a single message cannot fit", () => {
    const monster = [item("x".repeat(2_000_000))];
    expect(serialiseSession(state({ items: monster }))).toBeNull();
  });

  it("removes the stale snapshot when the new one cannot be stored", () => {
    saveAiSession(state({ items: [item("something small")] }));
    expect(loadAiSession(1)).not.toBeNull();

    // An unstorable save must not leave the PREVIOUS conversation behind to be restored in place
    // of the current one.
    saveAiSession(state({ items: [item("x".repeat(2_000_000))] }));
    expect(loadAiSession(1)).toBeNull();
  });
});

describe("isEmptySession", () => {
  it("is true for a fresh page", () => {
    expect(isEmptySession(state({ items: [], input: "" }))).toBe(true);
  });

  it("is true when the composer holds only whitespace", () => {
    expect(isEmptySession(state({ items: [], input: "   \n " }))).toBe(true);
  });

  it("is false once anything has been said", () => {
    expect(isEmptySession(state({ items: [item("hi")], input: "" }))).toBe(false);
  });

  it("is false while a question is half-typed", () => {
    expect(isEmptySession(state({ items: [], input: "create a p" }))).toBe(false);
  });
});

// Clearing, by hand and by signing out.
//
// Both paths run the SAME reset in index.tsx (resetConversation), and both have to leave nothing
// behind: the transcript can hold the objects a proposal already put on a live firewall, and the
// next administrator to use this browser must not inherit them. What is checked here is the
// storage half, which is the half that outlives the page.
describe("clearing", () => {
  it("leaves nothing on disk for the next person", () => {
    saveAiSession(state({ input: "half-typed question" }));
    expect(window.sessionStorage.getItem(KEY)).not.toBeNull();

    clearAiSession();

    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(loadAiSession(1)).toBeNull();
  });

  it("is safe to run when there was never a conversation", () => {
    expect(() => clearAiSession()).not.toThrow();
    expect(loadAiSession(1)).toBeNull();
  });

  it("recognises the state a cleared page is in, so nothing is written back", () => {
    // index.tsx's save effect drops the snapshot rather than writing an empty one — this is the
    // predicate it uses, and the reason a cleared conversation does not come back on reload.
    const cleared = state({ items: [], input: "", appliedWizards: [], appliedObjects: [] });
    expect(isEmptySession(cleared)).toBe(true);
    expect(isEmptySession(state())).toBe(false);
    expect(isEmptySession(state({ items: [], input: "still typing" }))).toBe(false);
  });

  it("does not take a preference with it", () => {
    // Preferences live in localStorage and the snapshot no longer does, but clearAiSession still
    // reaches into localStorage to remove the legacy copy — by key, not by sweeping it.
    window.localStorage.setItem("theme", "Dark");
    saveAiSession(state());
    clearAiSession();
    expect(window.localStorage.getItem("theme")).toBe("Dark");
  });
});

// Moving off the disk.
//
// This console used to keep the snapshot in localStorage. A VPN proposal's CLI carries
// `set psk <key>`, so those files hold a live tunnel credential — the whole reason for the move.
// Clearing on logout never covered the window between a crash and the next sign-in, because
// nothing runs in it.
//
// So the first load after the change has two jobs, and the second one is the point: carry the
// conversation over, and take the disk copy away.
describe("the copy this console used to leave on disk", () => {
  const legacy = (st: AiSessionState) => {
    // Written the way the old code wrote it: same key, same shape, in localStorage.
    const json = serialiseSession(st);
    if (json === null) throw new Error("the fixture did not serialise");
    window.localStorage.setItem(KEY, json);
  };

  it("is restored once, so nobody's open conversation is thrown away", () => {
    legacy(state({ input: "half-typed question" }));

    const back = loadAiSession(1);
    expect(back).not.toBeNull();
    expect(back?.input).toBe("half-typed question");
  });

  it("is deleted from disk by that read, not merely ignored", () => {
    legacy(state({ items: [item("set psk SuperSecret123")] }));
    loadAiSession(1);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("is deleted even when it is corrupt and cannot be restored", () => {
    // Removal comes before the parse: a snapshot that fails to load is still a file with a key in
    // it, and leaving it because it was unreadable would keep exactly the wrong half.
    window.localStorage.setItem(KEY, "{not json");
    expect(loadAiSession(1)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("is deleted even when it belongs to another firewall", () => {
    legacy(state({ deviceId: 7 }));
    expect(loadAiSession(1)).toBeNull(); // refused, as a cross-device snapshot must be
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("is never consulted once a tab-scoped snapshot exists", () => {
    // Otherwise a stale disk copy could outrank the live conversation after a device switch.
    legacy(state({ input: "the old one" }));
    saveAiSession(state({ input: "the current one" }));

    expect(loadAiSession(1)?.input).toBe("the current one");
  });

  it("is removed by clear chat too, for a tab that has not reloaded yet", () => {
    legacy(state());
    saveAiSession(state());

    clearAiSession();

    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("does not write the snapshot back to disk", () => {
    // The regression that would undo all of this: a save path that still touched localStorage.
    saveAiSession(state({ items: [item("set psk SuperSecret123")] }));
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).not.toBeNull();
  });
});
