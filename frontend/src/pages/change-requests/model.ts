import type { ChangeRequest, ChangeRequestStatus, ReviewOutcome } from "../../api/changeRequests";

// What a reviewer is actually shown, derived from the stored request rather than from any prose.
//
// ── Why this file exists at all ──────────────────────────────────────────────
//
// A change request is replayed with the APPROVER's rights, so everything an approver decides on
// has to come from the request itself. The server now holds up its half of that: it derives the
// stored title from the method and path (services.PrepareChangeRequest) and refuses a path it
// cannot classify. This file is the screen's half — the same derivation, in the UI's own words and
// in the reader's own language, so the line somebody approves describes the write:
//
//   verb   from the HTTP method, and from the path's sub-route when that changes the MEANING of
//          the write (…/12/move reorders a first-match table; …/bulk/delete removes several).
//   noun   from `resource_type`, which is the Change Ledger's vocabulary for the object class.
//   key    from `resource_key` — the mkey, and nothing else.
//
// The path is read for the verb because `resource_key` deliberately does not carry it: the server
// stores the ChangeTarget's MKey, so `…/12/move` and `…/12` both store "12".
//
// Everything here is pure, because the question "may this person approve this" has four wrong
// answers that all look right in a component (offer the button to the requester, offer it on an
// already-reviewed row, offer it on an expired one, offer it to a non-admin) and the server
// answers every one of them with a 409 or a 403. The UI must not offer a button whose only
// possible outcome is a refusal — and it must not pretend to enforce the rule either: these
// predicates decide what to SHOW, the server decides what happens.

// ── The derived action ───────────────────────────────────────────────────────
//
// The *_LABELS naming is load-bearing: scripts/i18n-extract.mjs harvests the string values of a
// table whose name ends in LABELS, which is how these words reach the th/zh dictionaries. Renaming
// one of these to e.g. METHOD_VERBS would silently strand it in English.

/** The verb an ordinary REST write carries. */
const METHOD_LABELS: Record<string, string> = {
  POST: "Create",
  PUT: "Update",
  PATCH: "Update",
  DELETE: "Delete",
};

/**
 * A trailing path segment that changes what the write MEANS.
 *
 * `PATCH /firewall-policies/12/toggle` is not "update policy 12" — it turns a live rule on or off,
 * and `PUT /firewall-policies/12/move` changes where it sits in a first-match table, which can
 * change what every rule under it does. A reviewer has to see that in the summary line.
 */
const SUBVERB_LABELS: Record<string, string> = {
  clone: "Clone",
  toggle: "Enable or disable",
  move: "Reorder",
};

/** The verb half of `/…/bulk/<verb>`. */
const BULK_LABELS: Record<string, string> = {
  delete: "Delete",
  status: "Enable or disable",
};

/**
 * The object kind.
 *
 * Keyed on services.ChangeTarget.ResourceType — the Change Ledger's own vocabulary, which is what
 * the server stores on the row — so the whole classified set is here, not only the three types
 * that mandatory approval covers: an admin may raise a request for any device write through
 * POST /change-requests.
 *
 * The PLURAL path-segment spellings are aliases rather than leftovers. The server derived this
 * field from the URL segment until the title fix landed, so rows raised before it hold
 * "firewall-policies" where new rows hold "firewall-policy", and a queue page that could only
 * name one of the two would show a reviewer a blank noun on the older half of the list.
 */
const RESOURCE_LABELS: Record<string, string> = {
  "firewall-policy": "firewall policy",
  "firewall-policies": "firewall policy",
  "virtual-ip": "virtual IP",
  "virtual-ips": "virtual IP",
  address: "address object",
  addresses: "address object",
  "address-group": "address group",
  "address-groups": "address group",
  service: "service object",
  services: "service object",
  "service-group": "service group",
  "service-groups": "service group",
  "ip-pool": "IP pool",
  "ip-pools": "IP pool",
  zone: "interface zone",
  zones: "interface zone",
  schedule: "schedule",
  schedules: "schedule",
  "static-route": "static route",
  "static-routes": "static route",
  "ipsec-tunnel": "IPsec tunnel",
  "ipsec-tunnels": "IPsec tunnel",
  "local-user": "local user",
  users: "local user",
  "user-group": "user group",
  "user-groups": "user group",
  "web-rating-override": "web rating override",
  "web-rating-overrides": "web rating override",
  "sdwan-zone": "SD-WAN zone",
  "sdwan-member": "SD-WAN member",
  "sdwan-rule": "SD-WAN rule",
  "sdwan-health-check": "SD-WAN performance SLA",
  "snmp-agent": "SNMP agent",
  "snmp-community": "SNMP community",
  "snmp-user": "SNMP user",
  // Refused at both entrances to the queue now (services.privilegedResources), but a row raised
  // before that is still in the database and still has to read as something.
  "ldap-server": "LDAP server",
  "ldap-servers": "LDAP server",
  "radius-server": "RADIUS server",
  "radius-servers": "RADIUS server",
  "exchange-connector": "Exchange connector",
  "exchange-connectors": "Exchange connector",
  // The old fallback for a path the server could not parse. It cannot be produced any more —
  // ResolveRequestTarget refuses what it cannot classify — but old rows keep it.
  "device-write": "write to this firewall",
  "security-profile": "security profile",
  "security-profiles": "security profile",
};

