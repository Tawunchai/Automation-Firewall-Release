import { describe, it, expect } from "vitest";
import {
  diffFields, renderValue, stepToEntry, sshFallbackReason, isSecretField,
  EMPTY_MARK, SECRET_MARK,
} from "./dryRun";
import type { PlanStep } from "./applyViaREST";

// Dry-run's whole value is that the preview matches what Apply really does. These tests pin the
// comparison rules, because a diff that cries wolf on every run is one users stop reading — and a
// diff that stays quiet about a dropped group member is worse than no diff at all.

const field = (changes: ReturnType<typeof diffFields>, name: string) =>
  changes.find((c) => c.field === name);

describe("renderValue", () => {
  it.each([
    [undefined, EMPTY_MARK],
    [null, EMPTY_MARK],
    ["", EMPTY_MARK],
    [[], EMPTY_MARK],
    [true, "enable"],
    [false, "disable"],
    [["a", "b"], "a, b"],
    [443, "443"],
    ["all", "all"],
  ])("renders %p as %p", (input, expected) => {
    expect(renderValue(input)).toBe(expected);
  });
});

describe("isSecretField", () => {
  it.each(["passwd", "password", "secret", "psksecret", "shared_key", "auth_pwd"])(
    "treats %s as write-only", (f) => expect(isSecretField(f)).toBe(true));

  it.each(["name", "subnet", "keyword", "comment"])(
    "does not treat %s as write-only", (f) => expect(isSecretField(f)).toBe(false));
});

describe("diffFields — creating an object", () => {
  const payload = {
    name: "LAN-Net", type: "ipmask", subnet: "10.0.1.0/24",
    comment: "", color: 0, allow_routing: false, mac_addrs: [],
  };

  it("lists the fields the create actually sets", () => {
    const changes = diffFields(payload, null);
    expect(field(changes, "name")?.after).toBe("LAN-Net");
    expect(field(changes, "subnet")?.after).toBe("10.0.1.0/24");
    expect(field(changes, "subnet")?.before).toBe(EMPTY_MARK);
  });

  it("hides empty strings, empty lists and zeroes so the table stays readable", () => {
    const changes = diffFields(payload, null);
    expect(field(changes, "comment")).toBeUndefined();
    expect(field(changes, "color")).toBeUndefined();
    expect(field(changes, "mac_addrs")).toBeUndefined();
  });

  // A booleans-are-noise rule would hide exactly the fields a reviewer is looking for:
  // "nat: disable" on a new outbound policy is the bug you want to catch BEFORE it is on the device.
  it("always shows booleans, including the false ones", () => {
    expect(field(diffFields(payload, null), "allow_routing")?.after).toBe("disable");
    expect(field(diffFields({ nat: false, name: "P1" }, null), "nat")?.after).toBe("disable");
  });

  it("masks a password being set rather than printing it", () => {
    const changes = diffFields({ name: "alice", passwd: "S3cret!" }, null);
    const pw = field(changes, "passwd");
    expect(pw?.after).toBe(SECRET_MARK);
    expect(pw?.secret).toBe(true);
    expect(JSON.stringify(changes)).not.toContain("S3cret!");
  });

  it("returns nothing for a step that carries no payload", () => {
    expect(diffFields(undefined, null)).toEqual([]);
  });
});

