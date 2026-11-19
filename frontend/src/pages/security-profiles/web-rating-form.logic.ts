// The pure half of web-rating-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { type WebRatingOverrideForm, type WebRatingMetadata, type WebRatingCategory } from "../../api/policyObject";

export const EMPTY_WEB_RATING_FORM: WebRatingOverrideForm = {
  url: "", rating: "", status: true, comment: "",
};

/** One dropdown group: a category group and the categories inside it, both in the device's order. */
export type CategoryGroup = { key: string; label: string; items: WebRatingCategory[] };

/**
 * Builds the Category → Sub-Category tree from the device's taxonomy.
 *
 * Order is the device's own — the FortiGuard endpoint returns groups and categories in the order
 * the real GUI lists them, so nothing is sorted here. Custom categories come last, as their own
 * group, which is where the dialog puts them.
 */
export const buildCategoryGroups = (meta: WebRatingMetadata): CategoryGroup[] => {
  const groups: CategoryGroup[] = [];
  const byKey = new Map<string, CategoryGroup>();

  for (const c of meta.categories ?? []) {
    const key = String(c.group_id);
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: c.group || `Group ${c.group_id}`, items: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.items.push(c);
  }

  const locals = meta.local_categories ?? [];
  if (locals.length > 0) {
    groups.push({ key: "local", label: locals[0].group || "Custom Categories", items: locals });
  }
  return groups;
};
