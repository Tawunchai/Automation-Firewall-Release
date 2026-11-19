import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { AppliedObject } from "./applyViaREST";

// Fallback has to tell two things apart: an object this chat message CREATED (delete it) and one it
// merely EDITED (write the pre-edit snapshot back). Deleting an edited object would destroy config
// the user already had — the whole reason the undo list used to refuse edits altogether.

const api = vi.hoisted(() => ({
  DeviceUpdateSecurityProfile: vi.fn(async () => {}),
  DeviceUpdateVirtualIP: vi.fn(async () => {}),
  DeviceUpdateUser: vi.fn(async () => {}),
  DeviceUpdateUserGroup: vi.fn(async () => {}),
  DeviceUpdateLDAPServer: vi.fn(async () => {}),
  DeviceUpdateRADIUSServer: vi.fn(async () => {}),
  DeviceDeleteAddress: vi.fn(async () => {}),
  DeviceDeleteService: vi.fn(async () => {}),
  DeviceDeleteVirtualIP: vi.fn(async () => {}),
  DeviceDeleteSchedule: vi.fn(async () => {}),
  DeviceListSchedules: vi.fn(async () => [] as unknown[]),
  DeviceDeleteSecurityProfile: vi.fn(async () => {}),
  DeviceDeleteUser: vi.fn(async () => {}),
  DeviceDeleteUserGroup: vi.fn(async () => {}),
  DeviceDeleteLDAPServer: vi.fn(async () => {}),
  DeviceDeleteRADIUSServer: vi.fn(async () => {}),
  DeviceDeleteExchangeConnector: vi.fn(async () => {}),
  DeviceDeleteIPsecTunnel: vi.fn(async () => {}),
  DeviceDeletePolicy: vi.fn(async () => {}),
  DeviceListPolicies: vi.fn(async () => [] as unknown[]),
  DeviceDeleteStaticRoute: vi.fn(async () => {}),
  DeviceListStaticRoutes: vi.fn(async () => [] as unknown[]),
}));

vi.mock("../../api/policyObject", () => api);

const { undoApply, restoreKeepsSecret } = await import("./undoApply");

const DEV = 1;

beforeEach(() => {
  for (const fn of Object.values(api)) (fn as Mock).mockClear();
});

describe("Fallback deletes a CREATED object", () => {
  it.each([
    ["address", api.DeviceDeleteAddress],
    ["service", api.DeviceDeleteService],
    ["virtual-ip", api.DeviceDeleteVirtualIP],
    ["user", api.DeviceDeleteUser],
    ["user-group", api.DeviceDeleteUserGroup],
    ["ldap-server", api.DeviceDeleteLDAPServer],
    ["radius-server", api.DeviceDeleteRADIUSServer],
    ["exchange-connector", api.DeviceDeleteExchangeConnector],
  ])("%s", async (kind, fn) => {
    const obj = { kind, label: kind, name: "X" } as AppliedObject;
    const { removed, failed } = await undoApply(DEV, [obj]);

    expect(fn).toHaveBeenCalledWith(DEV, "X");
    expect(removed).toEqual([obj]);
    expect(failed).toEqual([]);
  });

  it("deletes a security profile through its category", async () => {
    await undoApply(DEV, [{ kind: "webfilter", label: "Web Filter", name: "WF" }]);
    expect(api.DeviceDeleteSecurityProfile).toHaveBeenCalledWith(DEV, "webfilter", "WF");
  });
});

