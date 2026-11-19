import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The delete button on an object page, and the four states in which it must stay disabled.
//
// This dialog is the only thing standing between "I want to tidy up this address" and a policy
// that stops matching. The tests below are therefore about the NEGATIVE cases: it is easy to write
// a usage panel that lists references, and the whole value is in refusing to arm the button when
// the scan cannot vouch for the answer.

const usage = vi.hoisted(() => ({
  reply: null as unknown,
  reject: null as unknown,
  calls: [] as Array<[number, string, string]>,
}));

vi.mock("../../api/objectGroups", () => ({
  DeviceObjectUsage: async (deviceId: number, kind: string, name: string) => {
    usage.calls.push([deviceId, kind, name]);
    if (usage.reject) throw usage.reject;
    return usage.reply;
  },
}));

// The dialog links each referrer to its page; the router is not the thing under test.
vi.mock("react-router-dom", () => ({
  Link: ({ children }: { children: React.ReactNode }) =>
    React.createElement("a", { href: "#" }, children),
}));

import UsageDeleteModal from "./UsageDelete";

const report = (over: Record<string, unknown> = {}) => ({
  kind: "address", name: "LAN", refs: [], device_count: 0, found: 0,
  complete: true, unreadable: [], safe_to_delete: true, ...over,
});

let container: HTMLDivElement;
let root: Root;

const render = async (props: Record<string, unknown> = {}) => {
  await act(async () => {
    root.render(
      React.createElement(UsageDeleteModal, {
        deviceId: 1, deviceName: "fgt-lab", kind: "address", noun: "address",
        name: "LAN", onCancel: () => {}, onConfirm: () => {}, ...props,
      } as never),
    );
  });
};

/** The dialog portals to document.body, so queries run against the whole document. */
const deleteButton = (): HTMLButtonElement | undefined =>
  [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Delete") as
    HTMLButtonElement | undefined;

const bodyText = () => document.body.textContent ?? "";

beforeEach(() => {
  usage.reply = report();
  usage.reject = null;
  usage.calls = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("UsageDeleteModal", () => {
  it("arms delete only when the scan says the object is unreferenced", async () => {
    await render();
    expect(deleteButton()?.disabled).toBe(false);
    expect(bodyText()).toContain("Nothing references it");
  });

  it("lists the referrers and keeps delete disabled", async () => {
    usage.reply = report({
      refs: [{
        table: "firewall/policy", label: "Firewall Policy", key: "3", name: "lan-to-wan",
        field: "srcaddr", field_label: "Source", route: "/admin/firewall-policy",
      }],
      found: 1, device_count: 1, safe_to_delete: false,
    });
    await render();

    expect(deleteButton()?.disabled).toBe(true);
    expect(bodyText()).toContain("lan-to-wan");
    expect(bodyText()).toContain("Source");
    expect(bodyText()).toContain("Still referenced by 1 place");
  });

  // ⚠️ An empty result from a table that never answered is not evidence of anything.
  it("refuses to arm delete when a table could not be read, and names it", async () => {
    usage.reply = report({ complete: false, safe_to_delete: false, unreadable: ["Virtual IP"] });
    await render();

    expect(deleteButton()?.disabled).toBe(true);
    expect(bodyText()).toContain("Virtual IP");
  });

  // ⚠️ The device counts more references than the scan can show, so the list is not exhaustive.
  it("says so when the device's own count disagrees with what was found", async () => {
    usage.reply = report({ device_count: 4, found: 0, complete: false, safe_to_delete: false });
    await render();

    expect(deleteButton()?.disabled).toBe(true);
    expect(bodyText()).toContain("counts 4 reference");
  });

  // ⚠️ A failed scan must not read as "nothing uses it".
  it("refuses to arm delete when the scan itself failed", async () => {
    usage.reject = new Error("the device could not be reached");
    await render();

    expect(deleteButton()?.disabled).toBe(true);
    expect(bodyText()).toContain("could not run");
    expect(bodyText()).toContain("Delete is disabled");
  });

  it("scans the object it was opened for", async () => {
    await render({ kind: "ippool", name: "branch-nat", deviceId: 7 });
    expect(usage.calls).toEqual([[7, "ippool", "branch-nat"]]);
  });
});
