import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyPlan, RemediationAdvice, RemediationPlan } from "../../api/auditRemediation";

// This component writes to a production firewall. The tests are about the gates, in the order a
// change goes through them: it asks before it guesses, it shows exactly what it will send, it
// refuses a command the device could not confirm, and what it wrote can be put back.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const getPreview = vi.fn();
const onOpen = vi.fn();
const doApply = vi.fn();
const doUndo = vi.fn();

vi.mock("../../api/auditRemediation", () => ({
  DeviceAuditRemediationPreview: (...a: unknown[]) => getPreview(...a),
  DeviceAuditRemediationApply: (...a: unknown[]) => doApply(...a),
  DeviceAuditRemediationUndo: (...a: unknown[]) => doUndo(...a),
}));
vi.mock("../../components/ui/toast", () => ({ message: { success: vi.fn(), error: vi.fn() } }));

const { default: ApplyFlow } = await import("./apply");

const plan = { control_id: "A.8.15", steps: [{ check: "policy-no-logging" }] } as unknown as RemediationPlan;

const preview = (over: Partial<ApplyPlan> = {}): ApplyPlan => ({
  control_id: "A.8.15",
  writes: [{
    check: "policy-no-logging", path: "firewall/policy", mkey: "1",
    attrs: { logtraffic: "all" }, verified: "verified",
  }],
  questions: [],
  ready: true,
  ...over,
});

/**
 * Type into a controlled input the way a person does.
 *
 * Assigning `.value` directly is invisible to React: it tracks the last value it rendered and
 * skips the change event when the two match. Going through the prototype's setter is what a real
 * keystroke does.
 */
function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Press the button, then answer the confirmation it raises.
 *
 * The extra flush matters: confirm() resolves a promise, the handler awaits it, and the request
 * only fires a microtask later — without it the assertions run against the dialog rather than
 * against the result.
 */
const clickAndConfirm = async (label: string, ok: string) => {
  await act(async () => { button(label)!.click(); });
  await act(async () => { button(ok)!.click(); });
  await act(async () => {});
};

let container: HTMLDivElement;
let root: Root;

const text = () => document.body.textContent ?? "";
const buttons = () => [...document.body.querySelectorAll("button")];
const button = (label: string) => buttons().find((b) => b.textContent?.includes(label));

const mount = (advice: RemediationAdvice | null = null) => {
  act(() => {
    root = createRoot(container);
    root.render(<ApplyFlow deviceId={1} plan={plan} advice={advice} asking={false}
      onOpen={onOpen} onChanged={() => {}} />);
  });
};

/** Open the flow, which is what fetches the preview. */
const open = async (p: ApplyPlan, advice: RemediationAdvice | null = null) => {
  getPreview.mockResolvedValue({ preview: p, plan });
  mount(advice);
  await act(async () => { button("Fix this with AI help")!.click(); });
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  getPreview.mockReset();
  onOpen.mockReset();
  doApply.mockReset();
  doUndo.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  // confirm() mounts its own root on document.body and tears it down on a later tick, which these
  // tests never reach. Left alone, one test's dialog is still in the document when the next one
  // reads it — and every assertion after that is against the wrong screen.
  document.body.replaceChildren();
});

