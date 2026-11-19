import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Modal from "./Modal";

// The focus trap.
//
// This component carried a comment saying focus was NOT trapped and that it should be — "a
// half-working trap is worse than none". The half that makes it worse is returning focus: a trap
// that grabs focus and then drops the user at the top of the document when it closes is a
// regression for exactly the people it was meant to help. So all four behaviours are pinned here,
// not just the Tab loop.
//
// Why it matters on this console in particular: without a trap, Tab out of a "delete this policy?"
// confirmation lands on the page behind it — a page of buttons that write to a live firewall,
// while the question is still on screen.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function mount(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    rerender: (next: React.ReactElement) => act(() => root.render(next)),
    unmount: () => act(() => root.unmount()),
  };
}

/** The dialog is portalled to document.body, so it is found there rather than in the container. */
const panel = () => document.querySelector<HTMLElement>('[role="dialog"]');

function pressTab(shift = false) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true }));
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.innerHTML = "";
  // The scroll lock too. A failing assertion aborts the test before its unmount(), so without this
  // one genuine failure cascades into a misleading second one in the next case.
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

describe("Modal focus handling", () => {
  it("announces itself as a dialog labelled by its own heading", () => {
    const view = mount(
      <Modal open title="Delete from device?" onClose={() => {}}>
        <p>body</p>
      </Modal>,
    );

    const p = panel();
    expect(p).not.toBeNull();
    expect(p!.getAttribute("aria-modal")).toBe("true");

    const labelledBy = p!.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe("Delete from device?");
    view.unmount();
  });

  it("points aria-labelledby at nothing when there is no title", () => {
    // An aria-labelledby aimed at a missing element is worse than none — a screen reader announces
    // an unlabelled dialog either way, but a dangling reference can silence the name entirely.
    const view = mount(<Modal open onClose={() => {}}><p>body</p></Modal>);
    expect(panel()!.getAttribute("aria-labelledby")).toBeNull();
    view.unmount();
  });

  it("moves focus into the dialog when it opens", () => {
    const view = mount(
      <Modal open title="T" onClose={() => {}} footer={<button type="button">Save</button>}>
        <input aria-label="name" />
      </Modal>,
    );
    // The close button is the first focusable in document order.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
    view.unmount();
  });

  it("focuses the panel itself when the dialog has nothing to press", () => {
    const view = mount(<Modal open onClose={() => {}}><p>read-only</p></Modal>);
    expect(document.activeElement).toBe(panel());
    view.unmount();
  });

  it("wraps forward from the last control to the first", () => {
    const view = mount(
      <Modal open onClose={() => {}} footer={<button type="button">Save</button>}>
        <input aria-label="name" />
      </Modal>,
    );

    const items = Array.from(panel()!.querySelectorAll<HTMLElement>("input, button"));
    const last = items[items.length - 1];
    act(() => last.focus());

    pressTab();
    expect(document.activeElement).toBe(items[0]);
    view.unmount();
  });

  it("wraps backward from the first control to the last", () => {
    const view = mount(
      <Modal open onClose={() => {}} footer={<button type="button">Save</button>}>
        <input aria-label="name" />
      </Modal>,
    );

    const items = Array.from(panel()!.querySelectorAll<HTMLElement>("input, button"));
    act(() => items[0].focus());

    pressTab(true);
    expect(document.activeElement).toBe(items[items.length - 1]);
    view.unmount();
  });

  it("pulls focus back in if it has escaped to the page behind", () => {
    const outside = document.createElement("button");
    outside.textContent = "on the page behind";
    document.body.appendChild(outside);

    const view = mount(
      <Modal open onClose={() => {}} footer={<button type="button">Save</button>}>
        <input aria-label="name" />
      </Modal>,
    );

    // Happens for real when the focused control is removed while the dialog is open: the browser
    // drops focus to <body>, and the next Tab would otherwise continue on the page behind.
    act(() => outside.focus());
    pressTab();

    expect(panel()!.contains(document.activeElement)).toBe(true);
    view.unmount();
  });

  it("returns focus to whatever opened it", () => {
    const opener = document.createElement("button");
    opener.textContent = "Delete";
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const view = mount(<Modal open title="T" onClose={() => {}}><p>body</p></Modal>);
    expect(document.activeElement).not.toBe(opener);

    view.rerender(<Modal open={false} title="T" onClose={() => {}}><p>body</p></Modal>);
    expect(document.activeElement).toBe(opener);
    view.unmount();
  });

  it("does not throw when the opener is gone — the row that was deleted took its button", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const view = mount(<Modal open title="T" onClose={() => {}}><p>body</p></Modal>);
    opener.remove();

    expect(() => view.rerender(
      <Modal open={false} title="T" onClose={() => {}}><p>body</p></Modal>,
    )).not.toThrow();
    view.unmount();
  });

  it("still closes on Escape", () => {
    const onClose = vi.fn();
    const view = mount(<Modal open title="T" onClose={onClose}><p>body</p></Modal>);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("releases the page scroll lock when it closes", () => {
    const view = mount(<Modal open title="T" onClose={() => {}}><p>body</p></Modal>);
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(<Modal open={false} title="T" onClose={() => {}}><p>body</p></Modal>);
    expect(document.body.style.overflow).not.toBe("hidden");
    view.unmount();
  });
});