describe("diffFields — comparing against the device", () => {
  it("reports only the fields that actually differ", () => {
    const changes = diffFields(
      { name: "Web", protocol: "TCP/UDP/SCTP", tcp_ports: "80 443", comment: "web" },
      { name: "Web", protocol: "TCP/UDP/SCTP", tcp_ports: "80", comment: "web" },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: "tcp_ports", before: "80", after: "80 443" });
  });

  // FortiOS stores a member line as a set. If ordering counted, every single Apply of an unchanged
  // group would light up as a change and the warning would mean nothing.
  it("treats a list as a set, so reordering is not a change", () => {
    expect(diffFields({ members: ["bob", "alice"] }, { members: ["alice", "bob"] })).toEqual([]);
  });

  // ⚠️ THE CASE THIS FEATURE EXISTS FOR. `set member alice` on a group that holds alice AND bob
  // does not add alice — it replaces the list, and bob is gone. Nothing in the chat says so today.
  it("names the entries a list write takes AWAY", () => {
    const [change] = diffFields({ members: ["alice"] }, { members: ["alice", "bob"] });
    expect(change.removed).toEqual(["bob"]);
    expect(change.added).toEqual([]);
    expect(change.before).toBe("alice, bob");
    expect(change.after).toBe("alice");
  });

  it("names the entries a list write adds", () => {
    const [change] = diffFields({ members: ["alice", "carol"] }, { members: ["alice"] });
    expect(change.added).toEqual(["carol"]);
    expect(change.removed).toEqual([]);
  });

  it("compares a missing field and an empty one as the same absence", () => {
    expect(diffFields({ comment: "" }, {})).toEqual([]);
    expect(diffFields({ tags: [] }, { tags: undefined })).toEqual([]);
  });

  // The list endpoint and the create payload disagree about number-vs-string often enough that a
  // strict compare would invent changes on ordinary objects.
  it("compares numbers loosely against their string form", () => {
    expect(diffFields({ port: 443 }, { port: "443" })).toEqual([]);
    expect(diffFields({ nat: true }, { nat: 1 })).toEqual([]);
  });

  it("never compares a write-only field — the device does not return one", () => {
    // The device answers with "" for a stored password. Comparing would flag a change every run.
    const changes = diffFields({ name: "alice", passwd: "kept-from-form" }, { name: "alice", passwd: "" });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: "passwd", secret: true, before: SECRET_MARK, after: SECRET_MARK });
  });

  // ⚠️ REGRESSION. The create payload carries FortiOS's "10.0.1.0 255.255.255.0"; the device's list
  // endpoint answers "10.0.1.0/24". Same network. Before this was normalised, EVERY untouched
  // address came back as "differs from the device" — a warning on every run, which is how a diff
  // becomes noise nobody reads.
  it("treats a network written as mask and as CIDR as the same network", () => {
    expect(diffFields({ subnet: "192.168.1.0 255.255.255.0" }, { subnet: "192.168.1.0/24" })).toEqual([]);
    expect(diffFields({ subnet: "10.0.0.0 255.0.0.0" }, { subnet: "10.0.0.0/8" })).toEqual([]);
    expect(diffFields({ subnet: "0.0.0.0 0.0.0.0" }, { subnet: "0.0.0.0/0" })).toEqual([]);
    expect(diffFields({ subnet: "10.0.1.5 255.255.255.255" }, { subnet: "10.0.1.5/32" })).toEqual([]);
    // A genuinely different network still shows up.
    expect(diffFields({ subnet: "192.168.9.0 255.255.255.0" }, { subnet: "192.168.1.0/24" })).toHaveLength(1);
  });

  it("renders a mask-form network as CIDR, the way the GUI shows it", () => {
    expect(renderValue("192.168.1.0 255.255.255.0")).toBe("192.168.1.0/24");
    // Anything that is not a network/mask pair is left exactly as it is.
    expect(renderValue("10.0.0.1-10.0.0.9")).toBe("10.0.0.1-10.0.0.9");
    expect(renderValue("*.google.com")).toBe("*.google.com");
    expect(renderValue("80 443 8080-8090")).toBe("80 443 8080-8090");
    // A non-contiguous mask cannot be a prefix length — do not invent one.
    expect(renderValue("10.0.0.0 255.0.255.0")).toBe("10.0.0.0 255.0.255.0");
  });

  // ⚠️ REGRESSION. The device omits fields it has nothing to say about. A payload that sets one to
  // its default is not a change — reporting "color: — → 0" on every address is the same noise
  // problem from the other direction.
  it("says nothing when the payload only sets a default the device never reported", () => {
    expect(diffFields({ color: 0 }, { name: "A" })).toEqual([]);
    expect(diffFields({ nat: false }, { name: "A" })).toEqual([]);
    expect(diffFields({ comment: "" }, { name: "A" })).toEqual([]);
    // But a NON-default value the device does not carry is a real addition.
    expect(diffFields({ color: 6 }, { name: "A" })).toHaveLength(1);
    // And a field the device DOES report keeps being compared normally.
    expect(diffFields({ color: 0 }, { color: 6 })).toHaveLength(1);
  });

  it("ignores the device's own bookkeeping fields", () => {
    expect(diffFields(
      { id: 9, q_ref: 3, ref_count: 1, builtin: true, created_at: "x", name: "A" },
      { id: 1, q_ref: 0, ref_count: 0, builtin: false, created_at: "y", name: "A" },
    )).toEqual([]);
  });

  // Iterating the payload's keys (not the union) is deliberate: Apply does not clear the fields it
  // never sends, so calling them "removed" would be a lie.
  it("says nothing about fields the payload does not send", () => {
    expect(diffFields({ name: "A" }, { name: "A", comment: "set by someone else" })).toEqual([]);
  });
});

describe("stepToEntry", () => {
  const base = { kind: "address" as const, label: "Address", name: "LAN-Net" };

  it("marks a skip whose device copy differs — Apply will NOT reconcile it", () => {
    const step: PlanStep = {
      ...base, action: "skip",
      payload: { subnet: "10.0.1.0/24" }, existing: { subnet: "10.0.9.0/24" },
    };
    const entry = stepToEntry(step);
    expect(entry.diverges).toBe(true);
    expect(entry.changes).toHaveLength(1);
  });

  it("leaves a matching skip unflagged", () => {
    const step: PlanStep = {
      ...base, action: "skip",
      payload: { subnet: "10.0.1.0/24" }, existing: { subnet: "10.0.1.0/24" },
    };
    expect(stepToEntry(step).diverges).toBe(false);
  });

  // A create has no device copy to disagree with, so "diverges" must stay off however many rows it
  // produces — otherwise every new object would carry a scary amber warning.
  it("never flags a create as diverging", () => {
    const step: PlanStep = { ...base, action: "create", payload: { subnet: "10.0.1.0/24" }, run: async () => {} };
    const entry = stepToEntry(step);
    expect(entry.changes).toHaveLength(1);
    expect(entry.diverges).toBe(false);
  });

  it("diffs an update against the object as it stands now", () => {
    const step: PlanStep = {
      kind: "user-group", label: "User Group (members)", name: "Office", action: "update",
      payload: { members: ["alice", "bob"] }, existing: { members: ["alice"] },
      run: async () => {},
    };
    const entry = stepToEntry(step);
    expect(entry.diverges).toBe(false); // an update is a planned write, not a silent mismatch
    expect(entry.changes[0].added).toEqual(["bob"]);
  });

  it("produces an empty entry for a skip the planner gave no detail for", () => {
    expect(stepToEntry({ ...base, action: "skip" }).changes).toEqual([]);
  });
});

describe("sshFallbackReason", () => {
  it("names a destructive statement as the reason", () => {
    expect(sshFallbackReason("config firewall policy\n    delete 5\nend")).toMatch(/delete \/ unset \/ purge/);
  });

  it("names the sections it has no endpoint for", () => {
    expect(sshFallbackReason("config system ha\n    set mode a-p\nend")).toMatch(/system ha/);
  });

  it("says so when there is no config block at all", () => {
    expect(sshFallbackReason("get system status")).toMatch(/No config block/);
  });
});
