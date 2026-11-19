import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemediationPlan } from "../../api/auditRemediation";

// What this panel must never do is let a reader mistake one kind of statement for another. There
// are three on screen — the engine's steps, the engine's projection, and the model's opinion — and
// they carry different warranties. So the tests below are mostly about labelling and about the one
// sentence that decides whether somebody's change window is wasted: does running all of this
// actually close the control.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const getPlan = vi.fn();
const getAdvice = vi.fn();

vi.mock("../../api/auditRemediation", () => ({
  DeviceAuditRemediation: (...a: unknown[]) => getPlan(...a),
  DeviceAuditRemediationAdvice: (...a: unknown[]) => getAdvice(...a),
}));
vi.mock("../../components/ui/toast", () => ({
  message: { success: vi.fn(), error: vi.fn() },
}));

const { default: RemediatePanel } = await import("./remediate");

const plan = (over: Partial<RemediationPlan> = {}): RemediationPlan => ({
  framework_id: "iso-27001",
  framework: "ISO/IEC 27001",
  control_id: "A.8.15",
  control_title: "Logging",
  status: "gap",
  steps: [
    {
      check: "policy-no-logging", title: "Policy logs nothing", severity: "medium",
      category: "Logging", why: "Sessions this rule allows are not recorded.",
      findings: 3, subjects: ["policy 1", "policy 2", "policy 3"],
      cli: ["config firewall policy", "    edit 1", "        set logtraffic all", "    next", "end"],
      accepted: 1, advisory: false,
      verdict: "verified",
      verification: [{
        path: "firewall/policy", attr: "logtraffic", value: "all", status: "verified",
        detail: "this device's own schema confirms logtraffic under firewall policy and accepts this value.",
        options: ["all", "disable", "utm"],
      }],
      docs: [{
        path: "firewall/policy", command: "config firewall policy",
        title: "FortiOS CLI Reference — config firewall policy", publisher: "Fortinet",
        release: "7.2.10",
        url: "https://docs.fortinet.com/document/fortigate/7.2.10/cli-reference/333889629/config-firewall-policy",
      }],
    },
    {
      check: "log-no-remote", title: "Logs go nowhere", severity: "medium",
      category: "Logging", why: "Nothing forwards this device's logs anywhere.",
      findings: 1, subjects: ["log setting"], accepted: 0, advisory: false,
      manual: "Point the device at a syslog collector.",
    },
  ],
  projection: [
    { id: "A.8.15", title: "Logging", before: "gap", after: "evidenced", findings: 4, resolved: 4, changed: true, target: true },
    { id: "A.8.16", title: "Monitoring activities", before: "gap", after: "evidenced", findings: 4, resolved: 4, changed: true },
    { id: "A.8.2", title: "Privileged access rights", before: "gap", after: "gap", findings: 1, resolved: 0, changed: false },
  ],
  before: { gaps: 3, indeterminate: 0, observations: 0, evidenced: 11, not_assessed: 0 },
  after: { gaps: 1, indeterminate: 0, observations: 0, evidenced: 13, not_assessed: 0 },
  resolves: 4,
  closes: true,
  note: "The after column is this scan's own findings with the resolved ones removed. Nothing here is executed.",
  schema_source: {
    device: "FortiGate-80E", serial: "FGT80E0000000000", firmware: "v7.2.10",
    method: "GET /api/v2/cmdb/<path>?action=schema",
  },
  evidence_note: "Verified means this firewall's own schema, on the firmware it is running, confirms the attribute and accepts the value.",
  ...over,
});


let container: HTMLDivElement;
let root: Root;

const mount = (node: React.ReactElement) => {
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
};

const panel = (over: Partial<RemediationPlan> = {}) => {
  getPlan.mockResolvedValue(plan(over));
  mount(<RemediatePanel deviceId={1} controlId="A.8.15" controlTitle="Logging"
    canAsk onClose={() => {}} />);
  return act(async () => {});
};

