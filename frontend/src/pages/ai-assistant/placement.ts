import { useCallback } from "react";
import type { PolicyFormState } from "../firewall-policy/create.logic";
import type { ChatItem } from "./index";

// Where a proposed policy goes in the rule table — the one fact the wizard, the placement board and
// the simulation all have to agree on.
//
// It is REFERENCE-BASED, not positional: `beforeId` is the id of the live policy the new one should
// sit BEFORE, and null means the bottom of its own interface pair (which is what Apply does when
// nobody has dragged anything). An index would go stale the moment another rule was created.
//
// These three lived inside index.tsx, which is over its size budget. They are not page state — they
// are a small vocabulary shared by four call sites — so they live here, where the simulation can
// import them without pulling in the chat page.

/** The interface pair a policy belongs to. Placement is per-pair: first match wins within one. */
export const pairOf = (f: Partial<PolicyFormState>) => `${f.srcIntf || "any"}→${f.dstIntf || "any"}`;

/** Key into the per-(message, pair) anchor map, so two policies of one answer share a slot. */
export const anchorKey = (i: number, pair: string) => `${i}:${pair}`;

/**
 * Reads the anchor the Policy Wizard writes, for policy `k` of message `i`.
 *
 * The Simulate panel walks the table at THIS position. If it guessed instead — "appended at the
 * bottom", say — it would draw a persuasive picture of a rule base nobody is going to create, which
 * is a worse failure than not drawing one at all.
 */
export function useAnchorFor(anchors: Map<string, number | null>) {
  return useCallback((i: number, it: ChatItem, k: number): number | null => {
    const draft = (it.policyDrafts ?? [])[k];
    if (!draft) return null;
    return anchors.get(anchorKey(i, pairOf(draft.form))) ?? null;
  }, [anchors]);
}
