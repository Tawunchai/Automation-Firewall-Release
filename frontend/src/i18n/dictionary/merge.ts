/**
 * Joins the per-area dictionary files into the one table ../translate.ts looks up in.
 *
 * The dictionaries are split by the part of the console they belong to — `policy`, `vpn`, `ai` and
 * so on — because a single 2,750-line object is unreviewable, and because translating a word well
 * needs to know where it appears: "Interface" is a network port on the Policy pages and a piece of
 * UI everywhere else, and keeping those files apart is what makes that distinction visible to
 * whoever edits them next.
 *
 * A string that appears in two areas is expected and fine — `Enabled` is in half of them — as long
 * as the two agree. Two DIFFERENT translations for one English string is a real defect: the same
 * word would render differently on two pages depending on which module happened to load last. That
 * is what the conflict check catches, and there is a test on it in ../dictionary.test.ts.
 */

export type Dict = Readonly<Record<string, string>>;

/** Merged table plus every English key two areas disagreed about. */
export type MergeResult = { merged: Record<string, string>; conflicts: string[] };

export function mergeDicts(parts: readonly Dict[]): MergeResult {
  const merged: Record<string, string> = Object.create(null);
  const conflicts: string[] = [];

  for (const part of parts) {
    for (const [english, translated] of Object.entries(part)) {
      const existing = merged[english];
      if (existing !== undefined && existing !== translated) conflicts.push(english);
      merged[english] = translated;
    }
  }

  return { merged, conflicts };
}

/**
 * The merge as the app uses it: table only, conflicts reported to the console in development.
 *
 * Not thrown on, deliberately. A disagreement between two areas is a wording bug, and taking the
 * whole console down over a wording bug — on a machine sitting next to the firewall someone is
 * trying to fix — would be the wrong trade. The test fails the build instead.
 */
export function buildDict(parts: readonly Dict[], label: string): Dict {
  const { merged, conflicts } = mergeDicts(parts);
  if (import.meta.env?.DEV && conflicts.length) {
    console.warn(
      `[i18n] ${label}: ${conflicts.length} string(s) translated two different ways`,
      conflicts,
    );
  }
  return merged;
}