// The panel is portalled to document.body — MainLayout's content column carries a transform, which
// would otherwise make it the containing block for the overlay's `fixed` positioning. So the
// assertions read the document, not the mount container.
const html = () => document.body.innerHTML;
const text = () => document.body.textContent ?? "";
const buttons = () => [...document.body.querySelectorAll("button")];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  getPlan.mockReset();
  getAdvice.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

describe("the remediation panel", () => {
  it("says whether running everything would actually close the control", async () => {
    await panel();
    expect(text()).toContain("Running every step below would close this control");
  });

  it("says why it would NOT close, when it would not", async () => {
    // The dangerous case. "Here is a fix" next to a control that stays open is how somebody spends
    // a change window and gets the same report back.
    await panel({
      closes: false,
      blocked: "Findings remain on log-implicit-deny-off, which also feeds this control.",
    });
    expect(text()).toContain("would not close this control on its own");
    expect(text()).toContain("log-implicit-deny-off");
  });

  it("does not repeat the control's state back at the reader", async () => {
    // The before/after table went: somebody who clicked "How to close this" on a row already knows
    // what state that control is in, and the one thing the table added — whether the plan closes
    // it — is the headline above. A panel that restates the page you came from is a panel to scroll.
    await panel();
    expect(text()).not.toContain("BEFORE AND AFTER");
    expect(text()).not.toContain("Monitoring activities");
    // The finding it does answer is still the first thing on screen.
    expect(text()).toContain("Running every step below would close this control");
  });

  it("offers no button that concatenates commands for different tables", async () => {
    // Each step has its own Copy. One "copy every command" invites pasting several unrelated
    // config blocks into a terminal as if they were one change.
    await panel();
    expect(text()).not.toContain("Copy every command");
    expect(buttons().some((b) => b.textContent?.trim() === "Copy")).toBe(true);
  });

  it("states the command is the operator's to run", async () => {
    await panel();
    expect(text()).toContain("set logtraffic all");
    // Said once, under the section, rather than repeated as a caption on every CLI block.
    expect(text()).toContain(plan().note);
  });

  it("gives a step with no CLI something to do instead", async () => {
    await panel();
    expect(text()).toContain("Point the device at a syslog collector.");
  });

  it("marks findings somebody already signed for rather than hiding them", async () => {
    await panel();
    expect(text()).toContain("1 already accepted");
  });

  it("keeps the class summary on the Findings tab, where it belongs", async () => {
    // "Why this class of finding matters" is one click away and is stated there in full. Repeating
    // it here pushed the command — the thing a reader came for — below the fold.
    await panel();
    expect(text()).not.toContain("(our summary)");
    expect(text()).toContain("policy-no-logging");
  });

  it("shows who says the command is right — the device, and the vendor", async () => {
    // A standard never publishes vendor commands, so the authority for `set logtraffic all` is the
    // firewall itself plus Fortinet's own page. Both are on screen beside the command.
    await panel();
    expect(text()).toContain("Says who");
    expect(text()).toContain("device-verified");
    expect(text()).toContain("config firewall policy ↗");
    // And which device answered, so the badge is not itself an unsourced claim.
    expect(text()).toContain("checked against FortiGate-80E");
    expect(text()).toContain("v7.2.10");
    expect(text()).toContain(plan().evidence_note!);
  });

  it("never hides an attribute this firmware does not have", async () => {
    // The regression this guards: Fortinet renames an attribute, our fix silently stops working,
    // and the reader sees a tidy collapsed panel. A problem is shown without being asked for.
    await panel({
      steps: [{
        ...plan().steps[0],
        verdict: "attribute-unknown",
        verification: [{
          path: "firewall/policy", attr: "logtraffic", value: "all", status: "attribute-unknown",
          detail: "the firmware on this device publishes no attribute called logtraffic under firewall policy.",
        }],
      }, plan().steps[1]],
    });
    expect(text()).toContain("not in this firmware");
    expect(text()).toContain("publishes no attribute called logtraffic");
  });

  it("lists what the device does accept when it rejects a value", async () => {
    await panel({
      steps: [{
        ...plan().steps[0],
        verdict: "value-unlisted",
        verification: [{
          path: "firewall/policy", attr: "logtraffic", value: "everything", status: "value-unlisted",
          detail: "this device accepts logtraffic, but not everything.",
          options: ["all", "disable", "utm"],
        }],
      }],
    });
    expect(text()).toContain("value not accepted");
    expect(text()).toContain("accepts: all · disable · utm");
  });

  it("says it could not check rather than looking verified", async () => {
    // Failing open would make an unchecked command indistinguishable from a checked one.
    await panel({
      steps: [{
        ...plan().steps[0],
        verdict: "unreadable",
        verification: [{
          path: "firewall/policy", attr: "logtraffic", value: "all", status: "unreadable",
          detail: "this device did not answer for firewall/policy.",
        }],
      }],
    });
    expect(text()).toContain("could not check");
    expect(text()).not.toContain("device-verified");
  });

  it("offers one AI action, not a separate essay button", async () => {
    // "Ask the AI how to run this safely" returned four paragraphs under a button of its own and
    // then sat there. The model earns its place by filling the change form in — supplying the
    // values the console will not invent, what could break, and what gets better — so asking it
    // and opening the change are now the same action.
    await panel();
    expect(text()).not.toContain("Ask the AI");
    expect(text()).toContain("Fix this with AI help");
  });

  it("says there is nothing to do rather than showing an empty plan", async () => {
    await panel({ steps: [], resolves: 0, status: "evidenced", closes: true });
    expect(text()).toContain("There is nothing to fix on this control");
    expect(html()).not.toContain("FORTIOS CLI");
  });

  it("leaves the page behind it visible rather than painting over it", async () => {
    // The backdrop was color-mix(… var(--shell-canvas) 55%, black). color-mix returns an OPAQUE
    // colour, so instead of dimming the audit table it covered it, and the page appeared to vanish
    // the moment the panel opened.
    await panel();
    const overlay = document.body.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(overlay, "the overlay should be in the document").toBeTruthy();
    const bg = overlay!.style.background;
    expect(bg, `backdrop must be translucent, got ${bg}`).toMatch(/\/\s*0?\.\d+|rgba\(/);
    expect(bg).not.toContain("color-mix");
  });

  it("escapes the layout's transformed column instead of being trapped inside it", async () => {
    // MainLayout's content column carries transform-gpu for the sidebar animation, and a transform
    // makes an ancestor the containing block for `fixed` children. Rendered in place, this overlay
    // covered only the content area — the sidebar stayed lit and the page under it went blank.
    await panel();
    const overlay = document.body.querySelector('[role="dialog"]');
    expect(overlay?.parentElement).toBe(document.body);
    expect(container.contains(overlay!)).toBe(false);
  });

  it("takes about a third of the screen, not most of it", async () => {
    // It was max-w-[860px] — on a laptop that is most of the width, for a panel whose job is to sit
    // BESIDE the control row it is about.
    await panel();
    const sheet = document.body.querySelector('[role="dialog"] > div:last-child');
    expect(sheet?.className).toContain("sm:w-[30vw]");
    expect(sheet?.className).not.toContain("max-w-[860px]");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    getPlan.mockResolvedValue(plan());
    mount(<RemediatePanel deviceId={1} controlId="A.8.15" controlTitle="Logging"
      canAsk onClose={onClose} />);
    await act(async () => {});
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces the server's own error rather than a generic one", async () => {
    getPlan.mockRejectedValue({ response: { data: { error: "no control \"A.9.9\" in the catalogue" } } });
    mount(<RemediatePanel deviceId={1} controlId="A.9.9" controlTitle="?" canAsk onClose={() => {}} />);
    await act(async () => {});
    expect(text()).toContain('no control "A.9.9" in the catalogue');
  });
});
