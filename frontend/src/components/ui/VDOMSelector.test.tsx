import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeviceVDOM } from "../../api/vdom";

// The picker has exactly one job beyond looking like the device selector: to appear only when
// there is a tenant to get wrong, and to name the tenant the requests are actually going to. Both
// failures are silent — a picker that never appears on a split unit hides two thirds of the
// firewall, and one naming the wrong VDOM is the console lying about what you are editing.

const ctx = {
  device: null, setDevice: () => {}, devices: [], loading: false,
  reload: async () => {},
  vdom: "", setVDOM: () => {}, vdoms: [] as DeviceVDOM[], vdomSplit: false,
};

vi.mock("../../contexts/DeviceContext.logic", () => ({ useSelectedDevice: () => ctx }));

const { default: VDOMSelector } = await import("./VDOMSelector");

const vd = (name: string, over: Partial<DeviceVDOM> = {}): DeviceVDOM => ({
  name, management: false, multi_vdom: true, ...over,
});

/** Renders with the given context state and hands back the markup. */
const render = (state: Partial<typeof ctx>): string => {
  Object.assign(ctx, { vdom: "", vdoms: [], vdomSplit: false }, state);
  return renderToStaticMarkup(<VDOMSelector />);
};

describe("VDOMSelector", () => {
  it("renders nothing on a unit that is not split — which is most of them", () => {
    // The lab FGT80E's live answer: one row, multi_vdom false. A picker with one option implies a
    // choice nobody has.
    expect(render({ vdoms: [vd("root", { management: true, multi_vdom: false })] })).toBe("");
  });

  it("renders nothing while the device's VDOM list has not arrived", () => {
    expect(render({ vdomSplit: false, vdoms: [] })).toBe("");
  });

  it("names root when the unit is split but nothing has been picked", () => {
    // Not the management VDOM — the backend's default really is root (services.vdomParam), and the
    // label has to say where the reads are going, not where they arguably should.
    const html = render({ vdomSplit: true, vdoms: [vd("core", { management: true }), vd("sales")] });
    expect(html).toContain("root");
    expect(html).not.toContain("sales");
  });

  it("names the picked VDOM", () => {
    const html = render({
      vdom: "sales",
      vdomSplit: true,
      vdoms: [vd("root", { management: true }), vd("sales")],
    });
    expect(html).toContain("sales");
  });
});
