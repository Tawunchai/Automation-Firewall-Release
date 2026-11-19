import { describe, it, expect, vi, beforeEach } from "vitest";

// Integration test for Dry-run: real CLI in, real report out.
//
// dryRun.test.ts pins the comparison rules in isolation. This one exercises the whole path —
// parse the AI's CLI → planApply reads the device → stepToEntry diffs each step — with the device
// layer mocked to the LAB FIREWALL's actual tables. That is where the risk lives: Dry-run's promise
// is that it shows what Apply will really do, and it can only keep that promise because both run
// the same planner. A test that stubbed the planner would prove nothing.

const listAddresses = vi.fn();
const listServices = vi.fn();
const listPolicies = vi.fn();
const listSchedules = vi.fn();
const listVirtualIPs = vi.fn();
const listUsers = vi.fn();
const listUserGroups = vi.fn();
const getUserGroup = vi.fn();
const listLDAP = vi.fn();
const listRADIUS = vi.fn();
const listTunnels = vi.fn();
const getPolicyProfiles = vi.fn();
const getSecurityProfile = vi.fn();
const getAppControlMetadata = vi.fn();

// A PARTIAL mock: only the device calls are replaced. The module also exports plain constants
// (SERVICE_CATEGORIES and friends) that the CLI parsers read at import time, and stubbing those
// away would break parsing rather than the network.
vi.mock("../../api/policyObject", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DeviceListAddresses: (...a: unknown[]) => listAddresses(...a),
  DeviceCreateAddress: vi.fn(),
  DeviceListServices: (...a: unknown[]) => listServices(...a),
  DeviceCreateService: vi.fn(),
  DeviceListSchedules: (...a: unknown[]) => listSchedules(...a),
  DeviceCreateSchedule: vi.fn(),
  DeviceGetPolicyProfiles: (...a: unknown[]) => getPolicyProfiles(...a),
  DeviceCreateSecurityProfile: vi.fn(),
  DeviceGetSecurityProfile: (...a: unknown[]) => getSecurityProfile(...a),
  DeviceGetAppControlMetadata: (...a: unknown[]) => getAppControlMetadata(...a),
  DeviceCreatePolicy: vi.fn(),
  DeviceListPolicies: (...a: unknown[]) => listPolicies(...a),
  DeviceListStaticRoutes: vi.fn(async () => []),
  DeviceCreateStaticRoute: vi.fn(),
  DeviceListVirtualIPs: (...a: unknown[]) => listVirtualIPs(...a),
  DeviceCreateVirtualIP: vi.fn(),
  DeviceListUsers: (...a: unknown[]) => listUsers(...a),
  DeviceCreateUser: vi.fn(),
  DeviceListLDAPServers: (...a: unknown[]) => listLDAP(...a),
  DeviceCreateLDAPServer: vi.fn(),
  DeviceListRADIUSServers: (...a: unknown[]) => listRADIUS(...a),
  DeviceCreateRADIUSServer: vi.fn(),
  DeviceListUserGroups: (...a: unknown[]) => listUserGroups(...a),
  DeviceCreateUserGroup: vi.fn(),
  DeviceUpdateUserGroup: vi.fn(),
  DeviceGetUserGroup: (...a: unknown[]) => getUserGroup(...a),
  DeviceListIPsecTunnels: (...a: unknown[]) => listTunnels(...a),
  DeviceCreateIPsecTunnel: vi.fn(),
}));

const { dryRun } = await import("./dryRun");
const { planApply } = await import("./applyViaREST");

// The lab device's real address table (the subset a policy suggestion touches).
const LAB_ADDRESSES = [
  { name: "all", type: "ipmask", subnet: "0.0.0.0/0" },
  { name: "LAN-Network", type: "ipmask", subnet: "192.168.1.0/24" },
  { name: "Guest-WiFi-Subnet", type: "ipmask", subnet: "10.10.20.0/24" },
];

