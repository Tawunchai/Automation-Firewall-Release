// The pure half of admin-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { splitHosts, type AdminDraft } from "./model";

export const lockoutMessage = (d: AdminDraft): string =>
  `${d.name} will only be able to log in from ${splitHosts(d.trustHosts).join(", ")}.`;
