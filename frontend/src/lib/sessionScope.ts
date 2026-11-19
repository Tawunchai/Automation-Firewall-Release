// Browser storage that belongs to ONE signed-in session.
//
// The console keeps two very different kinds of thing in localStorage, and they have opposite
// lifetimes:
//
//   · PREFERENCES survive signing out. The theme, the accent, which sections of the menu are
//     collapsed, the remembered sign-in address — a second person using the same browser inherits
//     the first one's theme, and that is fine.
//   · SESSION STATE must not. The AI Assistant's conversation is about a firewall, was written by
//     a particular administrator, and can contain the objects they were about to create on it.
//     Leaving it behind for whoever signs in next is a disclosure, not a convenience.
//
// Everything in the second group goes through `sessionScopedKey`, and `clearSessionScoped` wipes
// the lot in one call from AuthContext — on logout, on a 401, and on the maintenance force-logout.
//
// Prefix matching rather than a registry of keys: the pages that own this state are lazy-loaded, so
// a registry would only contain the keys of pages the user happened to visit. Signing out without
// ever opening the AI Assistant would then leave its previous conversation on disk. The prefix is
// on the DATA, so it is cleared whether or not the code that wrote it was ever loaded.

/** Namespace for every key whose lifetime is the signed-in session. */
const PREFIX = "session:";

/** Builds a session-scoped storage key. `sessionScopedKey("ai-chat")` → `"session:ai-chat"`. */
export const sessionScopedKey = (name: string): string => PREFIX + name;

/** True for a key created by `sessionScopedKey`. Exported for the test, and for readability here. */
export const isSessionScopedKey = (key: string): boolean => key.startsWith(PREFIX);

/**
 * Empties one Storage of its session-scoped entries.
 *
 * Keys are collected BEFORE any removal: `store.key(i)` re-indexes as entries are deleted, so
 * removing inside the loop skips every second match — the classic version of this bug leaves half
 * the session behind and looks like it worked.
 */
const sweep = (store: Storage): void => {
  const doomed: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key && isSessionScopedKey(key)) doomed.push(key);
  }
  doomed.forEach((key) => store.removeItem(key));
};

/**
 * Removes every session-scoped entry, leaving preferences untouched.
 *
 * BOTH storages. sessionStorage is per-tab, not per-session — signing out and signing back in
 * happens in the same tab, so a hand-off slot left there (the AI chat's VPN prefill) would be
 * read by the next administrator. Anything written under the prefix dies with the session
 * regardless of which storage it chose.
 *
 * Never throws. It runs on the logout path, and a storage failure (private mode, quota, a
 * disabled origin) must not be the thing that stops someone signing out.
 */
export const clearSessionScoped = (): void => {
  try {
    sweep(window.localStorage);
  } catch {
    /* storage unavailable — there is nothing persisted to clear either */
  }
  try {
    sweep(window.sessionStorage);
  } catch {
    /* as above */
  }
};

/** Reads a session-scoped value, or null if it is missing or storage is unavailable. */
export const readSessionScoped = (name: string): string | null => {
  try {
    return window.localStorage.getItem(sessionScopedKey(name));
  } catch {
    return null;
  }
};

/** Writes a session-scoped value. Returns false when storage refused it (quota, private mode). */
export const writeSessionScoped = (name: string, value: string): boolean => {
  try {
    window.localStorage.setItem(sessionScopedKey(name), value);
    return true;
  } catch {
    return false;
  }
};

/** Removes one session-scoped value. */
export const removeSessionScoped = (name: string): void => {
  try {
    window.localStorage.removeItem(sessionScopedKey(name));
  } catch {
    /* see clearSessionScoped */
  }
};

// ── Tab-scoped: the same prefix, in sessionStorage ───────────────────────────
//
// For session state that must not be written to DISK at all, because of what it can contain
// rather than how long it is wanted.
//
// The AI Assistant's conversation is the case this exists for. Its transcript holds the CLI the
// model proposed, and for a VPN that includes `set psk <the pre-shared key>` — a credential for a
// tunnel, in clear, in a file under the browser profile. The functions above clear it on logout, on
// a 401 and on the maintenance force-logout, which closes the "whoever signs in next" disclosure;
// what they cannot close is the window between a browser or machine crash and the next sign-in,
// where nothing runs to do the clearing and the key simply stays on the disk.
//
// sessionStorage is still per-tab and is still swept by clearSessionScoped (it sweeps both), so the
// only thing that changes is that closing the tab also forgets it. That is a real loss — the AI
// chat deliberately survives navigation and a reload — and it was chosen over the alternatives:
// redacting the key would break Apply-after-restore, because Apply re-parses the CLI out of the
// stored message, and leaving it alone leaves a tunnel credential on disk.

/** Reads a tab-scoped value, or null if it is missing or storage is unavailable. */
export const readTabScoped = (name: string): string | null => {
  try {
    return window.sessionStorage.getItem(sessionScopedKey(name));
  } catch {
    return null;
  }
};

/** Writes a tab-scoped value. Returns false when storage refused it (quota, private mode). */
export const writeTabScoped = (name: string, value: string): boolean => {
  try {
    window.sessionStorage.setItem(sessionScopedKey(name), value);
    return true;
  } catch {
    return false;
  }
};

/** Removes one tab-scoped value. */
export const removeTabScoped = (name: string): void => {
  try {
    window.sessionStorage.removeItem(sessionScopedKey(name));
  } catch {
    /* see clearSessionScoped */
  }
};
