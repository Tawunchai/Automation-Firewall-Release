import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dictionaries are code-split, and this is what stops that from quietly becoming a
 * half-translated console.
 *
 * The optimisation is worth 182 KB gzip off every cold load — the Thai and Chinese tables used to
 * ride in the entry chunk, so an English session downloaded both and a Thai session downloaded the
 * Chinese one. What it costs is a window: between "the app started" and "the table arrived" there
 * is no dictionary, and `translate` has to behave sanely inside it. These tests are about that
 * window, because everything in it fails SILENTLY — a missing entry renders the English and looks
 * like a translation nobody has written yet.
 */

let thLoads = 0;

vi.mock("./dictionary/th.lazy", () => {
  thLoads++;
  return {
    default: {
      exact: { "Static Routes": "เส้นทางแบบกำหนดเอง" },
      patterns: { "Delete {}?": "ลบ {} หรือไม่?" },
    },
  };
});

vi.mock("./dictionary/zh.lazy", () => ({
  default: { exact: { "Static Routes": "静态路由" }, patterns: {} },
}));

import { ensureLanguage, hasTranslation, isLanguageReady, registerLanguage, translate } from "./translate";

describe("lazily loaded dictionaries", () => {
  it("treats English as always ready and never loads anything for it", async () => {
    // English is not a translation, it is the key. A session that never leaves it must not pay a
    // request, which is the larger half of what the split buys.
    expect(isLanguageReady("en")).toBe(true);
    await ensureLanguage("en");
    expect(translate("Static Routes", "en")).toBe("Static Routes");
  });

  it("renders English, not a crash, while a dictionary is still in flight", () => {
    // The gate in main.tsx means the app does not normally render in this state — but anything
    // that translates outside React (toasts fire from api-layer catches) can, and a thrown error
    // there would take down a screen for the sake of a word.
    expect(isLanguageReady("th")).toBe(false);
    expect(translate("Static Routes", "th")).toBe("Static Routes");
    expect(translate("Delete Web-Servers?", "th")).toBe("Delete Web-Servers?");
    expect(hasTranslation("Static Routes", "th")).toBe(false);
  });

  it("translates exact entries AND patterns once the dictionary arrives", async () => {
    await ensureLanguage("th");

    expect(isLanguageReady("th")).toBe(true);
    expect(translate("Static Routes", "th")).toBe("เส้นทางแบบกำหนดเอง");

    // THE ONE THAT MATTERS. The pattern matcher memoises its compiled regexes per language on
    // first use, and the test above consulted it while the table was still missing. If that empty
    // result had been cached — which is exactly what the original code did — this line would come
    // back in English forever after, with no error anywhere to say why.
    expect(translate("Delete Web-Servers?", "th")).toBe("ลบ Web-Servers หรือไม่?");
  });

  it("does not fetch the same dictionary twice, however many callers ask at once", async () => {
    const before = thLoads;
    await Promise.all([ensureLanguage("th"), ensureLanguage("th"), ensureLanguage("th")]);
    expect(thLoads).toBe(before);

    // And a language already in memory resolves without touching the network at all, which is what
    // makes switching back to a language instant.
    expect(isLanguageReady("th")).toBe(true);
  });

  it("keeps the languages independent — loading one does not load the other", async () => {
    await ensureLanguage("th");
    expect(isLanguageReady("zh")).toBe(false);
    expect(translate("Static Routes", "zh")).toBe("Static Routes");

    await ensureLanguage("zh");
    expect(translate("Static Routes", "zh")).toBe("静态路由");
    // …and Thai is still Thai. One registry per language, not one shared table.
    expect(translate("Static Routes", "th")).toBe("เส้นทางแบบกำหนดเอง");
  });
});

describe("registerLanguage", () => {
  beforeEach(() => {
    registerLanguage("th", { Delete: "ลบ" }, { "Delete {}?": "ลบ {} หรือไม่?" });
  });

  it("replaces the table and invalidates what was compiled from the old one", () => {
    expect(translate("Delete", "th")).toBe("ลบ");

    registerLanguage("th", { Delete: "REPLACED" }, { "Delete {}?": "REPLACED {}" });
    expect(translate("Delete", "th")).toBe("REPLACED");
    // The pattern cache has to be dropped with the exact table, or a re-register leaves the two
    // halves disagreeing about which dictionary is loaded.
    expect(translate("Delete Web-Servers?", "th")).toBe("REPLACED Web-Servers");
  });

  it("refuses to install a dictionary for English", () => {
    // en has no table by definition; letting one be installed would put a lookup on the hot path
    // for the language that is supposed to skip it.
    registerLanguage("en", { Delete: "SHOULD NOT APPLY" }, {});
    expect(translate("Delete", "en")).toBe("Delete");
  });
});
