import { describe, expect, it } from "vitest";
import type { ChangeRequest, ChangeRequestStatus, ReviewOutcome } from "../../api/changeRequests";
import {
  OUTCOME_LABELS,
  STATUS_LABELS,
  countByStatus,
  describeAction,
  formatBody,
  isExpired,
  outcomeTone,
  reviewability,
  statusTone,
  withdrawability,
} from "./model";

// What the reviewer is told, and who is offered which button.
//
// Two of these groups are the feature:
//
//   · describeAction — the row's summary comes from the SERVER's fields (method/path/resource_*),
//     never from prose. A reviewer who can only see a sentence is approving a sentence, which is
//     the confused-deputy hole the queue exists to close. It reads `resource_type` in the Change
//     Ledger's vocabulary ("firewall-policy", "security-profile:antivirus") and takes the verb
//     from the PATH, because the stored `resource_key` is the mkey alone and no longer carries
//     the sub-route that changes what a write means.
//   · outcomeTone / statusTone — `onDevice` is true for exactly one outcome and exactly one
//     status. 207 ("approved, and the firewall refused the write") is a 2xx, so it is the one a
//     page renders as a green tick by accident.

const req = (over: Partial<ChangeRequest> = {}): ChangeRequest => ({
  id: 1,
  created_at: "2026-11-16T09:00:00Z",
  network_device_id: 1,
  title: "Open the printer port",
  reason: "the finance printer stopped working",
  method: "POST",
  path: "/policy/device/1/firewall-policies",
  body: "{}",
  resource_type: "firewall-policy",
  resource_key: "",
  requested_by_id: 4,
  requested_by: "user@got.co.th",
  requested_at: "2026-11-16T09:00:00Z",
  status: "pending",
  expires_at: "2026-11-23T09:00:00Z",
  self_approved: false,
  ...over,
});

