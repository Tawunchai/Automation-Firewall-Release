import { describe, expect, it, vi } from "vitest";

/**
 * What happens when the dictionary chunk cannot be fetched at all.
 *
 * This is a real state, not a hypothetical: the console is served from the firewall's own network,
 * and a chunk request can 404 outright after a redeploy while an old tab is still open. The rule is
 * that a language nobody could download must leave a WORKING English console behind, and must not
 * mark itself loaded — otherwise the retry never happens and the session is stuck in English until
 * someone reloads the page.
 */
vi.mock("./dictionary/th.lazy", () => {
  throw new Error("chunk 404");
});
vi.mock("./dictionary/zh.lazy", () => ({ default: { exact: {}, patterns: {} } }));

import { ensureLanguage, isLanguageReady, translate } from "./translate";

describe("a dictionary that will not load", () => {
  it("does not reject, does not register, and leaves the console readable", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(ensureLanguage("th")).resolves.toBeUndefined();

    expect(isLanguageReady("th")).toBe(false);
    expect(translate("Static Routes", "th")).toBe("Static Routes");
    expect(errors).toHaveBeenCalled();

    // Unregistered means retryable. A second attempt must actually try again rather than resolve
    // instantly off a poisoned in-flight promise.
    await expect(ensureLanguage("th")).resolves.toBeUndefined();
    expect(isLanguageReady("th")).toBe(false);

    errors.mockRestore();
  });
});
