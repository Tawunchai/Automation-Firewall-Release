import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { message } from "./toast";

// The console's only acknowledgement channel: 476 call sites end in one of these, and several of
// them are the ONLY confirmation that something reached a live firewall.
//
// These drive the real module — it mounts its own root into document.body outside the React tree,
// which is exactly the part worth exercising, because "the host never mounted" fails silently and
// looks identical to "the operation produced no message".

declare global {
  // Declared `boolean`, not `boolean | undefined`, to match hooks/useFetch.test.tsx. Global
  // declarations merge across files and TypeScript rejects two different types for one name — the
  // wider type here failed the build with TS2403 rather than anything at runtime.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

/** Fires a toast and lets React commit it. */
const show = async (fn: () => void) => {
  await act(async () => { fn(); });
};

const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".toast-card"));
const texts = () => cards().map((c) => c.querySelector(".toast-text")?.textContent ?? "");
const badge = (card: HTMLElement) => card.querySelector<HTMLElement>(".toast-badge");

afterEach(async () => {
  await act(async () => { message.destroy(); });
});

describe("showing a message", () => {
  it("mounts a host on first use and renders the text", async () => {
    expect(document.getElementById("toast-host")).toBeNull();

    await show(() => message.success("Saved"));

    expect(document.getElementById("toast-host")).not.toBeNull();
    expect(texts()).toEqual(["Saved"]);
  });

  it("accepts antd's object form, which the sign-in page uses", async () => {
    // `message.success({ content, duration })` has to keep working: this is a drop-in for antd's
    // `message`, and a call site silently rendering "[object Object]" is worse than a crash.
    await show(() => message.success({ content: "Login success", duration: 2 }));
    expect(texts()).toEqual(["Login success"]);
  });

  it("stacks messages in the order they were fired", async () => {
    await show(() => {
      message.info("first");
      message.info("second");
      message.info("third");
    });
    expect(texts()).toEqual(["first", "second", "third"]);
  });
});

describe("the status disc", () => {
  const TONE: Record<string, string> = {
    success: "rgb(97, 211, 69)",
    error: "rgb(255, 75, 75)",
    info: "rgb(59, 130, 246)",
    warning: "rgb(245, 158, 11)",
  };

  it("fills the disc with the colour of the kind", async () => {
    for (const [kind, rgb] of Object.entries(TONE)) {
      await show(() => (message as unknown as Record<string, (t: string) => void>)[kind](kind));
      const disc = badge(cards()[0]);
      expect(disc, `${kind} rendered no disc`).not.toBeNull();
      expect(disc!.style.background, `${kind} disc colour`).toBe(rgb);
      await act(async () => { message.destroy(); });
    }
  });

  it("shows a spinner instead of a disc while loading", async () => {
    await show(() => message.loading("Applying…"));
    const card = cards()[0];
    expect(badge(card)).toBeNull();
    expect(card.querySelector(".toast-spinner")).not.toBeNull();
  });

  it("marks only errors as an assertive alert", async () => {
    await show(() => {
      message.error("boom");
      message.success("fine");
    });
    const roles = cards().map((c) => c.getAttribute("role"));
    expect(roles).toEqual(["alert", "status"]);
  });
});

describe("dismissing", () => {
  it("closes when the toast itself is clicked — there is no × any more", async () => {
    await show(() => message.success("Saved"));
    expect(cards()).toHaveLength(1);
    // The whole card is the target, matching react-hot-toast. A × button would have been a
    // decision to make about something that resolves itself in three seconds.
    expect(cards()[0].querySelector("button")).toBeNull();

    await act(async () => { cards()[0].click(); });
    expect(cards()).toHaveLength(0);
  });

  it("closes through the handle the caller was given", async () => {
    let close = () => {};
    await show(() => { close = message.loading("Working…"); });
    expect(cards()).toHaveLength(1);

    await act(async () => { close(); });
    expect(cards()).toHaveLength(0);
  });

  it("destroy() clears everything on screen", async () => {
    await show(() => {
      message.error("a");
      message.warning("b");
    });
    expect(cards()).toHaveLength(2);

    await act(async () => { message.destroy(); });
    expect(cards()).toHaveLength(0);
  });
});

describe("the stack cap", () => {
  it("never shows more than five, and keeps the newest", async () => {
    // A burst — applying a policy that auto-creates prerequisites fires one per object. Ten on
    // screen is never useful and pushes the newest off the top of the viewport.
    await show(() => {
      for (let i = 1; i <= 9; i++) message.success(`object ${i}`);
    });

    const shown = texts();
    expect(shown).toHaveLength(5);
    expect(shown).toEqual(["object 5", "object 6", "object 7", "object 8", "object 9"]);
  });
});
