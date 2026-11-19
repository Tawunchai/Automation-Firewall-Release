import { describe, expect, it } from "vitest";
import { getLinks, resolveCrumb, type SidebarSection } from "./data";

// The link table is the console's map: the sidebar renders it, the navbar derives the breadcrumb
// from it, and the filter box searches it. That makes two things worth pinning here rather than
// finding by clicking.
//
//   · WHERE a page lives. The sections were reorganised — Troubleshoot moved into Diagnostics,
//     Rule Lifecycle / Audit became Analytics, Change Ledger joined Security — and a page silently
//     listed in two sections, or in none, is a map that lies.
//   · WHAT A ROLE SEES. Role filtering must only ever REMOVE entries. Change Ledger in particular
//     is readable by any signed-in user, and it now sits in a section that used to be pushed only
//     for admins; getting that wrong hides a page a user is allowed to open, with no error to
//     notice.

const admin = () => getLinks({ isAdmin: true });
const user = () => getLinks({ isAdmin: false });

const section = (sections: SidebarSection[], key: string): SidebarSection => {
  const hit = sections.find((s) => s.key === key);
  if (!hit) throw new Error(`no section "${key}" — sections: ${sections.map((s) => s.key).join(", ")}`);
  return hit;
};

const names = (sections: SidebarSection[], key: string) => section(sections, key).links.map((l) => l.name);

/** Every link in the menu, regardless of section. */
const allNames = (sections: SidebarSection[]) => sections.flatMap((s) => s.links.map((l) => l.name));

describe("section layout", () => {
  it("leads Analytics with Config Drift, then the pages that JUDGE the policy table", () => {
    // Config Drift leads: the other two judge a configuration the console can see, while drift
    // is the only page that can say something happened here that NOBODY in this console did.
    expect(names(admin(), "analytics")).toEqual([
      "config-drift", "rule-lifecycle", "audit",
    ]);
  });

  // Drift reads this platform's own tables, so it works for a user with device grants exactly as
  // the Change Ledger does — and it must not become an admin-only page by accident, which is what
  // would happen if it were ever moved inside the isAdmin block beside Audit.
  it("shows Config Drift to a non-admin as well", () => {
    expect(names(user(), "analytics")).toContain("config-drift");
  });

  it("puts Local Traffic and Log Settings under Log & Report", () => {
    // Log Settings is last on purpose: it decides what the entry above it has to show. With
    // implicit-deny logging off there is nothing in Local Traffic to find, however well you search.
    expect(names(admin(), "logreport")).toEqual(["logs/local-traffic", "log-settings"]);
  });

  // The System section is the unit's own configuration rather than the traffic through it. One of
  // its two pages is an open read; the other is the only READ in the console that is admin-gated,
  // because the list names who can administer the firewall and from which addresses.
  it("puts HA Status under System for everyone", () => {
    expect(names(admin(), "system")).toContain("ha-status");
    expect(names(user(), "system")).toEqual(["ha-status"]);
  });

  it("hides Administrators from a non-admin entirely", () => {
    // A menu entry that always 403s is worse than no entry — and here the endpoint refuses the
    // read as well, not just the writes.
    expect(names(admin(), "system")).toContain("device-admins");
    expect(allNames(user())).not.toContain("device-admins");
  });

  it("shows Log & Report to a non-admin without the traffic log", () => {
    // Log Settings is a read whose every write is admin-gated in the controller, so it stays and
    // the section still appears.
    expect(names(user(), "logreport")).toEqual(["log-settings"]);
    expect(allNames(user())).not.toContain("logs/local-traffic");
  });

  it("puts Troubleshooting at the head of Diagnostics", () => {
    // In front of the SSH-only tools on purpose: it carries the question people arrive with
    // ("why can't A reach B?") and answers both halves of it — the policy walk and the live
    // session table. Troubleshoot used to be a separate entry above it; the two were merged
    // because chasing a real problem means switching between them constantly.
    expect(names(admin(), "diagnostics")[0]).toBe("diagnostics/troubleshooting");
    expect(names(user(), "diagnostics")[0]).toBe("diagnostics/troubleshooting");
  });

  it("no longer carries a standalone Troubleshoot entry", () => {
    expect(allNames(admin())).not.toContain("troubleshoot");
    expect(allNames(user())).not.toContain("troubleshoot");
  });

  // Notify leads Apps for an admin and is absent for everyone else. It used to be visible to both,
  // back when it was a placeholder that did nothing; now every /notify endpoint is admin-gated on
  // the server — a channel holds a LINE bot token, a rule decides who is woken at 3am — so a user
  // who clicked it would land on a page that could only 403.
  it("puts Notify at the head of Apps, for admins only", () => {
    expect(names(admin(), "apps")[0]).toBe("notify");
    expect(allNames(user())).not.toContain("notify");
    expect(names(user(), "apps")[0]).toBe("calendar");
  });

  // The ledger became a tab of Config Drift. A leftover sidebar entry would be a second way into
  // the same timeline, and the old path only exists as a redirect now.
  it("no longer lists Change Ledger as a page of its own", () => {
    expect(allNames(admin())).not.toContain("change-ledger");
    expect(allNames(user())).not.toContain("change-ledger");
  });

  it("keeps Config Drift — which now carries the ledger — under Analytics for every role", () => {
    expect(names(admin(), "analytics")).toContain("config-drift");
    expect(names(user(), "analytics")).toContain("config-drift");
  });

  // Credentials was an admin page in this section. It is gone — a person's own firewall account is
  // personal, so it lives on their profile now (pages/account/credentials) and is reachable through
  // the identity menu instead of the sidebar. A leftover link here would be a dead route.
  it("no longer carries a Credentials entry anywhere", () => {
    expect(allNames(admin())).not.toContain("credentials");
    expect(allNames(user())).not.toContain("credentials");
  });

  it("leaves Automation with only the pages that run something", () => {
    // Change Requests is here, and not in Analytics beside Config Drift and Rule Lifecycle, for
    // the reason that separates the two sections: those look BACK at a firewall and write nothing,
    // while this section's errand is "change something or queue a job" — and a change request is a
    // queued job that becomes a write the moment somebody approves it.
    expect(names(admin(), "automation"))
      .toEqual(["devices", "config-deploy", "ai-assistant", "change-requests"]);
  });

  // Unlike Notify or Audit, the queue is NOT admin-only. An admin reviews; the account whose Save
  // turned into a 202 has to be able to see what became of it and to withdraw it. Only the review
  // endpoint is admin-gated, and the page hides those controls rather than the whole route.
  it("shows Change Requests to both roles, because both halves of the queue are used", () => {
    expect(allNames(admin())).toContain("change-requests");
    expect(allNames(user())).toContain("change-requests");
  });

  it("keeps every page in exactly one section", () => {
    for (const sections of [admin(), user()]) {
      const seen = allNames(sections);
      expect(seen).toEqual([...new Set(seen)]);
    }
  });

  it("keeps section keys unique — they are the localStorage collapse memory", () => {
    const keys = admin().map((s) => s.key);
    expect(keys).toEqual([...new Set(keys)]);
  });
});