/**
 * The security-profile categories, which are a `security-profile:<category>` resource type rather
 * than a type of their own.
 *
 * Naming the category matters: "create a security profile" does not tell a reviewer whether they
 * are about to let an AntiVirus engine loose on a link or point SSL inspection at it.
 */
const PROFILE_LABELS: Record<string, string> = {
  antivirus: "AntiVirus profile",
  webfilter: "Web Filter profile",
  dnsfilter: "DNS Filter profile",
  "application-control": "Application Control sensor",
  "file-filter": "File Filter profile",
  "ssl-ssh-inspection": "SSL/SSH Inspection profile",
  ips: "IPS sensor",
};

export type DerivedAction = {
  /** "Create", "Delete", "Reorder" — never anybody's prose. */
  verb: string;
  /** "firewall policy", "AntiVirus profile". Empty when the type is one we cannot name. */
  noun: string;
  /** The object's own key on the device. Empty for a create and for a bulk write. */
  key: string;
  /** The write touches several objects at once, so there is no single key. */
  bulk: boolean;
  /** False when `resource_type` is not one this page knows — show the raw type instead. */
  recognised: boolean;
};

type ActionSource = Pick<ChangeRequest, "method" | "path" | "resource_type" | "resource_key">;

/** The path's segments after `/policy/device/<id>/`, which is where the sub-route verb lives. */
const routeTail = (path: string): string[] =>
  (path ?? "")
    .replace(/^\/policy\/device\/\d+\/?/, "")
    .split("/")
    .filter((s) => s !== "");

/**
 * Summarises what the stored request will do to the firewall.
 *
 * Reads only the server-derived fields — method, path, resource type and key. It never looks at
 * `title` or `reason`, by design: those are prose, and prose is the thing this replaces.
 */
export const describeAction = (r: ActionSource): DerivedAction => {
  const method = (r.method ?? "").toUpperCase();
  const type = r.resource_type ?? "";
  const tail = routeTail(r.path ?? "");

  let verb = METHOD_LABELS[method] ?? "Change";
  let noun = "";
  let key = r.resource_key ?? "";

  if (type.startsWith("security-profile:")) {
    const category = type.slice("security-profile:".length);
    noun = PROFILE_LABELS[category] ?? RESOURCE_LABELS["security-profile"];
  } else if (type === "security-profiles") {
    // The pre-fix spelling: the key held "<category>/<name>", and the category is not an mkey.
    const segs = key.split("/").filter((s) => s !== "");
    noun = PROFILE_LABELS[segs[0] ?? ""] ?? RESOURCE_LABELS["security-profiles"];
    key = segs.slice(1).join("/");
  } else {
    noun = RESOURCE_LABELS[type] ?? "";
  }

  // The sub-route, which `resource_key` no longer carries: the server stores the ChangeTarget's
  // MKey, so "…/12/move" and "…/12" both arrive as "12".
  const bulkAt = tail.indexOf("bulk");
  const bulk = bulkAt > 0;
  if (bulk) {
    verb = BULK_LABELS[tail[bulkAt + 1] ?? ""] ?? verb;
    // "bulk" is not an object name. Older rows stored it as the key; never show it as one.
    key = "";
  } else {
    const last = tail[tail.length - 1] ?? "";
    if (SUBVERB_LABELS[last]) {
      verb = SUBVERB_LABELS[last];
      if (key === last) key = tail[tail.length - 2] ?? "";
    }
  }

  return { verb, noun, key, bulk, recognised: noun !== "" };
};

// ── Status ───────────────────────────────────────────────────────────────────

/**
 * What each status means, spelled out rather than echoed.
 *
 * "failed" is the one that has to be a sentence: a reviewer who sees the bare word next to their
 * own name reads it as "the approval failed", and the truth is the opposite — the approval went
 * through and the firewall refused the write.
 */
export const STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  pending: "Waiting for review",
  approved: "Approved, not yet applied",
  applied: "Applied to the firewall",
  rejected: "Rejected",
  withdrawn: "Withdrawn by the requester",
  failed: "Approved, firewall refused it",
  expired: "Expired unreviewed",
};

export type StatusTone = {
  /** The `.chip-*` suffix from index.css's status vocabulary. */
  chip: string;
  /** Whether the change is on the firewall. True for exactly one status. */
  onDevice: boolean;
  /** Whether it can still turn into a write — mirrors entity.ChangeRequest.IsOpen. */
  open: boolean;
};

export const STATUS_TONES: Record<ChangeRequestStatus, StatusTone> = {
  pending: { chip: "chip-warn", onDevice: false, open: true },
  approved: { chip: "chip-info", onDevice: false, open: true },
  applied: { chip: "chip-ok", onDevice: true, open: false },
  rejected: { chip: "chip-danger", onDevice: false, open: false },
  withdrawn: { chip: "", onDevice: false, open: false },
  failed: { chip: "chip-danger", onDevice: false, open: false },
  expired: { chip: "", onDevice: false, open: false },
};

