// The pure half of file-filter-sections.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

export const DIRECTION_PROTOCOLS = new Set(["http", "ftp", "ssh", "cifs"]);

export const directionApplies = (protocols: string[]) =>
  protocols.some((p) => DIRECTION_PROTOCOLS.has(p.toLowerCase()));

export const PASSWORD_PROTECTED_FALLBACK = ["7z", "msoffice", "msofficex", "pdf", "rar", "zip"];

export const allowedFileTypes = (
  passwordProtected: boolean, all: string[], passwordProtectedTypes: string[],
): string[] => {
  if (!passwordProtected) return all;
  const allow = new Set((passwordProtectedTypes.length ? passwordProtectedTypes : PASSWORD_PROTECTED_FALLBACK)
    .map((t) => t.toLowerCase()));
  // Intersect with the device's catalogue so we never offer a type it doesn't have.
  const narrowed = all.filter((t) => allow.has(t.toLowerCase()));
  return narrowed.length ? narrowed : PASSWORD_PROTECTED_FALLBACK;
};