describe("describeAction", () => {
  it("names a create off the method and the route, whatever the title says", () => {
    const got = describeAction(req({ title: "tiny harmless tweak", method: "POST" }));

    expect(got.verb).toBe("Create");
    expect(got.noun).toBe("firewall policy");
    expect(got.key).toBe("");
    expect(got.recognised).toBe(true);
  });

  it("carries the object's own key for an update", () => {
    const got = describeAction(req({
      method: "PATCH",
      path: "/policy/device/1/firewall-policies/12",
      resource_key: "12",
    }));

    expect(got.verb).toBe("Update");
    expect(got.key).toBe("12");
  });

  it("names a delete a delete", () => {
    const got = describeAction(req({
      method: "DELETE",
      path: "/policy/device/1/virtual-ips/WebVIP",
      resource_type: "virtual-ip",
      resource_key: "WebVIP",
    }));

    expect(got.verb).toBe("Delete");
    expect(got.noun).toBe("virtual IP");
    expect(got.key).toBe("WebVIP");
  });

  it("does not summarise a reorder as an ordinary update", () => {
    // PUT /firewall-policies/12/move changes where a rule sits in a first-match table, which can
    // change what every rule below it does. The stored resource key is just "12", so the verb has
    // to come from the path or this reads as "Update firewall policy 12".
    const got = describeAction(req({
      method: "PUT",
      path: "/policy/device/1/firewall-policies/12/move",
      resource_key: "12",
    }));

    expect(got.verb).toBe("Reorder");
    expect(got.key).toBe("12");
  });

  it("calls a toggle what it is", () => {
    const got = describeAction(req({
      method: "PATCH",
      path: "/policy/device/1/firewall-policies/12/toggle",
      resource_key: "12",
    }));

    expect(got.verb).toBe("Enable or disable");
    expect(got.key).toBe("12");
  });

  it("calls a clone a clone", () => {
    const got = describeAction(req({
      method: "POST",
      path: "/policy/device/1/firewall-policies/12/clone",
      resource_key: "12",
    }));

    expect(got.verb).toBe("Clone");
  });

  it("flags a bulk write, and never shows 'bulk' as an object name", () => {
    // The server stores the ChangeTarget's MKey, which for /bulk/delete is the literal "bulk".
    const got = describeAction(req({
      method: "POST",
      path: "/policy/device/1/firewall-policies/bulk/delete",
      resource_key: "bulk",
    }));

    expect(got.bulk).toBe(true);
    expect(got.verb).toBe("Delete");
    expect(got.key).toBe("");
  });

  it("reads a bulk status change as enable-or-disable", () => {
    const got = describeAction(req({
      method: "PATCH",
      path: "/policy/device/1/firewall-policies/bulk/status",
      resource_key: "bulk",
    }));

    expect(got.bulk).toBe(true);
    expect(got.verb).toBe("Enable or disable");
  });

  it("names the security profile's CATEGORY, not just 'security profile'", () => {
    // "Create a security profile" does not tell a reviewer whether an AntiVirus engine or SSL
    // inspection is about to be pointed at a link.
    const created = describeAction(req({
      method: "POST",
      path: "/policy/device/1/security-profiles/antivirus",
      resource_type: "security-profile:antivirus",
      resource_key: "",
    }));

    expect(created.noun).toBe("AntiVirus profile");
    expect(created.key).toBe("");

    const edited = describeAction(req({
      method: "PATCH",
      path: "/policy/device/1/security-profiles/webfilter/corp-web",
      resource_type: "security-profile:webfilter",
      resource_key: "corp-web",
    }));
    expect(edited.noun).toBe("Web Filter profile");
    expect(edited.key).toBe("corp-web");
  });

  it("falls back to a plain 'security profile' for a category it has no word for", () => {
    const got = describeAction(req({ resource_type: "security-profile:something-new" }));

    expect(got.noun).toBe("security profile");
    expect(got.recognised).toBe(true);
  });

  // Rows raised before the server derived the title held the URL segment as the resource type and
  // "<category>/<name>" as the key. Those rows are still in the database.
  it("still reads the pre-fix plural spellings", () => {
    expect(describeAction(req({ resource_type: "firewall-policies" })).noun).toBe("firewall policy");

    const old = describeAction(req({
      method: "PATCH",
      path: "/policy/device/1/security-profiles/webfilter/corp-web",
      resource_type: "security-profiles",
      resource_key: "webfilter/corp-web",
    }));
    expect(old.noun).toBe("Web Filter profile");
    expect(old.key).toBe("corp-web");
  });

  it("names every resource type an admin can raise by hand, not only the three gated ones", () => {
    // POST /change-requests accepts any classified device write, so a queue that could only name
    // policies, VIPs and profiles would show a blank noun on a static-route request.
    for (const [type, noun] of [
      ["address", "address object"],
      ["static-route", "static route"],
      ["user-group", "user group"],
      ["sdwan-rule", "SD-WAN rule"],
      ["snmp-community", "SNMP community"],
    ] as const) {
      expect(describeAction(req({ resource_type: type })).noun).toBe(noun);
    }
  });

  it("admits it when the resource type is one it cannot name", () => {
    // Better the raw type than a confident wrong noun — `recognised` is what tells the page to
    // show the stored string instead.
    const got = describeAction(req({ resource_type: "something-nobody-added-a-word-for" }));

    expect(got.recognised).toBe(false);
    expect(got.noun).toBe("");
  });

  it("falls back to a neutral verb for a method it does not know", () => {
    expect(describeAction(req({ method: "" })).verb).toBe("Change");
  });

  it("names the server's old unparsed-path fallback", () => {
    expect(describeAction(req({ resource_type: "device-write", resource_key: "" })).recognised).toBe(true);
  });
});

describe("statusTone", () => {
  const all: ChangeRequestStatus[] = [
    "pending", "approved", "applied", "rejected", "withdrawn", "failed", "expired",
  ];

  it("says the change is on the firewall for exactly one status", () => {
    expect(all.filter((s) => statusTone(s).onDevice)).toEqual(["applied"]);
  });

  it("does not treat 'failed' as 'the approval failed'", () => {
    // The approval went through; the device refused. A reviewer reading the bare word next to
    // their own name reads the opposite.
    expect(STATUS_LABELS.failed).toMatch(/firewall refused/i);
    expect(STATUS_LABELS.failed).toMatch(/approved/i);
  });

  it("keeps only pending and approved open", () => {
    expect(all.filter((s) => statusTone(s).open)).toEqual(["pending", "approved"]);
  });

  it("gives every status a label and a tone", () => {
    for (const s of all) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(statusTone(s)).toBeTruthy();
    }
  });
});

