import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The dictionaries are the real ones in production; here they are replaced with a handful of
// entries so the test asserts on the MECHANISM (what gets translated, what is left alone) rather
// than on the current Thai wording of some page, which is free to change.
vi.mock("./dictionary/th", () => ({
  th: {
    "Static Routes": "เส้นทางแบบกำหนดเอง",
    "Search routes…": "ค้นหาเส้นทาง…",
    Blackhole: "หลุมดำ",
    Delete: "ลบ",
    English: "ควรจะไม่ถูกแตะ",
    // A noun a component builds a sentence around, rather than renders on its own.
    "user group": "กลุ่มผู้ใช้",
  },
}));
vi.mock("./dictionary/zh", () => ({ zh: { "Static Routes": "静态路由" } }));
vi.mock("./dictionary/th.patterns", () => ({
  thPatterns: {
    // Deliberately reordered: Thai puts the unit before the count here, which is the entire reason
    // patterns interpolate into the translation instead of being glued together end to end.
    "Showing {} of {} routes": "จาก {} เส้นทาง แสดง {}",
    "Delete {}?": "ลบ {} หรือไม่?",
    // Numbered holes: Thai wants the device count first, English put the command count there.
    "Send {} command(s) to {} device(s)": "ส่งไปยังอุปกรณ์ {2} เครื่อง จำนวน {1} คำสั่ง",
    "Search {}…": "ค้นหา{}…",
    "This device has no {} yet": "อุปกรณ์นี้ยังไม่มี{}",
  },
}));
vi.mock("./dictionary/zh.patterns", () => ({ zhPatterns: {} }));

import { setLang } from "./lang";
import { ensureLanguage } from "./translate";

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLElement }> = [];

const render = (node: React.ReactNode): string => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  mounted.push({ root, host });
  return host.innerHTML;
};

// The dictionaries are code-split now, so they have to be in memory before a synchronous
// setLang can mean anything. Loaded once for the file rather than per test: registering is
// idempotent and the mocked tables above are what actually gets installed.
beforeAll(async () => {
  await ensureLanguage("th");
  await ensureLanguage("zh");
});

beforeEach(() => setLang("th"));

afterEach(() => {
  act(() => {
    for (const { root, host } of mounted.splice(0)) {
      root.unmount();
      host.remove();
    }
  });
  setLang("en");
});

describe("the translating JSX runtime", () => {
  it("translates a string child of a host element", () => {
    expect(render(<h1>Static Routes</h1>)).toContain("เส้นทางแบบกำหนดเอง");
  });

  it("translates one string among mixed children, and keeps the spacing around it", () => {
    // <span><Icon /> Blackhole</span> hands React the child " Blackhole", leading space included.
    // Losing that space runs the label into the icon.
    const html = render(<span><i /> Blackhole</span>);
    expect(html).toContain("<i></i> หลุมดำ");
  });

  it("translates display-only attributes", () => {
    const html = render(<input placeholder="Search routes…" title="Static Routes" readOnly />);
    expect(html).toContain('placeholder="ค้นหาเส้นทาง…"');
    expect(html).toContain('title="เส้นทางแบบกำหนดเอง"');
  });

  it("reaches text a component only renders later", () => {
    // The whole reason this is a JSX runtime and not a `t()` call: PageHeader's own file says
    // nothing about i18n, and its <h1> is what gets translated.
    const PageHeader = ({ title }: { title: string }) => <h1>{title}</h1>;
    expect(render(<PageHeader title="Static Routes" />)).toContain("เส้นทางแบบกำหนดเอง");
  });

  it("translates a display prop handed to a component, for text a library renders", () => {
    // recharts and FullCalendar compile against React's own runtime, so their internals never pass
    // through here — but the props they are given do.
    const Chart = ({ label }: { label: string }) => <div data-label={label} />;
    expect(render(<Chart label="Static Routes" />)).toContain('data-label="เส้นทางแบบกำหนดเอง"');
  });

  it("leaves device data alone", () => {
    // No entry, so it falls through. This is the path every policy name, interface and FortiGate
    // error message takes.
    expect(render(<span>port1</span>)).toContain("port1");
    expect(render(<span>WAN-to-LAN-allow</span>)).toContain("WAN-to-LAN-allow");
  });

  it("leaves machine output inside <code> and <pre> verbatim", () => {
    expect(render(<code>Static Routes</code>)).toContain("Static Routes");
    expect(render(<pre>Static Routes</pre>)).toContain("Static Routes");
  });

  it("never touches value, className or href", () => {
    const html = render(
      <a className="Static Routes" href="/Static Routes" title="Delete">
        <input value="Static Routes" readOnly />
      </a>,
    );
    expect(html).toContain('class="Static Routes"');
    expect(html).toContain('href="/Static Routes"');
    expect(html).toContain('value="Static Routes"');
    expect(html).toContain('title="ลบ"'); // the one attribute on that element that IS display text
  });

  it("puts interpolated values into the translation's own word order", () => {
    expect(render(<span>{`Showing ${3} of ${12} routes`}</span>)).toContain("จาก 3 เส้นทาง แสดง 12");
  });

  it("matches a pattern around arbitrary device data", () => {
    expect(render(<span>{`Delete ${"WAN-to-LAN-allow"}?`}</span>))
      .toContain("ลบ WAN-to-LAN-allow หรือไม่?");
  });

  it("puts numbered holes where the translation asks for them, not where English had them", () => {
    // The bug this guards: filling left to right would render "3 devices, 12 commands" - both
    // numbers present, both in the wrong place, and nothing on screen to hint at it.
    expect(render(<span>{`Send ${12} command(s) to ${3} device(s)`}</span>))
      .toContain("ส่งไปยังอุปกรณ์ 3 เครื่อง จำนวน 12 คำสั่ง");
  });

  it("renders English untouched when the language is English", () => {
    setLang("en");
    expect(render(<h1>Static Routes</h1>)).toContain("Static Routes");
  });

  it("uses the dictionary for the language that is actually set", () => {
    setLang("zh");
    expect(render(<h1>Static Routes</h1>)).toContain("静态路由");
  });

  it("translates the word a sentence is built around, not just the sentence", () => {
    // StateBlock's shape: the page hands in an English noun and the component builds a sentence
    // from it. The noun must reach the dictionary through the hole, or the screen reads
    // "อุปกรณ์นี้ยังไม่มีuser group" - a Thai sentence with an English word welded into it.
    expect(render(<span>{`This device has no ${"user group"} yet`}</span>))
      .toContain("อุปกรณ์นี้ยังไม่มีกลุ่มผู้ใช้");
  });

  it("finishes a sentence whose ingredient was translated before it was assembled", () => {
    // The other order, and the one that used to fail silently. A component receives `title`, which
    // the runtime translated when the element was created, and only then builds a sentence out of
    // it - so this arrives half-Thai. Skipping it as "already translated" left "Search " in
    // English on an otherwise Thai screen.
    expect(render(<span>{`Search ${"กลุ่มผู้ใช้"}…`}</span>)).toContain("ค้นหากลุ่มผู้ใช้…");
  });

  it("leaves a fully translated string alone", () => {
    const html = render(<span>{"เส้นทางแบบกำหนดเอง"}</span>);
    expect(html).toContain("เส้นทางแบบกำหนดเอง");
  });
});