beforeEach(() => {
  vi.clearAllMocks();
  listAddresses.mockResolvedValue(LAB_ADDRESSES);
  listServices.mockResolvedValue([{ name: "HTTPS", protocol: "TCP/UDP/SCTP", tcp_ports: "443" }]);
  listPolicies.mockResolvedValue([]);
  listSchedules.mockResolvedValue([{ name: "always", type: "recurring" }]);
  listVirtualIPs.mockResolvedValue([]);
  listUsers.mockResolvedValue([]);
  listUserGroups.mockResolvedValue([]);
  listLDAP.mockResolvedValue([]);
  listRADIUS.mockResolvedValue([]);
  listTunnels.mockResolvedValue([]);
  getPolicyProfiles.mockResolvedValue({
    av_profiles: [], webfilter_profiles: [], dnsfilter_profiles: [],
    app_lists: [], file_filter_profiles: [],
  });
  getSecurityProfile.mockResolvedValue(null);
});

const NEW_ADDRESS_CLI = `
config firewall address
    edit "Sales-Net"
        set subnet 10.0.7.0 255.255.255.0
    next
end`;

describe("dryRun — a brand new object", () => {
  it("plans a create and lists the fields it will be built with", async () => {
    const report = await dryRun(1, NEW_ADDRESS_CLI);
    if (report.transport !== "rest") throw new Error("expected the REST path");

    expect(report.counts).toMatchObject({ create: 1, update: 0, skip: 0, diverging: 0 });
    const [entry] = report.entries;
    expect(entry).toMatchObject({ kind: "address", name: "Sales-Net", action: "create", diverges: false });
    expect(entry.changes.find((c) => c.field === "subnet")?.after).toBe("10.0.7.0/24");
  });

  it("does not read the device more than the plan needs", async () => {
    await dryRun(1, NEW_ADDRESS_CLI);
    // The Application Control database is a ~2,400-entry download. A CLI with no app sensor in it
    // must never pull it — that was the whole reason the planner fetches it lazily.
    expect(getAppControlMetadata).not.toHaveBeenCalled();
  });
});

// ⚠️ THE FINDING THIS FEATURE EXISTS FOR.
// Apply SKIPS an object whose name is already on the device and reports "already exists on the
// device". That reads as agreement — but the device's copy can say something completely different,
// and Apply will not reconcile it. Before Dry-run there was nothing anywhere that said so.
describe("dryRun — a name that already exists but does not match", () => {
  const CLI = `
config firewall address
    edit "LAN-Network"
        set subnet 192.168.99.0 255.255.255.0
    next
end`;

  it("flags the mismatch instead of calling it 'already exists'", async () => {
    const report = await dryRun(1, CLI);
    if (report.transport !== "rest") throw new Error("expected the REST path");

    expect(report.counts).toMatchObject({ create: 0, skip: 1, diverging: 1 });
    const [entry] = report.entries;
    expect(entry.action).toBe("skip");
    expect(entry.diverges).toBe(true);
    const subnet = entry.changes.find((c) => c.field === "subnet");
    expect(subnet?.before).toBe("192.168.1.0/24");  // what the firewall actually enforces
    expect(subnet?.after).toBe("192.168.99.0/24");  // what the CLI on screen claims
  });

  it("stays quiet when the device's copy really does match", async () => {
    const report = await dryRun(1, `
config firewall address
    edit "LAN-Network"
        set subnet 192.168.1.0 255.255.255.0
    next
end`);
    if (report.transport !== "rest") throw new Error("expected the REST path");
    expect(report.counts.diverging).toBe(0);
    expect(report.entries[0].diverges).toBe(false);
  });
});

describe("dryRun — a policy and everything it references", () => {
  const CLI = `${NEW_ADDRESS_CLI}
config firewall policy
    edit 0
        set name "Sales-to-Internet"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "Sales-Net"
        set dstaddr "all"
        set service "HTTPS"
        set action accept
        set schedule "always"
        set nat enable
    next
end`;

  it("plans the address BEFORE the policy that references it", async () => {
    const report = await dryRun(1, CLI);
    if (report.transport !== "rest") throw new Error("expected the REST path");

    expect(report.entries.map((e) => e.kind)).toEqual(["address", "policy"]);
    expect(report.counts.create).toBe(2);
  });

  it("shows the policy's NAT setting, which is the one a reviewer checks", async () => {
    const report = await dryRun(1, CLI);
    if (report.transport !== "rest") throw new Error("expected the REST path");
    const policy = report.entries.find((e) => e.kind === "policy")!;
    expect(policy.changes.find((c) => c.field === "nat")?.after).toBe("enable");
    expect(policy.changes.find((c) => c.field === "action")?.after).toBe("accept");
  });
});

