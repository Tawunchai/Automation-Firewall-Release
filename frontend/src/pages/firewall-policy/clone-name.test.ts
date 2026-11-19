import { describe, expect, it } from "vitest";
import { POLICY_NAME_MAX, suggestCopyName } from "./clone-name";

describe("suggestCopyName", () => {
  it("appends -copy to a fresh name", () => {
    expect(suggestCopyName("lan-to-wan", ["lan-to-wan"])).toBe("lan-to-wan-copy");
  });

  it("numbers the next one rather than colliding", () => {
    expect(suggestCopyName("lan-to-wan", ["lan-to-wan", "lan-to-wan-copy"])).toBe("lan-to-wan-copy2");
    expect(suggestCopyName("lan-to-wan", ["lan-to-wan-copy", "lan-to-wan-copy2"])).toBe("lan-to-wan-copy3");
  });

  it("does not stack -copy-copy when cloning a copy", () => {
    expect(suggestCopyName("lan-to-wan-copy", ["lan-to-wan-copy"])).toBe("lan-to-wan-copy2");
  });

  it("matches case-insensitively, like FortiOS does", () => {
    expect(suggestCopyName("LAN", ["lan-copy"])).toBe("LAN-copy2");
  });

  it("never exceeds the 35-character policy name limit", () => {
    const long = "a".repeat(40);
    expect(suggestCopyName(long, []).length).toBeLessThanOrEqual(POLICY_NAME_MAX);
  });

  // ⚠️ Truncating from the right would turn "…copy1" and "…copy12" into the same string, which is
  // the one thing a name suggester must not do. The BASE is trimmed instead, so the digits survive.
  it("keeps the number when the name has to be truncated", () => {
    const long = "b".repeat(POLICY_NAME_MAX);
    const taken = [long];
    const first = suggestCopyName(long, taken);
    const second = suggestCopyName(long, [...taken, first]);
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(POLICY_NAME_MAX);
    expect(second.length).toBeLessThanOrEqual(POLICY_NAME_MAX);
  });
});
