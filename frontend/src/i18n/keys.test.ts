import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "./locales/en";

/**
 * Every `t("some.key")` in the app must resolve to a string in the bundle.
 *
 * This exists because a missing key is invisible until it is on screen, and then it is very
 * visible. i18next's default for an unknown key is to return the key itself, so `t("account.save")`
 * with no such entry does not throw, does not warn in a build, and does not fail a type check — it
 * renders a button labelled **account.save**. The `t("x") || "Save"` idiom that appears next to
 * several of these does not save you either: the key string is truthy, so the fallback never runs.
 *
 * Four keys had shipped that way when this test was written: the Personal Information card's
 * Edit / Save / Cancel buttons and the Recycle Bin's purge dialog.
 *
 * Static extraction rather than rendering: it only sees `t("literal")`, so a computed key
 * (`t(\`totp.${state}\`)`) is invisible to it. That is a deliberate limit, not an oversight — the
 * alternative is mounting all fifty pages, and the literal form is what the codebase overwhelmingly
 * uses and what regresses.
 */

const SRC = path.resolve(__dirname, "..");

/** Matches t("a.b") and t("a.b.c") — a dot is required, so t("plain") is left alone. */
const T_CALL = /\bt\(\s*"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function resolves(key: string): boolean {
  const parts = key.split(".");
  let node: unknown = en;
  for (const part of parts) {
    if (node === null || typeof node !== "object") return false;
    node = (node as Record<string, unknown>)[part];
  }
  if (node !== undefined) return true;

  // i18next stores plurals as `key_one` / `key_other`; the call site names the base key.
  let parent: unknown = en;
  for (let i = 0; i < parts.length - 1; i++) {
    if (parent === null || typeof parent !== "object") return false;
    parent = (parent as Record<string, unknown>)[parts[i]];
  }
  if (parent === null || typeof parent !== "object") return false;
  const leaf = parts[parts.length - 1];
  const bag = parent as Record<string, unknown>;
  return bag[`${leaf}_one`] !== undefined || bag[`${leaf}_other`] !== undefined;
}

describe("i18n bundle", () => {
  it("defines every key the app asks for", () => {
    const missing: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(T_CALL)) {
        const key = match[1];
        if (resolves(key)) continue;
        missing.push(`${key}  (${path.relative(SRC, file).replace(/\\/g, "/")})`);
      }
    }

    expect(
      [...new Set(missing)].sort(),
      "these keys are referenced but not defined in locales/en.ts — i18next renders the key " +
        "itself, so each one is a raw `section.key` visible in the UI",
    ).toEqual([]);
  });
});
