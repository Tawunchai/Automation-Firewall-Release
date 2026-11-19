import type { AccProfile, AdminPayload, AdminUser } from "../../api/systemSettings";

// The rules behind the firewall's own administrator accounts.
//
// Two of them can take the device away from the person using this page, so both are computed here
// and mirrored on the server: the form warns, the API refuses.

export type AdminDraft = {
  name: string;
  password: string;
  /** True while the operator has not touched the password field on an edit. */
  keepPassword: boolean;
  accprofile: string;
  comments: string;
  /** One per line in the form — the device stores ten numbered slots. */
  trustHosts: string;
  twoFactor: string;
  remoteAuth: boolean;
  remoteGroup: string;
};

export const BLANK_ADMIN: AdminDraft = {
  name: "",
  password: "",
  keepPassword: false,
  accprofile: "",
  comments: "",
  trustHosts: "",
  twoFactor: "disable",
  remoteAuth: false,
  remoteGroup: "",
};

export const splitHosts = (s: string): string[] =>
  s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

// FortiOS CMDB lists come back as JSON `null`, not `[]`, when there is nothing in them (a nil Go
// slice marshals that way). Every read of trust_hosts / write_groups goes through this so a
// no-write profile or a wide-open account can't throw on `.join`/`.length` and blank the page.
const orEmpty = <T>(v: T[] | null | undefined): T[] => v ?? [];

export const draftFrom = (a: AdminUser): AdminDraft => ({
  name: a.name,
  password: "",
  // An edit starts out NOT changing the password: the device never returns one, so an empty box
  // means "leave it", not "clear it".
  keepPassword: true,
  accprofile: a.accprofile,
  comments: a.comments,
  trustHosts: orEmpty(a.trust_hosts).join("\n"),
  twoFactor: a.two_factor || "disable",
  remoteAuth: a.remote_auth,
  remoteGroup: a.remote_group,
});

export const buildPayload = (d: AdminDraft, confirmLockout = false): AdminPayload => ({
  name: d.name.trim(),
  // Omitted entirely when the password is being left alone. This is the field whose empty string
  // would wipe the account's password.
  ...(d.keepPassword ? {} : { password: d.password }),
  accprofile: d.accprofile,
  comments: d.comments.trim(),
  trust_hosts: splitHosts(d.trustHosts),
  two_factor: d.twoFactor,
  remote_auth: d.remoteAuth,
  remote_group: d.remoteGroup.trim(),
  ...(confirmLockout ? { confirm_lockout: true } : {}),
});

/** FortiOS wants a subnet here: "10.0.0.0/24" or "10.0.0.0 255.255.255.0". */
export const looksLikeTrustHost = (s: string): boolean => {
  const quad = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const okQuad = (v: string) => {
    const m = quad.exec(v.trim());
    return !!m && m.slice(1).every((n) => Number(n) <= 255);
  };
  if (s.includes("/")) {
    const [ip, mask] = s.split("/");
    if (!okQuad(ip)) return false;
    if (/^\d{1,2}$/.test(mask.trim())) return Number(mask) <= 32;
    return okQuad(mask);
  }
  const parts = s.trim().split(/\s+/);
  return parts.length === 2 && okQuad(parts[0]) && okQuad(parts[1]);
};

export const validateDraft = (d: AdminDraft, creating: boolean): string | null => {
  if (!d.name.trim()) return "Give the account a name.";
  if (!d.accprofile) return "Choose an access profile — it is what the account is allowed to do.";
  if (creating && !d.remoteAuth && !d.password) return "A new local account needs a password.";
  if (!d.keepPassword && !d.password && !d.remoteAuth) {
    return "Enter the new password, or leave the password unchanged.";
  }
  if (d.remoteAuth && !d.remoteGroup.trim()) {
    return "A remotely authenticated account needs the remote group it belongs to.";
  }
  for (const h of splitHosts(d.trustHosts)) {
    if (!looksLikeTrustHost(h)) {
      return `"${h}" is not a subnet. Use 10.0.0.0/24 or 10.0.0.0 255.255.255.0.`;
    }
  }
  return null;
};

/**
 * Whether this edit would shut the operator out of the account.
 *
 * Mirrors services.AdminChangeLocksOut. Going from "any host" to a list, or narrowing an existing
 * list, stops every address outside it from logging in — and the person making the change is
 * usually at one of those. Widening can never lock anybody out and says nothing.
 *
 * Verified live: with a trusted host set to a subnet the caller was not in, the same login that
 * had worked a moment earlier was refused.
 */
export const locksOutAdmin = (current: AdminUser | null, d: AdminDraft): boolean => {
  if (!current) return false; // a new account grants access; it cannot take any away
  const currentHosts = orEmpty(current.trust_hosts);
  const next = splitHosts(d.trustHosts);
  if (currentHosts.length === 0 && next.length > 0) return true;
  if (currentHosts.length > 0 && next.length > 0) {
    const set = new Set(next.map((h) => h.trim()));
    return currentHosts.some((h) => !set.has(h.trim()));
  }
  return false;
};

/** Whether `name` is the only account on super_admin. Mirrors services.LastSuperAdmin. */
export const isLastSuperAdmin = (admins: AdminUser[], name: string): boolean => {
  const supers = admins.filter((a) => a.is_super_admin);
  return supers.length === 1 && supers[0].name === name;
};

/** Where the account may log in from, said so an empty list cannot be misread. */
export const describeReach = (a: AdminUser): string =>
  a.restricted_to_hosts ? `Only from ${orEmpty(a.trust_hosts).join(", ")}` : "From any address";

/** The second factor, as a state rather than a method name. */
export const describeTwoFactor = (a: AdminUser): string => {
  if (!a.two_factor || a.two_factor === "disable") return "No second factor";
  return `Second factor: ${a.two_factor}`;
};

/** What a profile lets an account change, in one line. */
export const describeProfile = (p: AccProfile | undefined): string => {
  if (!p) return "Unknown profile";
  if (p.is_super_admin) return "Full control of the device";
  const writeGroups = orEmpty(p.write_groups);
  if (writeGroups.length === 0) return "Read-only";
  return `Can change: ${writeGroups.join(", ")}`;
};

/**
 * The accounts worth flagging.
 *
 * Reachable from anywhere AND with no second factor is the combination that turns one leaked
 * password into a firewall somebody else owns. It is also the default for every account FortiOS
 * creates, which is why it needs saying rather than assuming.
 */
export const exposedAdmins = (admins: AdminUser[]): AdminUser[] =>
  admins.filter((a) => !a.restricted_to_hosts && (!a.two_factor || a.two_factor === "disable"));

export const TWO_FACTOR_OPTIONS = [
  { value: "disable", label: "None" },
  { value: "fortitoken", label: "FortiToken" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
];