describe("role filtering", () => {
  it("hides the Security section from a non-admin now that nothing in it is theirs", () => {
    // Change Ledger was the one user-visible entry; it moved into Config Drift. An empty section
    // heading would lead nowhere.
    expect(user().some((s) => s.key === "security")).toBe(false);
    expect(admin().some((s) => s.key === "security")).toBe(true);
  });

  it("hides the SSH-only diagnostics and Audit from a non-admin", () => {
    const shown = allNames(user());
    // Trace Route is SSH end to end — there is no half a non-admin could use. (Ping is no longer a
    // sidebar entry at all: it moved into Troubleshooting as an admin-only tab.)
    for (const hidden of ["diagnostics/ping", "diagnostics/traceroute", "audit"]) {
      expect(shown).not.toContain(hidden);
    }
    // …while the read-only one stays. Troubleshooting is here because its policy walk is CMDB +
    // monitor GETs, with no SSH; the SSH Ping tab inside it is gated separately in the page.
    expect(shown).toContain("diagnostics/troubleshooting");
  });

  it("only ever removes entries — a user never sees a page an admin does not", () => {
    const adminNames = new Set(allNames(admin()));
    for (const name of allNames(user())) expect(adminNames.has(name)).toBe(true);
  });
});

describe("resolveCrumb", () => {
  it("names the section a page was moved into", () => {
    const s = admin();
    expect(resolveCrumb("/admin/diagnostics/troubleshooting", s)).toMatchObject({ section: "Diagnostics", label: "Troubleshooting" });
    expect(resolveCrumb("/admin/notify", s)).toMatchObject({ section: "Apps", label: "Notify" });
    expect(resolveCrumb("/admin/logs/local-traffic", s)).toMatchObject({ section: "Log & Report", label: "Local Traffic" });
    expect(resolveCrumb("/admin/rule-lifecycle", s)).toMatchObject({ section: "Analytics", label: "Rule Lifecycle" });
    expect(resolveCrumb("/admin/audit", s)).toMatchObject({ section: "Analytics", label: "Audit / Review" });
    expect(resolveCrumb("/admin/config-drift", s)).toMatchObject({ section: "Analytics", label: "Config Drift" });
  });

  it("still resolves Audit for a role whose menu does not list it", () => {
    // Falls through to EXTRA_CRUMBS, which has to name the same section as the menu does.
    expect(resolveCrumb("/admin/audit", user())).toMatchObject({ section: "Analytics" });
  });

  it("resolves a child route to its parent page", () => {
    expect(resolveCrumb("/admin/firewall-policy/create", admin())).toMatchObject({ label: "Firewall Policy" });
    expect(resolveCrumb("/admin/diagnostics/traceroute", admin())).toMatchObject({ section: "Diagnostics", label: "Trace Route" });
  });

  it("prefers the longest match", () => {
    expect(resolveCrumb("/admin/security-profiles/antivirus", admin())).toMatchObject({ label: "AntiVirus" });
  });

  it("falls back to a title-cased slug for an unknown page", () => {
    expect(resolveCrumb("/admin/not-a-page", admin())).toMatchObject({ section: "Admin", label: "Not A Page" });
  });
});