describe("outcomeTone", () => {
  const all: ReviewOutcome[] = [
    "rejected", "applied", "scheduled", "approved", "device-refused", "apply-failed",
  ];

  it("reports the change as on the firewall for exactly one outcome", () => {
    expect(all.filter((o) => outcomeTone(o).onDevice)).toEqual(["applied"]);
  });

  it("raises an error toast for 207 and for 502, never a success one", () => {
    expect(outcomeTone("device-refused").toast).toBe("error");
    expect(outcomeTone("apply-failed").toast).toBe("error");
  });

  it("does not call a pending apply a success", () => {
    expect(outcomeTone("scheduled").toast).toBe("info");
    expect(outcomeTone("approved").toast).toBe("info");
  });

  it("treats a rejection as a decision that worked", () => {
    expect(outcomeTone("rejected").toast).toBe("success");
    expect(outcomeTone("rejected").onDevice).toBe(false);
  });

  it("says in words that a refused write was still approved", () => {
    expect(OUTCOME_LABELS["device-refused"]).toMatch(/refused/i);
    expect(OUTCOME_LABELS["apply-failed"]).toMatch(/could not be applied/i);
  });
});

describe("reviewability", () => {
  const now = new Date("2026-11-17T09:00:00Z");
  const admin = { id: 9, isAdmin: true };

  it("lets another admin review a pending request", () => {
    expect(reviewability(req(), admin, now)).toBe("ok");
  });

  it("refuses the requester, even when they are an admin", () => {
    expect(reviewability(req({ requested_by_id: 9 }), admin, now)).toBe("own-request");
  });

  it("refuses a non-admin", () => {
    expect(reviewability(req(), { id: 4, isAdmin: false }, now)).toBe("not-admin");
  });

  it("refuses a request that has already been decided", () => {
    for (const status of ["approved", "applied", "rejected", "withdrawn", "failed", "expired"] as ChangeRequestStatus[]) {
      expect(reviewability(req({ status }), admin, now)).toBe("not-pending");
    }
  });

  it("refuses an expired request, which the server also refuses", () => {
    expect(reviewability(req({ expires_at: "2026-11-16T09:00:00Z" }), admin, now)).toBe("expired");
  });
});

describe("isExpired", () => {
  const now = new Date("2026-11-17T09:00:00Z");

  it("is only about a request still waiting", () => {
    // An applied request whose expiry has passed is not "expired" — it is on the device.
    expect(isExpired({ status: "applied", expires_at: "2026-11-01T00:00:00Z" }, now)).toBe(false);
  });

  it("is false for a future expiry", () => {
    expect(isExpired({ status: "pending", expires_at: "2026-11-23T09:00:00Z" }, now)).toBe(false);
  });

  it("does not call an unparseable date expired", () => {
    expect(isExpired({ status: "pending", expires_at: "" }, now)).toBe(false);
  });
});

describe("withdrawability", () => {
  it("lets the requester take back a pending request", () => {
    expect(withdrawability(req({ requested_by_id: 4 }), { id: 4, isAdmin: false })).toBe("ok");
  });

  it("does not offer an admin a withdraw on somebody else's request", () => {
    // The server answers 403. A button that can only 403 is worse than no button.
    expect(withdrawability(req({ requested_by_id: 4 }), { id: 9, isAdmin: true })).toBe("not-yours");
  });

  it("does not offer a withdraw once it has been reviewed", () => {
    expect(withdrawability(req({ requested_by_id: 4, status: "applied" }), { id: 4, isAdmin: false }))
      .toBe("not-pending");
  });
});

describe("formatBody", () => {
  it("pretty-prints JSON so a reviewer can read the payload", () => {
    expect(formatBody('{"name":"LAN"}')).toBe('{\n  "name": "LAN"\n}');
  });

  it("shows text that is not JSON exactly as stored, because that is what will be sent", () => {
    expect(formatBody("not json at all")).toBe("not json at all");
  });

  it("is empty for an empty body", () => {
    expect(formatBody("")).toBe("");
    expect(formatBody(undefined)).toBe("");
  });
});

describe("countByStatus", () => {
  it("counts each bucket", () => {
    const rows = [req({ status: "pending" }), req({ status: "pending" }), req({ status: "applied" })];

    expect(countByStatus(rows)).toEqual({ pending: 2, applied: 1 });
  });

  it("is empty for an empty queue", () => {
    expect(countByStatus([])).toEqual({});
  });
});