describe("Fallback RESTORES an edited object", () => {
  const restoreCase = (kind: AppliedObject["kind"], payload: unknown): AppliedObject => ({
    kind, label: `${kind} (edited)`, name: "X",
    restore: { kind, payload } as AppliedObject["restore"],
  });

  it.each([
    ["antivirus", api.DeviceUpdateSecurityProfile],
    ["webfilter", api.DeviceUpdateSecurityProfile],
    ["dnsfilter", api.DeviceUpdateSecurityProfile],
    ["application-control", api.DeviceUpdateSecurityProfile],
    ["file-filter", api.DeviceUpdateSecurityProfile],
  ])("writes the %s snapshot back through the profile endpoint", async (kind, fn) => {
    const payload = { name: "X", comment: "before" };
    await undoApply(DEV, [restoreCase(kind as AppliedObject["kind"], payload)]);
    expect(fn).toHaveBeenCalledWith(DEV, kind, "X", payload);
  });

  it.each([
    ["virtual-ip", api.DeviceUpdateVirtualIP],
    ["user", api.DeviceUpdateUser],
    ["user-group", api.DeviceUpdateUserGroup],
    ["ldap-server", api.DeviceUpdateLDAPServer],
    ["radius-server", api.DeviceUpdateRADIUSServer],
  ])("writes the %s snapshot back", async (kind, fn) => {
    const payload = { name: "X" };
    await undoApply(DEV, [restoreCase(kind as AppliedObject["kind"], payload)]);
    expect(fn).toHaveBeenCalledWith(DEV, "X", payload);
  });

  // The point of the whole mechanism: an edited object must never be deleted.
  it("never deletes an object that carries a snapshot", async () => {
    await undoApply(DEV, [
      restoreCase("user-group", { name: "Office", group_type: "firewall" as const, members: ["alice"] }),
      restoreCase("ldap-server", { name: "AD" }),
      restoreCase("virtual-ip", { name: "VIP" }),
    ]);

    expect(api.DeviceDeleteUserGroup).not.toHaveBeenCalled();
    expect(api.DeviceDeleteLDAPServer).not.toHaveBeenCalled();
    expect(api.DeviceDeleteVirtualIP).not.toHaveBeenCalled();
  });

  it("reports a restore as handled, with the snapshot still attached", async () => {
    const obj = restoreCase("user-group", { name: "Office" });
    const { removed, failed } = await undoApply(DEV, [obj]);

    expect(failed).toEqual([]);
    expect(removed).toHaveLength(1);
    // The chat words its line off this flag ("คืนค่าเดิมแล้ว" vs "แล้ว").
    expect(removed[0].restore).toBeTruthy();
  });

  it("restores the members a group had before Apply added to it", async () => {
    const before = { name: "Office", group_type: "firewall" as const, members: ["alice"] };
    await undoApply(DEV, [{
      kind: "user-group", label: "User Group (members)", name: "Office",
      restore: { kind: "user-group", payload: before },
    }]);
    expect(api.DeviceUpdateUserGroup).toHaveBeenCalledWith(DEV, "Office", before);
  });
});

describe("restoreKeepsSecret", () => {
  // The device answers "ENC XXXX" for these, so a snapshot never carries the old value.
  it.each(["user", "ldap-server", "radius-server"])("flags %s", (kind) => {
    expect(restoreKeepsSecret({
      kind: kind as AppliedObject["kind"], label: "", name: "X",
      restore: { kind, payload: {} } as AppliedObject["restore"],
    })).toBe(true);
  });

  it.each(["antivirus", "webfilter", "virtual-ip", "user-group"])("does not flag %s", (kind) => {
    expect(restoreKeepsSecret({
      kind: kind as AppliedObject["kind"], label: "", name: "X",
      restore: { kind, payload: {} } as AppliedObject["restore"],
    })).toBe(false);
  });

  it("does not flag a plain create", () => {
    expect(restoreKeepsSecret({ kind: "user", label: "User", name: "alice" })).toBe(false);
  });
});

describe("ordering", () => {
  // Reverse dependency order: a group must go before its members, and an auth server after every
  // group that named it (FortiGate answers -23 otherwise).
  it("removes a group before its user, and the auth servers last", async () => {
    const order: string[] = [];
    api.DeviceDeleteUser.mockImplementation(async () => { order.push("user"); });
    api.DeviceDeleteUserGroup.mockImplementation(async () => { order.push("group"); });
    api.DeviceDeleteLDAPServer.mockImplementation(async () => { order.push("ldap"); });
    api.DeviceDeleteExchangeConnector.mockImplementation(async () => { order.push("exchange"); });

    await undoApply(DEV, [
      { kind: "exchange-connector", label: "Exchange Connector", name: "E" },
      { kind: "ldap-server", label: "LDAP Server", name: "L" },
      { kind: "user", label: "User", name: "U" },
      { kind: "user-group", label: "User Group", name: "G" },
    ]);

    expect(order).toEqual(["group", "user", "ldap", "exchange"]);
  });
});

describe("failures", () => {
  it("keeps going after one object fails, and reports it", async () => {
    api.DeviceDeleteUserGroup.mockRejectedValueOnce({
      response: { data: { error: "FortiGate API error -23 The entry is used by other 1 entry" } },
    });

    const { removed, failed } = await undoApply(DEV, [
      { kind: "user-group", label: "User Group", name: "G" },
      { kind: "user", label: "User", name: "U" },
    ]);

    expect(removed.map((o) => o.name)).toEqual(["U"]);
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toContain("still referenced by another object");
  });

  // Already off the device is the end state we wanted, so it counts as done.
  it("treats an already-missing object as removed", async () => {
    api.DeviceDeleteAddress.mockRejectedValueOnce({ response: { status: 404 } });
    const { removed, failed } = await undoApply(DEV, [{ kind: "address", label: "Address", name: "A" }]);
    expect(removed).toHaveLength(1);
    expect(failed).toEqual([]);
  });

  it("reports a failed RESTORE without deleting anything", async () => {
    api.DeviceUpdateLDAPServer.mockRejectedValueOnce({ response: { data: { error: "boom" } } });
    const { removed, failed } = await undoApply(DEV, [{
      kind: "ldap-server", label: "LDAP Server (edited)", name: "AD",
      restore: { kind: "ldap-server", payload: { name: "AD" } as never },
    }]);

    expect(removed).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(api.DeviceDeleteLDAPServer).not.toHaveBeenCalled();
  });
});
