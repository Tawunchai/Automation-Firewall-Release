import { describe, expect, it } from "vitest";
import { describeDeviceAccess } from "./deviceAccess";

// How one user's device access is described in the Users table.
//
// Three of these four cases are wrong in an interesting way if written carelessly, and all three
// would mislead an admin about who can reach the firewalls:
//
//   · an admin shown as "0 of 3 devices" implies a restriction that does not exist — they bypass
//     the grant table entirely;
//   · "0 of 3" for a real user reads like a count, not like "this person cannot open a single
//     device page", which is what it means;
//   · "0 of 0" is not the user's problem at all — there is nothing in the inventory to grant.

describe("describeDeviceAccess", () => {
  it("says an administrator reaches everything, without a count", () => {
    const got = describeDeviceAccess("Admin", 0, 5);

    expect(got.tone).toBe("admin");
    expect(got.label).toContain("All devices");
    expect(got.label).not.toContain("0");
  });

  it("is case-insensitive about the role, because the API and the table disagree on it", () => {
    expect(describeDeviceAccess("admin", 0, 5).tone).toBe("admin");
    expect(describeDeviceAccess("ADMIN", 0, 5).tone).toBe("admin");
  });

  it("calls out a user who can reach nothing", () => {
    const got = describeDeviceAccess("User", 0, 3);

    expect(got.tone).toBe("none");
    expect(got.label).toBe("No access");
  });

  it("blames the empty inventory rather than the user when there is nothing to grant", () => {
    const got = describeDeviceAccess("User", 0, 0);

    expect(got.tone).toBe("none");
    expect(got.label).toContain("inventory");
  });

  it("says 'all' rather than 'n of n'", () => {
    const got = describeDeviceAccess("User", 3, 3);

    expect(got.tone).toBe("all");
    expect(got.label).toBe("All 3 devices");
  });

  it("counts a partial grant", () => {
    const got = describeDeviceAccess("User", 2, 5);

    expect(got.tone).toBe("some");
    expect(got.label).toBe("2 of 5 devices");
  });

  // Defensive: a stale count after a device is deleted must not render "4 of 3 devices".
  it("does not print a count larger than the inventory", () => {
    expect(describeDeviceAccess("User", 4, 3).label).toBe("All 3 devices");
  });
});
