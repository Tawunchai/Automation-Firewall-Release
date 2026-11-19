import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditReport, ControlCoverage, FrameworkCoverage } from "../../api/policyObject";
import type { ReferenceCatalogue } from "../../api/auditRemediation";

// The ISO tab's job is to be readable by somebody who will be challenged on it. Two properties
// carry that, and both are testable:
//
//   1. Every sentence is attributed. The control NAME is ISO/IEC's, the quoted requirement is
//      NIST's, the correspondence between them is ours, and the page says so for each one. The
//      failure this guards is the quiet one — a paragraph we wrote sitting under a real control
//      number looking like the publisher's.
//   2. A control nothing here assesses is offered no fix, because there is nothing to fix: the row
//      already states what would have to be read for it to be answerable.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const getReference = vi.fn();

vi.mock("../../api/auditRemediation", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  AuditReference: () => getReference(),
  DeviceAuditRemediation: vi.fn(),
  DeviceAuditRemediationAdvice: vi.fn(),
}));
vi.mock("../../components/ui/toast", () => ({ message: { success: vi.fn(), error: vi.fn() } }));

const { default: StandardsView } = await import("./standards");

const control = (over: Partial<ControlCoverage>): ControlCoverage => ({
  id: "A.8.15", title: "Logging", title_source: "official", status: "gap",
  strength: "direct", checks: ["policy-no-logging"], findings: 3, ...over,
});

const framework: FrameworkCoverage = {
  id: "iso-27001", name: "ISO/IEC 27001", version: "2022", publisher: "ISO/IEC",
  note: "The Annex A controls a network device configuration can speak to.",
  catalogue_status: "draft",
  controls: [
    control({}),
    control({ id: "A.8.17", title: "Clock synchronization", status: "evidenced", findings: 0 }),
    control({
      id: "A.8.32", title: "Change management", status: "not-assessed",
      strength: undefined, checks: [], findings: 0,
      not_assessed: "Authorisation is not recorded in any configuration this console holds.",
    }),
  ],
  gaps: 1, evidenced: 1, indeterminate: 0, accepted: 0, observations: 0,
  not_assessed: 1, assessed: 2,
};

const report: AuditReport = {
  scanned_at: "2026-09-08T10:55:48Z",
  stats: { policies: 7, policies_disabled: 0, addresses: 12, services: 4, schedules: 1, profiles: 6 },
  counts: { high: 1 }, findings: [], standards: [framework],
};

const catalogue: ReferenceCatalogue = {
  source: {
    doc: {
      id: "NIST SP 800-53 Rev. 5",
      title: "Security and Privacy Controls for Information Systems and Organizations",
      publisher: "National Institute of Standards and Technology",
      url: "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final",
      public_domain: true,
    },
    version: "5.2.0",
    note: "The text below is quoted from NIST SP 800-53 Rev. 5. Which SP 800-53 control corresponds to which ISO/IEC 27001 Annex A control is this console's own reading.",
  },
  authoritative: {
    id: "ISO/IEC 27001:2022", title: "Information security management systems — Requirements",
    publisher: "ISO/IEC", url: "https://www.iso.org/standard/27001", public_domain: false,
  },
  references: {
    "A.8.15": {
      framework_id: "iso-27001", control_id: "A.8.15",
      why: "Both are about which events are recorded and what each record contains.",
      controls: [{
        id: "AU-2", title: "Event Logging",
        statement: "a. Identify the types of events that the system is capable of logging;",
        guidance: "An event is an observable occurrence in a system.",
      }],
    },
  },
};

let container: HTMLDivElement;
let root: Root;

const render = async (props: Partial<React.ComponentProps<typeof StandardsView>> = {}) => {
  getReference.mockResolvedValue(catalogue);
  act(() => {
    root = createRoot(container);
    root.render(<StandardsView report={report} deviceId={1} isAdmin {...props} />);
  });
  await act(async () => {});
};

const text = () => container.textContent ?? "";
const buttons = () => [...container.querySelectorAll("button")];
const button = (label: string) => buttons().find((b) => b.textContent?.includes(label));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  getReference.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

describe("the ISO/IEC 27001 tab", () => {
  it("offers to explain what a control asks for", async () => {
    await render();
    expect(button("What this control asks for"), "the reference expander should be offered").toBeTruthy();
  });

  it("quotes NIST verbatim and attributes both halves separately", async () => {
    await render();
    await act(async () => { button("What this control asks for")!.click(); });

    // NIST's words, marked as NIST's and as public domain.
    expect(text()).toContain("Identify the types of events that the system is capable of logging");
    expect(text()).toContain("NIST SP 800-53 Rev. 5 · public domain");
    // The correspondence, marked as ours.
    expect(text()).toContain("Both are about which events are recorded");
    expect(text()).toContain("(our reading)");
    // And the route to the words this product may not print.
    expect(text()).toContain("the authoritative wording");
  });

  it("offers a fix for a control that has one", async () => {
    await render();
    expect(button("How to close this")).toBeTruthy();
  });

  it("offers no fix for a control nothing here assesses", async () => {
    // The row already says what would have to be read for it to be answerable. A "how to close
    // this" button beside it would promise something this console cannot deliver.
    await render({
      report: {
        ...report,
        standards: [{ ...framework, controls: [framework.controls[2]] }],
      },
    });
    expect(button("How to close this")).toBeFalsy();
  });

  it("offers no fix for a control that is already evidenced", async () => {
    await render({
      report: { ...report, standards: [{ ...framework, controls: [framework.controls[1]] }] },
    });
    expect(button("How to close this")).toBeFalsy();
  });

  it("offers no fix when no device is selected", async () => {
    await render({ deviceId: undefined });
    expect(button("How to close this")).toBeFalsy();
  });

  it("still renders every control when the reference catalogue cannot be fetched", async () => {
    // The reading material is an addition. Losing it must cost one button, not the page.
    getReference.mockRejectedValue(new Error("offline"));
    act(() => {
      root = createRoot(container);
      root.render(<StandardsView report={report} deviceId={1} isAdmin />);
    });
    await act(async () => {});

    expect(text()).toContain("Logging");
    expect(text()).toContain("Clock synchronization");
    expect(button("What this control asks for")).toBeFalsy();
    expect(button("How to close this"), "a fix does not depend on the reading material").toBeTruthy();
  });

  it("never claims compliance", async () => {
    await render();
    await act(async () => { button("What this control asks for")!.click(); });
    expect(text().toLowerCase()).not.toContain("compliant");
  });
});