describe("applying a remediation", () => {
  it("writes nothing until it is opened and confirmed", async () => {
    mount();
    // The resting state is a single button. No preview is fetched and nothing is sent.
    expect(getPreview).not.toHaveBeenCalled();
    expect(doApply).not.toHaveBeenCalled();
    expect(button("Confirm and write")).toBeFalsy();
  });

  it("survives a response where a list came back as null", async () => {
    // THE CRASH. Go marshals a nil slice as JSON `null`, `null.length` throws, and React unmounts
    // the tree — the operator got a white browser window on /admin/audit with no sidebar and no
    // explanation. Six of nine controls did it. The server now always sends arrays; this pins the
    // reader so a null from anywhere costs a row, not the page.
    await open({
      control_id: "A.8.15",
      writes: [{ check: "policy-no-logging", path: "firewall/policy", mkey: "1", attrs: { logtraffic: "all" } }],
      questions: null,
      skipped: null,
      ready: true,
    } as unknown as ApplyPlan);

    expect(text()).toContain("Exactly what would be written");
    expect(text()).toContain("logtraffic");
  });

  it("survives a write whose attributes came back as null", async () => {
    await open({
      control_id: "A.8.15",
      writes: [{ check: "policy-no-logging", path: "firewall/policy", mkey: "1", attrs: null }],
      questions: [],
      skipped: [],
      ready: true,
    } as unknown as ApplyPlan);

    expect(text()).toContain("firewall policy 1");
  });

  it("shows the exact object and attribute it would write", async () => {
    // Not "apply 2 fixes". A firewall is not a thing to change on a summary.
    await open(preview());
    expect(text()).toContain("Exactly what would be written");
    expect(text()).toContain("firewall policy 1");
    expect(text()).toContain("logtraffic");
    expect(text()).toContain("all");
  });

  it("asks for a value it will not invent, and blocks the write until it has one", async () => {
    // Guessing a management subnet locks an administrator out of a production firewall.
    await open(preview({
      ready: false,
      writes: [{
        check: "admin-unrestricted", path: "system/admin", mkey: "admin",
        attrs: {}, unanswered: ["trusthost1"], verified: "attribute-only",
      }],
      questions: [{
        id: "admin-unrestricted|system/admin|admin|trusthost1",
        check: "admin-unrestricted", path: "system/admin", mkey: "admin", attr: "trusthost1",
        placeholder: "<management-subnet> <mask>",
        prompt: "What should trusthost1 be set to on system admin admin?",
      }],
    }));

    expect(text()).toContain("cannot be chosen for you");
    expect(text()).toContain("trusthost1");
    expect(button("Confirm and write")?.hasAttribute("disabled")).toBe(true);
  });

  it("offers the model's suggested values, drawn from the device", async () => {
    const advice = {
      risk: "", rollback: "", verify: "", window: "", benefit: "", order: [],
      answers: [{
        question_id: "q1",
        prompt: "Which network should be allowed to manage this firewall?",
        options: [{ value: "10.0.99.0 255.255.255.0", label: "the lan subnet", note: "where you are now" }],
      }],
    } as unknown as RemediationAdvice;

    await open(preview({
      ready: false,
      questions: [{
        id: "q1", check: "admin-unrestricted", path: "system/admin", mkey: "admin",
        attr: "trusthost1", placeholder: "<management-subnet> <mask>", prompt: "plain prompt",
      }],
    }), advice);

    // The model's wording replaces the generated one, and its option is offered.
    expect(text()).toContain("Which network should be allowed to manage this firewall?");
    expect(text()).toContain("10.0.99.0 255.255.255.0");
    expect(text()).toContain("where you are now");
  });

  it("re-reads what would be written when an answer changes", async () => {
    // The confirmation builds itself as the form is filled in, rather than being a final screen the
    // reader has to trust.
    await open(preview({
      ready: false,
      questions: [{
        id: "q1", check: "admin-unrestricted", path: "system/admin", mkey: "admin",
        attr: "trusthost1", placeholder: "<subnet>", prompt: "p",
      }],
    }));
    getPreview.mockClear();

    const input = document.body.querySelector("input[type=text]") as HTMLInputElement;
    await act(async () => { typeInto(input, "10.0.99.0 255.255.255.0"); });
    expect(getPreview).toHaveBeenCalledWith(1, "A.8.15", { q1: "10.0.99.0 255.255.255.0" });
  });

  it("will not write a command this firmware did not confirm without a separate acknowledgement", async () => {
    await open(preview({
      writes: [{
        check: "policy-no-logging", path: "firewall/policy", mkey: "1",
        attrs: { logtraffic: "all" }, verified: "attribute-unknown",
      }],
    }));
    expect(text()).toContain("did not confirm the command");
    expect(button("Confirm and write")?.hasAttribute("disabled")).toBe(true);

    const ack = document.body.querySelector("input[type=checkbox]") as HTMLInputElement;
    await act(async () => { ack.click(); });
    expect(button("Confirm and write")?.hasAttribute("disabled")).toBe(false);
  });

  it("says what it will not do from here, rather than dropping it quietly", async () => {
    await open(preview({
      skipped: [{ check: "policy-shadowed", reason: "this one reorders a rule rather than changing a setting" }],
    }));
    expect(text()).toContain("Not done from here");
    expect(text()).toContain("policy-shadowed");
  });

  it("asks the AI as part of opening the change, not as a separate errand", async () => {
    // There used to be a second button that fetched four paragraphs and then sat there. Opening
    // the change and asking for help are one action now.
    await open(preview());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("shows what could break and what gets better, both marked as the AI's", async () => {
    const advice = {
      risk: "Log volume will rise immediately.",
      benefit: "Every permitted session is recorded, so an investigation has something to work from.",
    } as unknown as RemediationAdvice;
    await open(preview(), advice);
    expect(text()).toContain("Log volume will rise immediately.");
    expect(text()).toContain("Every permitted session is recorded");
    // Neither is presented as something the engine computed.
    expect(text()).toContain("(AI)");
  });

  it("asks once more before it writes, and writes nothing if the answer is no", async () => {
    // The panel already lists what would be sent, but the last thing between a reader and a
    // production firewall should be a deliberate second action.
    await open(preview());
    await act(async () => { button("Confirm and write")!.click(); });

    expect(text()).toContain("Write 1 change to this firewall?");
    expect(text()).toContain("logtraffic → all");
    expect(doApply).not.toHaveBeenCalled();

    await act(async () => { button("Cancel")!.click(); });
    expect(doApply).not.toHaveBeenCalled();
  });

  it("offers to put it back once it has written", async () => {
    await open(preview());
    doApply.mockResolvedValue({
      results: [{ check: "policy-no-logging", path: "firewall/policy", mkey: "1", attrs: {}, ok: true, change_id: 42 }],
      applied: 1,
    });
    await clickAndConfirm("Confirm and write", "Write it");

    expect(doApply).toHaveBeenCalledWith(1, "A.8.15", {}, false);
    expect(text()).toContain("1 change written");
    expect(text()).toContain("Change Ledger");

    doUndo.mockResolvedValue({ results: [{ change_id: 42, ok: true }] });
    // Undo writes to the live firewall too, and it is the button people press in a hurry.
    await clickAndConfirm("Put it back", "Restore it");
    expect(doUndo).toHaveBeenCalledWith(1, [42]);
  });

  it("reports a failed write instead of claiming success", async () => {
    await open(preview());
    doApply.mockResolvedValue({
      results: [{ check: "policy-no-logging", path: "firewall/policy", mkey: "1", attrs: {}, ok: false, error: "error -5" }],
      applied: 1,
      error: "error -5",
    });
    await clickAndConfirm("Confirm and write", "Write it");

    expect(text()).toContain("0 changes written, 1 failed");
    expect(text()).toContain("error -5");
    // Nothing landed, so there is nothing to put back.
    expect(button("Put it back")).toBeFalsy();
  });
});