export const statusTone = (status: ChangeRequestStatus): StatusTone =>
  STATUS_TONES[status] ?? { chip: "", onDevice: false, open: false };

/** The filter bar's buckets, in the order a reviewer cares about them. */
export const STATUS_FILTERS: ChangeRequestStatus[] = [
  "pending",
  "approved",
  "applied",
  "failed",
  "rejected",
  "withdrawn",
  "expired",
];

// ── The outcome of a review ──────────────────────────────────────────────────

/**
 * How each review outcome is announced.
 *
 * `device-refused` (HTTP 207) and `apply-failed` (502) are the two that must not read as success.
 * The server answers 207 rather than a 4xx so the reviewer does not press Approve again — which
 * makes it exactly the status a page is most likely to render with a green tick.
 */
export const OUTCOME_LABELS: Record<ReviewOutcome, string> = {
  rejected: "Rejected",
  applied: "Applied to the firewall",
  scheduled: "Approved, waiting for its window",
  approved: "Approved, not applied yet",
  "device-refused": "Approved, but the firewall refused the write",
  "apply-failed": "Approved, but it could not be applied",
};

export type OutcomeTone = {
  /** Which toast to raise. `error` for anything that did not reach the firewall as intended. */
  toast: "success" | "info" | "error";
  /** True only when the firewall now carries the change. */
  onDevice: boolean;
};

const OUTCOME_TONES: Record<ReviewOutcome, OutcomeTone> = {
  // A rejection is a decision that succeeded; nothing was meant to reach the device.
  rejected: { toast: "success", onDevice: false },
  applied: { toast: "success", onDevice: true },
  scheduled: { toast: "info", onDevice: false },
  approved: { toast: "info", onDevice: false },
  "device-refused": { toast: "error", onDevice: false },
  "apply-failed": { toast: "error", onDevice: false },
};

export const outcomeTone = (outcome: ReviewOutcome): OutcomeTone =>
  OUTCOME_TONES[outcome] ?? { toast: "error", onDevice: false };

// ── Who may do what ─────────────────────────────────────────────────────────

export type Viewer = { id: number; isAdmin: boolean };

/** A pending request past its expiry — the server will refuse to review it (409). */
export const isExpired = (r: Pick<ChangeRequest, "status" | "expires_at">, now: Date): boolean => {
  if (r.status !== "pending") return false;
  const at = new Date(r.expires_at).getTime();
  return Number.isFinite(at) && at <= now.getTime();
};

export type ReviewBlock = "ok" | "not-admin" | "not-pending" | "own-request" | "expired";

/**
 * Whether this viewer may review this request, and if not, why not.
 *
 * Checked in the order the server checks it, so the reason shown is the reason the server would
 * give. `own-request` is the one that matters: separation of duties is the point of the queue, and
 * services.CanReview refuses it outright — an admin who raised a change still waits for somebody
 * else, unless they are the only admin in the system (in which case the server self-approved it at
 * the moment it was raised and it never reached the queue as pending).
 */
export const reviewability = (
  r: Pick<ChangeRequest, "status" | "requested_by_id" | "expires_at">,
  viewer: Viewer,
  now: Date,
): ReviewBlock => {
  if (!viewer.isAdmin) return "not-admin";
  if (r.status !== "pending") return "not-pending";
  if (r.requested_by_id === viewer.id) return "own-request";
  if (isExpired(r, now)) return "expired";
  return "ok";
};

export const REVIEW_BLOCK_LABELS: Record<ReviewBlock, string> = {
  ok: "",
  "not-admin": "Only an administrator can approve or reject a change request.",
  "not-pending": "This request has already been decided.",
  "own-request":
    "You raised this request, so you cannot approve it. Separation of duties is the point of the queue — another administrator has to review it.",
  expired:
    "This request has expired. It was written against the firewall as it was then, and nobody can see what has changed since.",
};

export type WithdrawBlock = "ok" | "not-yours" | "not-pending";

/** Whether this viewer may take the request back. Requester-only, pending-only. */
export const withdrawability = (
  r: Pick<ChangeRequest, "status" | "requested_by_id">,
  viewer: Viewer,
): WithdrawBlock => {
  if (r.requested_by_id !== viewer.id) return "not-yours";
  if (r.status !== "pending") return "not-pending";
  return "ok";
};

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * The stored request body, pretty-printed when it is JSON.
 *
 * Returned as text rather than rendered as a tree: this is the exact payload that will be replayed
 * at the firewall, and a reviewer reading it needs to see what is there, not a view of it. It is
 * shown inside a <code>/<pre>, which the i18n runtime never translates.
 */
export const formatBody = (body: string | undefined): string => {
  const raw = (body ?? "").trim();
  if (raw === "") return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // Not JSON (or not valid JSON any more). Show it as stored — the apply will send these bytes.
    return raw;
  }
};

/** How many requests sit in each status, for the filter bar's counts. */
export const countByStatus = (rows: ChangeRequest[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
};