// A user group that already exists is UPDATED by Apply — a write to an object the user never asked
// us to create. That is the one thing in the whole plan that can destroy existing config, so the
// before/after has to be exact.
describe("dryRun — an existing user group's member list", () => {
  const CLI = `
config user group
    edit "Office-Users"
        set member "alice"
    next
end`;

  beforeEach(() => {
    listUserGroups.mockResolvedValue([{ name: "Office-Users", group_type: "firewall" }]);
    getUserGroup.mockResolvedValue({ name: "Office-Users", group_type: "firewall", members: ["bob", "carol"] });
  });

  it("plans an update and names the members being added", async () => {
    const report = await dryRun(1, CLI);
    if (report.transport !== "rest") throw new Error("expected the REST path");

    const entry = report.entries.find((e) => e.kind === "user-group")!;
    expect(entry.action).toBe("update");
    const members = entry.changes.find((c) => c.field === "members")!;
    expect(members.added).toEqual(["alice"]);
    // The applier MERGES rather than replacing, so nobody is dropped — and the preview has to say
    // that plainly, because the raw CLI (`set member "alice"`) reads like it would wipe the list.
    expect(members.removed).toEqual([]);
    expect(members.after).toBe("bob, carol, alice");
  });
});

describe("dryRun — suggestions it cannot preview object by object", () => {
  it("says so for a delete, rather than showing an empty plan", async () => {
    const report = await dryRun(1, "config firewall policy\n    delete 5\nend");
    expect(report.transport).toBe("ssh");
    if (report.transport !== "ssh") throw new Error("unreachable");
    expect(report.reason).toMatch(/delete/);
  });

  it("says so for a section with no REST endpoint", async () => {
    const report = await dryRun(1, "config system ha\n    set mode a-p\nend");
    expect(report.transport).toBe("ssh");
  });

  it("never touches the device for a suggestion it cannot preview", async () => {
    await dryRun(1, "config firewall policy\n    delete 5\nend");
    expect(listAddresses).not.toHaveBeenCalled();
    expect(listPolicies).not.toHaveBeenCalled();
  });
});

// The guarantee Dry-run rests on: it and Apply ask the SAME planner. If planApply ever grew a
// branch that only fires for one of them, the preview would start lying.
describe("planApply — Dry-run and Apply see the same plan", () => {
  it("produces the same steps, in the same order, either way", async () => {
    const cli = `${NEW_ADDRESS_CLI}
config firewall policy
    edit 0
        set name "Sales-to-Internet"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "Sales-Net"
        set dstaddr "all"
        set service "HTTPS"
        set action accept
        set schedule "always"
    next
end`;
    const plain = await planApply(1, cli);
    const detailed = await planApply(1, cli, { detailed: true });

    expect(detailed.map((s) => [s.kind, s.name, s.action]))
      .toEqual(plain.map((s) => [s.kind, s.name, s.action]));
  });

  it("only the SKIP steps carry extra detail — the create path is untouched", async () => {
    const cli = `
config firewall address
    edit "LAN-Network"
        set subnet 192.168.99.0 255.255.255.0
    next
end`;
    const [plain] = await planApply(1, cli);
    const [detailed] = await planApply(1, cli, { detailed: true });

    expect(plain.action).toBe("skip");
    expect(detailed.action).toBe("skip");
    // Both know it is a skip; only the detailed run pays to find out HOW it differs.
    expect(detailed.existing).toBeTruthy();
    // And neither plans a write for it.
    expect(plain.run).toBeUndefined();
    expect(detailed.run).toBeUndefined();
  });
});

