import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionScoped,
  isSessionScopedKey,
  readSessionScoped,
  readTabScoped,
  removeSessionScoped,
  removeTabScoped,
  sessionScopedKey,
  writeSessionScoped,
  writeTabScoped,
} from "./sessionScope";

// This module decides what survives signing out. Two failures matter and neither is visible on
// screen:
//
//   · leaving session state behind → the next person to sign in on this browser inherits the
//     previous administrator's AI conversation, which can name their firewall's objects;
//   · clearing too much → the theme, the accent and the remembered address reset on every logout.
//
// The clearing loop also has a classic bug of its own, pinned below: removing entries while
// walking localStorage by index re-indexes the store underneath the loop and skips every second
// match. A half-cleared session looks exactly like a working one until you go looking.

const PREFS = {
  "themeMode": "Dark",
  "themeColor": "#845ADF",
  "auth:remembered_email": "admin@got.co.th",
  "sidebar.closedSections": "[]",
  "console.selectedDeviceId": "1",
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  Object.entries(PREFS).forEach(([k, v]) => window.localStorage.setItem(k, v));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("sessionScopedKey", () => {
  it("namespaces the key", () => {
    expect(sessionScopedKey("ai-chat")).toBe("session:ai-chat");
  });

  it("recognises its own keys and nothing else", () => {
    expect(isSessionScopedKey(sessionScopedKey("x"))).toBe(true);
    for (const pref of Object.keys(PREFS)) expect(isSessionScopedKey(pref)).toBe(false);
  });
});

describe("read / write / remove", () => {
  it("round-trips a value", () => {
    expect(writeSessionScoped("ai-chat", "hello")).toBe(true);
    expect(readSessionScoped("ai-chat")).toBe("hello");
  });

  it("returns null for a key that was never written", () => {
    expect(readSessionScoped("nothing-here")).toBeNull();
  });

  it("removes one value without touching the others", () => {
    writeSessionScoped("a", "1");
    writeSessionScoped("b", "2");
    removeSessionScoped("a");
    expect(readSessionScoped("a")).toBeNull();
    expect(readSessionScoped("b")).toBe("2");
  });
});

describe("clearSessionScoped", () => {
  it("removes EVERY session key, not every second one", () => {
    // The regression this exists for. With `removeItem` called inside a `for (i < length)` walk,
    // the store re-indexes on each delete and roughly half of these survive.
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    names.forEach((n) => writeSessionScoped(n, "x"));

    clearSessionScoped();

    for (const n of names) {
      expect(readSessionScoped(n), `${n} survived the clear`).toBeNull();
    }
  });

  it("leaves preferences alone", () => {
    writeSessionScoped("ai-chat", "conversation");
    clearSessionScoped();

    for (const [k, v] of Object.entries(PREFS)) {
      expect(window.localStorage.getItem(k), `${k} was wiped`).toBe(v);
    }
  });

  it("is a no-op on a store with nothing scoped in it", () => {
    const before = window.localStorage.length;
    clearSessionScoped();
    expect(window.localStorage.length).toBe(before);
  });

  it("clears sessionStorage too", () => {
    // sessionStorage is per-TAB, not per-session: signing out and back in happens in the same tab,
    // so a hand-off slot left there (the AI chat's VPN prefill) reaches the next administrator.
    window.sessionStorage.setItem(sessionScopedKey("vpn-prefill"), '{"psk":"secret"}');
    window.sessionStorage.setItem(sessionScopedKey("other"), "x");

    clearSessionScoped();

    expect(window.sessionStorage.getItem(sessionScopedKey("vpn-prefill"))).toBeNull();
    expect(window.sessionStorage.getItem(sessionScopedKey("other"))).toBeNull();
  });

  it("leaves un-scoped sessionStorage entries alone", () => {
    window.sessionStorage.setItem("auth:maintenance_logout", "1");
    clearSessionScoped();
    expect(window.sessionStorage.getItem("auth:maintenance_logout")).toBe("1");
  });
});

describe("when storage is unavailable", () => {
  // Private-browsing modes and locked-down origins make localStorage throw on access. None of
  // these may propagate: writes happen on a keystroke and the clear happens while signing out.
  const throwingStorage = {
    get length(): number { throw new Error("denied"); },
    key() { throw new Error("denied"); },
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
    clear() { throw new Error("denied"); },
  };

  beforeEach(() => {
    vi.stubGlobal("localStorage", throwingStorage);
  });

  it("reports a failed write instead of throwing", () => {
    expect(writeSessionScoped("ai-chat", "x")).toBe(false);
  });

  it("reads as absent", () => {
    expect(readSessionScoped("ai-chat")).toBeNull();
  });

  it("clears and removes without throwing", () => {
    expect(() => clearSessionScoped()).not.toThrow();
    expect(() => removeSessionScoped("ai-chat")).not.toThrow();
  });

  it("still clears sessionStorage when localStorage is the one refusing", () => {
    // The two sweeps are independent — one denied store must not skip the other.
    window.sessionStorage.setItem(sessionScopedKey("vpn-prefill"), "x");
    clearSessionScoped();
    expect(window.sessionStorage.getItem(sessionScopedKey("vpn-prefill"))).toBeNull();
  });

  it("survives BOTH stores refusing", () => {
    vi.stubGlobal("sessionStorage", throwingStorage);
    expect(() => clearSessionScoped()).not.toThrow();
  });
});

// The tab-scoped pair: the same prefix, in sessionStorage.
//
// For session state that must not reach the DISK at all. The AI Assistant's transcript is the case
// — it holds the CLI a proposal was built from, and a VPN's CLI carries `set psk <key>`. Logout
// clears it either way; what sessionStorage adds is that a crash followed by somebody else signing
// in later cannot find it, because there was never a file.
describe("tab-scoped read / write / remove", () => {
  it("round-trips a value in sessionStorage and NOT in localStorage", () => {
    writeTabScoped("ai-chat", "the conversation");

    expect(readTabScoped("ai-chat")).toBe("the conversation");
    expect(window.sessionStorage.getItem(sessionScopedKey("ai-chat"))).toBe("the conversation");
    expect(window.localStorage.getItem(sessionScopedKey("ai-chat"))).toBeNull();
  });

  it("uses the same prefix, so clearSessionScoped finds it", () => {
    writeTabScoped("ai-chat", "x");
    clearSessionScoped();
    expect(readTabScoped("ai-chat")).toBeNull();
  });

  it("does not see a value written to localStorage under the same name", () => {
    // The two are separate stores. If this ever read through to localStorage, the legacy disk
    // snapshot would come back silently and the move would have achieved nothing.
    window.localStorage.setItem(sessionScopedKey("ai-chat"), "the old disk copy");
    expect(readTabScoped("ai-chat")).toBeNull();
  });

  it("removes one value without touching the others", () => {
    writeTabScoped("ai-chat", "a");
    writeTabScoped("ai-job", "b");
    removeTabScoped("ai-chat");
    expect(readTabScoped("ai-chat")).toBeNull();
    expect(readTabScoped("ai-job")).toBe("b");
  });

  it("reports a failed write and reads as absent when sessionStorage refuses", () => {
    // Private-browsing modes make this throw on access, and it happens on a keystroke.
    vi.stubGlobal("sessionStorage", {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); },
    });
    expect(writeTabScoped("ai-chat", "x")).toBe(false);
    expect(readTabScoped("ai-chat")).toBeNull();
    expect(() => removeTabScoped("ai-chat")).not.toThrow();
    vi.unstubAllGlobals();
  });
});
