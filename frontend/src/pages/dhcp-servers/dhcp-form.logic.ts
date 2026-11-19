// The pure half of dhcp-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

export const LEASE_PRESETS: Array<[string, number]> = [
  ["30 minutes", 1800],
  ["1 hour", 3600],
  ["8 hours", 28800],
  ["1 day", 86400],
  ["7 days", 604800],
];
