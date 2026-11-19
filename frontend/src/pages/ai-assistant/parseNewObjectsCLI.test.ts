import { describe, it, expect } from "vitest";
import {
  parseFileFilterFromCLI, parseAllFileFiltersFromCLI, fileFilterDraftToForm,
} from "./parseFileFilterCLI";
import {
  parseUserGroupFromCLI, parseAllUserGroupsFromCLI, userGroupDraftToForm, groupTakesMembers,
} from "./parseUserGroupCLI";
import {
  parseUserDefinitionFromCLI, parseAllUserDefinitionsFromCLI, userDefinitionDraftToForm,
  splitSMSPhone, isPlaceholderPassword,
} from "./parseUserDefinitionCLI";
import { extractPrereqBlocks } from "./parsePrereqCLI";
import { parsePolicyFromCLI, referencedByPolicy } from "./parsePolicyCLI";
import { canApplyViaREST } from "./applyViaREST";

// These parsers turn the AI's FortiOS CLI into the drafts the wizards and Apply use. Every
// device rule they encode was verified live against the lab FortiGate (80E / FortiOS 7.2.10).

// ─── File Filter ───────────────────────────────────────────────────────────────
const FF_CLI = `
config file-filter profile
    edit "FF-Block-Exec"
        set comment "Block executables"
        set feature-set flow
        set scan-archive-contents enable
        config rules
            edit "block-exe"
                set comment "no executables inbound"
                set protocol http ftp
                set action block
                set direction incoming
                set password-protected any
                set file-type exe bat elf
            next
            edit "watch-archives"
                set protocol http
                set action log-only
                set password-protected yes
                set file-type zip 7z
            next
        end
    next
end
`;

describe("parseFileFilterFromCLI", () => {
  it("parses the profile fields", () => {
    const p = parseFileFilterFromCLI(FF_CLI)!;
    expect(p.target).toBe("FF-Block-Exec");
    expect(p.form.name).toBe("FF-Block-Exec");
    expect(p.form.comment).toBe("Block executables");
    expect(p.form.scan_archive_contents).toBe(true);
    expect(p.form.rules).toHaveLength(2);
  });

  it("parses each rule, mapping CLI log-only back to the GUI's Monitor", () => {
    const [r1, r2] = parseFileFilterFromCLI(FF_CLI)!.form.rules!;
    expect(r1).toMatchObject({
      name: "block-exe", comment: "no executables inbound",
      protocols: ["http", "ftp"], direction: "incoming",
      password_protected: false, file_types: ["exe", "bat", "elf"], action: "block",
    });
    // The CLI has no "monitor" keyword — the device stores the GUI's Monitor as log-only.
    expect(r2.action).toBe("monitor");
    expect(r2.password_protected).toBe(true);
    expect(r2.file_types).toEqual(["zip", "7z"]);
  });

  it("does not read the rules' set-lines as profile fields", () => {
    // "set comment" appears at both levels — the profile must keep its own.
    expect(parseFileFilterFromCLI(FF_CLI)!.form.comment).toBe("Block executables");
  });

  it("defaults scan archive contents to on, like the GUI", () => {
    const p = parseFileFilterFromCLI(`
config file-filter profile
    edit "FF"
        config rules
            edit "r"
                set protocol http
                set file-type exe
            next
        end
    next
end`)!;
    expect(p.form.scan_archive_contents).toBe(true);
    expect(p.form.rules![0].action).toBe("monitor"); // safe default
    expect(p.form.rules![0].direction).toBe("any");
  });

  it("honours an explicit scan-archive-contents disable", () => {
    const p = parseFileFilterFromCLI(`
config file-filter profile
    edit "FF"
        set scan-archive-contents disable
    next
end`)!;
    expect(p.form.scan_archive_contents).toBe(false);
  });

  it("drops a protocol the device doesn't know", () => {
    const p = parseFileFilterFromCLI(`
config file-filter profile
    edit "FF"
        config rules
            edit "r"
                set protocol http telnet gopher
                set file-type exe
            next
        end
    next
end`)!;
    expect(p.form.rules![0].protocols).toEqual(["http"]);
  });

  it("keeps the rename target separate from the new name", () => {
    const p = parseFileFilterFromCLI(`
config file-filter profile
    edit "Old-Name"
        set name "New-Name"
    next
end`)!;
    expect(p.target).toBe("Old-Name");
    expect(p.form.name).toBe("New-Name");
  });

  it("returns null when there is no file-filter block", () => {
    expect(parseFileFilterFromCLI(`config firewall policy\n edit 0\n next\nend`)).toBeNull();
  });

  it("parses every profile a suggestion defines", () => {
    const two = FF_CLI + `
config file-filter profile
    edit "FF-Second"
        config rules
            edit "r"
                set protocol http
                set file-type pdf
            next
        end
    next
end`;
    expect(parseAllFileFiltersFromCLI(two).map((p) => p.target)).toEqual(["FF-Block-Exec", "FF-Second"]);
  });
});

describe("fileFilterDraftToForm", () => {
  it("keeps a valid draft intact", () => {
    const form = fileFilterDraftToForm(parseFileFilterFromCLI(FF_CLI)!.form);
    expect(form.rules).toHaveLength(2);
    expect(form.rules[0].file_types).toEqual(["exe", "bat", "elf"]);
  });

  // Verified live: with password-protected=yes only 7z/msoffice/msofficex/pdf/rar/zip are accepted;
  // anything else is "-3 entry not found in datasource".
  it("drops file types the device rejects on a password-protected rule", () => {
    const form = fileFilterDraftToForm({
      name: "FF",
      rules: [{
        name: "r", comment: "", protocols: ["http"], direction: "any",
        password_protected: true, file_types: ["zip", "exe", "pdf", "bat"], action: "block",
      }],
    });
    expect(form.rules[0].file_types).toEqual(["zip", "pdf"]);
  });

  it("leaves the same types alone when the toggle is off", () => {
    const form = fileFilterDraftToForm({
      name: "FF",
      rules: [{
        name: "r", comment: "", protocols: ["http"], direction: "any",
        password_protected: false, file_types: ["zip", "exe"], action: "block",
      }],
    });
    expect(form.rules[0].file_types).toEqual(["zip", "exe"]);
  });

  // Verified live: a mail-only rule has its direction forced to "any" with a 200 OK.
  it("forces direction to any on a mail-only rule", () => {
    const form = fileFilterDraftToForm({
      name: "FF",
      rules: [{
        name: "r", comment: "", protocols: ["smtp", "imap"], direction: "outgoing",
        password_protected: false, file_types: ["exe"], action: "block",
      }],
    });
    expect(form.rules[0].direction).toBe("any");
  });

  it("keeps the direction when a direction-capable protocol is present", () => {
    const form = fileFilterDraftToForm({
      name: "FF",
      rules: [{
        name: "r", comment: "", protocols: ["smtp", "http"], direction: "outgoing",
        password_protected: false, file_types: ["exe"], action: "block",
      }],
    });
    expect(form.rules[0].direction).toBe("outgoing");
  });

  // The device rejects a rule with no file types (-61), so it must never be sent.
  it("drops a rule with no file types", () => {
    const form = fileFilterDraftToForm({
      name: "FF",
      rules: [
        { name: "empty", comment: "", protocols: ["http"], direction: "any", password_protected: false, file_types: [], action: "block" },
        { name: "ok", comment: "", protocols: ["http"], direction: "any", password_protected: false, file_types: ["exe"], action: "block" },
      ],
    });
    expect(form.rules.map((r) => r.name)).toEqual(["ok"]);
  });

  // A password-protected rule whose types are ALL rejected would end up with none — and a rule
  // with no file types is invalid, so it has to go rather than be sent and fail.
  it("drops a password-protected rule left with no valid types", () => {
    const form = fileFilterDraftToForm({
      name: "FF",
      rules: [{
        name: "r", comment: "", protocols: ["http"], direction: "any",
        password_protected: true, file_types: ["exe", "bat"], action: "block",
      }],
    });
    expect(form.rules).toHaveLength(0);
  });
});

// ─── User Group ────────────────────────────────────────────────────────────────
describe("parseUserGroupFromCLI", () => {
  it("parses a firewall group with members", () => {
    const g = parseUserGroupFromCLI(`
config user group
    edit "Office-Users"
        set group-type firewall
        set member "alice" "bob"
    next
end`)!;
    expect(g.target).toBe("Office-Users");
    expect(g.form).toMatchObject({ name: "Office-Users", group_type: "firewall", members: ["alice", "bob"] });
  });

  it("defaults an unspecified group-type to firewall", () => {
    const g = parseUserGroupFromCLI(`
config user group
    edit "G"
        set member "alice"
    next
end`)!;
    expect(g.form.group_type).toBe("firewall");
    expect(g.form.members).toEqual(["alice"]);
  });

  it("parses an rsso group and gives it no members", () => {
    const g = parseUserGroupFromCLI(`
config user group
    edit "RSSO-Sales"
        set group-type rsso
        set sso-attribute-value "Sales-RADIUS"
    next
end`)!;
    expect(g.form.sso_attribute_value).toBe("Sales-RADIUS");
    expect(g.form.members).toBeUndefined();
  });

  // The device silently drops a member list on guest/rsso groups, so the draft must not show one.
  it("ignores members on a guest group", () => {
    const g = parseUserGroupFromCLI(`
config user group
    edit "Guests"
        set group-type guest
        set member "alice"
        set expire 7200
    next
end`)!;
    expect(g.form.members).toBeUndefined();
    expect(g.form.expire).toBe(7200);
  });

  it("parses the guest block", () => {
    const g = parseUserGroupFromCLI(`
config user group
    edit "Guests"
        set group-type guest
        set user-id specify
        set password specify
        set expire-type first-successful-login
        set expire 7200
        set max-accounts 25
    next
end`)!;
    expect(g.form).toMatchObject({
      group_type: "guest", user_id: "specify", password: "specify",
      expire_type: "first-successful-login", expire: 7200, max_accounts: 25,
    });
  });

  it("does not read a config match sub-block as group fields", () => {
    const g = parseUserGroupFromCLI(`
config user group
    edit "AD-VPN"
        set group-type firewall
        set member "AD-LDAP"
        config match
            edit 1
                set server-name "AD-LDAP"
                set group-name "CN=VPN-Users"
            next
        end
    next
end`)!;
    expect(g.form.members).toEqual(["AD-LDAP"]);
    expect(g.form.name).toBe("AD-VPN"); // "set group-name" inside match must not rename it
  });

  // A `config match` block contains its OWN `edit … next`. A flat non-greedy /edit … next/ would
  // stop at THAT next and silently truncate the group — losing every field written after the
  // sub-block. This orders the fields so only balanced parsing survives.
  it("keeps fields that come AFTER a config match sub-block", () => {
    const g = parseUserGroupFromCLI(`
config user group
    edit "AD-VPN"
        config match
            edit 1
                set server-name "AD-LDAP"
                set group-name "CN=VPN-Users"
            next
        end
        set group-type firewall
        set member "AD-LDAP" "alice"
    next
end`)!;
    expect(g.form.group_type).toBe("firewall");
    expect(g.form.members).toEqual(["AD-LDAP", "alice"]);
  });

  it("parses a second group defined after one with a config match", () => {
    const cli = `
config user group
    edit "AD-VPN"
        config match
            edit 1
                set server-name "AD-LDAP"
            next
        end
        set member "AD-LDAP"
    next
    edit "Office"
        set member "alice"
    next
end`;
    const all = parseAllUserGroupsFromCLI(cli);
    expect(all.map((g) => g.target)).toEqual(["AD-VPN", "Office"]);
    expect(all[1].form.members).toEqual(["alice"]);
  });

  it("parses every group a suggestion defines", () => {
    const cli = `
config user group
    edit "G1"
        set member "alice"
    next
    edit "G2"
        set group-type rsso
        set sso-attribute-value "X"
    next
end`;
    expect(parseAllUserGroupsFromCLI(cli).map((g) => g.target)).toEqual(["G1", "G2"]);
  });

  it("returns null when there is no user group block", () => {
    expect(parseUserGroupFromCLI(`config user local\n edit "a"\n next\nend`)).toBeNull();
  });
});

describe("groupTakesMembers", () => {
  it("is true only for the types the device stores members on", () => {
    expect(groupTakesMembers("firewall")).toBe(true);
    expect(groupTakesMembers("fsso-service")).toBe(true);
    expect(groupTakesMembers("rsso")).toBe(false);
    expect(groupTakesMembers("guest")).toBe(false);
  });
});

describe("userGroupDraftToForm", () => {
  it("sends only members for a firewall group", () => {
    expect(userGroupDraftToForm({ name: "G", group_type: "firewall", members: ["alice"] }))
      .toEqual({ name: "G", group_type: "firewall", members: ["alice"] });
  });

  it("sends only the attribute for an rsso group", () => {
    expect(userGroupDraftToForm({ name: "G", group_type: "rsso", sso_attribute_value: "X" }))
      .toEqual({ name: "G", group_type: "rsso", sso_attribute_value: "X" });
  });

  it("fills the guest defaults the GUI shows", () => {
    const f = userGroupDraftToForm({ name: "G", group_type: "guest" });
    expect(f).toMatchObject({
      group_type: "guest", multiple_guest_add: false, max_accounts: 0,
      expire_type: "immediately", expire: 14400, // 4h
      user_id: "email", password: "auto-generate", sponsor: "optional", company: "optional",
    });
  });

  // Verified live: batch mode makes the device force/reset the whole Guest Details block while
  // answering 200, so those keys must not be sent at all.
  it("omits the Guest Details under batch mode", () => {
    const f = userGroupDraftToForm({
      name: "G", group_type: "guest", multiple_guest_add: true,
      user_id: "specify", password: "specify", sponsor: "mandatory",
    });
    expect(f.multiple_guest_add).toBe(true);
    expect(f.user_id).toBeUndefined();
    expect(f.password).toBeUndefined();
    expect(f.sponsor).toBeUndefined();
    // These still apply under batch.
    expect(f.expire).toBe(14400);
    expect(f.max_accounts).toBe(0);
  });
});

// ─── User Definition ───────────────────────────────────────────────────────────
describe("parseUserDefinitionFromCLI", () => {
  it("parses a plain local user", () => {
    const u = parseUserDefinitionFromCLI(`
config user local
    edit "alice"
        set type password
        set passwd "S3cret@2024!"
        set status enable
    next
end`)!;
    expect(u.target).toBe("alice");
    expect(u.form).toMatchObject({
      name: "alice", type: "password", password: "S3cret@2024!", status: true, two_factor: "disable",
    });
  });

  it("parses FortiToken 2FA with its serial", () => {
    const u = parseUserDefinitionFromCLI(`
config user local
    edit "bob"
        set type password
        set passwd "x"
        set two-factor fortitoken
        set fortitoken "FTKMOB0B0269CB84"
        set email-to "bob@corp.com"
    next
end`)!;
    expect(u.form).toMatchObject({
      two_factor: "fortitoken", fortitoken: "FTKMOB0B0269CB84", email_to: "bob@corp.com",
    });
  });

  it("splits the sms-phone the device stores", () => {
    const u = parseUserDefinitionFromCLI(`
config user local
    edit "carol"
        set type password
        set passwd "x"
        set two-factor fortitoken
        set sms-phone "+66-812345678"
    next
end`)!;
    expect(u.form).toMatchObject({ sms_enabled: true, sms_country_code: "+66", sms_phone: "812345678" });
  });

  it("reads a disabled account", () => {
    const u = parseUserDefinitionFromCLI(`
config user local
    edit "dave"
        set type password
        set passwd "x"
        set status disable
    next
end`)!;
    expect(u.form.status).toBe(false);
  });

  it("defaults status to enable when unspecified, like the device", () => {
    const u = parseUserDefinitionFromCLI(`
config user local
    edit "eve"
        set passwd "x"
    next
end`)!;
    expect(u.form.status).toBe(true);
  });

  // Only Local User is supported — a remote user needs a server object this app doesn't build.
  it("returns null for a remote user type", () => {
    expect(parseUserDefinitionFromCLI(`
config user local
    edit "radiususer"
        set type radius
        set radius-server "RADIUS-Srv"
    next
end`)).toBeNull();
  });

  it("parses every user a suggestion defines", () => {
    const cli = `
config user local
    edit "u1"
        set type password
        set passwd "a"
    next
    edit "u2"
        set type password
        set passwd "b"
    next
end`;
    expect(parseAllUserDefinitionsFromCLI(cli).map((u) => u.target)).toEqual(["u1", "u2"]);
  });
});

// A model that won't invent a password writes a placeholder instead — and the user applies the CLI
// verbatim, so "<UNKNOWN>" would become the account's real password. Observed live before the
// prompt was fixed; the parser drops it either way.
describe("placeholder passwords", () => {
  it("recognises the placeholders a model actually writes", () => {
    for (const p of ["<UNKNOWN>", "<password>", "<your-password-here>", "changeme", "PLACEHOLDER", "xxxx"]) {
      expect(isPlaceholderPassword(p)).toBe(true);
    }
  });

  it("does not flag a real password", () => {
    for (const p of ["S3cret@2024!", "Somchai@Secure2024!", "aB3$xyz9"]) {
      expect(isPlaceholderPassword(p)).toBe(false);
    }
  });

  it("drops a placeholder rather than sending it to the device", () => {
    const u = parseUserDefinitionFromCLI(`
config user local
    edit "wichai"
        set type password
        set passwd "<UNKNOWN>"
        set status enable
    next
end`)!;
    expect(u.form.password).toBeUndefined();
    // …and it never reaches the create payload, so the backend rejects it with a clear message
    // instead of silently creating an account whose password is the word "<UNKNOWN>".
    expect(userDefinitionDraftToForm(u.form).password).toBeUndefined();
  });

  it("keeps a real generated password", () => {
    const u = parseUserDefinitionFromCLI(`
config user local
    edit "somchai"
        set type password
        set passwd "Somchai@Secure2024!"
    next
end`)!;
    expect(userDefinitionDraftToForm(u.form).password).toBe("Somchai@Secure2024!");
  });
});

describe("splitSMSPhone", () => {
  it("splits the dial code from the number", () => {
    expect(splitSMSPhone("+66-812345678")).toEqual({ code: "+66", phone: "812345678" });
  });
  it("handles a number with no dial code", () => {
    expect(splitSMSPhone("812345678")).toEqual({ code: "", phone: "812345678" });
  });
  it("handles an empty value", () => {
    expect(splitSMSPhone("")).toEqual({ code: "", phone: "" });
  });
});

describe("userDefinitionDraftToForm", () => {
  it("drops the contact fields when 2FA is off", () => {
    const f = userDefinitionDraftToForm({
      name: "a", type: "password", two_factor: "disable", status: true,
      fortitoken: "FTK1", email_to: "a@b.com", sms_enabled: true, sms_phone: "812345678",
    });
    expect(f.fortitoken).toBeUndefined();
    expect(f.email_to).toBeUndefined();
    expect(f.sms_enabled).toBeUndefined();
  });

  it("never sends a token for FortiToken Cloud", () => {
    const f = userDefinitionDraftToForm({
      name: "a", type: "password", two_factor: "fortitoken-cloud", status: true,
      fortitoken: "FTK1", email_to: "a@b.com",
    });
    expect(f.fortitoken).toBeUndefined();
    expect(f.email_to).toBe("a@b.com");
  });

  // Membership is a group field — the user side must never claim to set it.
  it("always sends an empty group list", () => {
    expect(userDefinitionDraftToForm({ name: "a", type: "password", two_factor: "disable", status: true }).groups)
      .toEqual([]);
  });
});

// ─── Apply surface ─────────────────────────────────────────────────────────────
describe("canApplyViaREST", () => {
  it("accepts the three new sections", () => {
    expect(canApplyViaREST(FF_CLI)).toBe(true);
    expect(canApplyViaREST(`config user local\n    edit "a"\n        set passwd "x"\n    next\nend`)).toBe(true);
    expect(canApplyViaREST(`config user group\n    edit "G"\n        set member "a"\n    next\nend`)).toBe(true);
  });

  it("accepts a policy that pulls in a file filter and a group", () => {
    const cli = `${FF_CLI}
config user local
    edit "alice"
        set passwd "x"
    next
end
config user group
    edit "Office"
        set member "alice"
    next
end
config firewall policy
    edit 0
        set name "P"
    next
end`;
    expect(canApplyViaREST(cli)).toBe(true);
  });

  // Still conservative: one section without a REST endpoint sends the whole thing down the SSH path.
  it("still rejects a section it has no endpoint for", () => {
    expect(canApplyViaREST(`${FF_CLI}\nconfig system ha\n    set mode a-p\nend`)).toBe(false);
  });
});

// A File Filter profile is a POLICY CHILD (set file-filter-profile), like AntiVirus / Web Filter /
// App Control — so a suggestion that pairs one with a policy must surface it through the Policy
// Wizard's Related Objects, not as a separate top-level wizard. These pin the plumbing that decides
// that: the policy parser reads the attachment, and referencedByPolicy lists it as a prerequisite.
describe("file filter as a policy sub-object", () => {
  const POLICY_WITH_FF = `${FF_CLI}
config firewall policy
    edit 0
        set name "LAN-to-WAN-FF"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "LAN-Network"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "ALL"
        set nat enable
        set utm-status enable
        set file-filter-profile "FF-Block-Exec"
        set ssl-ssh-profile "certificate-inspection"
    next
end`;

  it("reads the profile the policy attaches", () => {
    const pol = parsePolicyFromCLI(POLICY_WITH_FF)!;
    expect(pol.form.fileEnabled).toBe(true);
    expect(pol.form.fileProfile).toBe("FF-Block-Exec");
  });

  it("lists it among the policy's prerequisites, so it opens as a Related Object", () => {
    const pol = parsePolicyFromCLI(POLICY_WITH_FF)!;
    expect(referencedByPolicy(pol.form).profiles).toContain("FF-Block-Exec");
  });

  it("names the same profile the file-filter block defines — the two sides must match", () => {
    const pol = parsePolicyFromCLI(POLICY_WITH_FF)!;
    const ff = parseFileFilterFromCLI(POLICY_WITH_FF)!;
    expect(pol.form.fileProfile).toBe(ff.form.name);
  });

  it("does not claim a file filter when the policy attaches none", () => {
    const pol = parsePolicyFromCLI(`
config firewall policy
    edit 0
        set name "Plain"
        set srcintf "lan"
        set dstintf "port1"
    next
end`)!;
    expect(pol.form.fileEnabled).toBeUndefined();
    expect(referencedByPolicy(pol.form).profiles).not.toContain("FF-Block-Exec");
  });
});

describe("extractPrereqBlocks", () => {
  it("pulls the file-filter profile out as its own deployable block", () => {
    const blocks = extractPrereqBlocks(FF_CLI);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("file-filter");
    expect(blocks[0].name).toBe("FF-Block-Exec");
    // The extracted block must be parseable on its own — that's how Apply creates it.
    const reparsed = parseFileFilterFromCLI(blocks[0].cli)!;
    expect(reparsed.form.rules).toHaveLength(2);
  });
});

// ─── User group: the `config match` sub-block (Remote Groups) ──────────────────
// Traps this pins, all verified live on FortiOS 7.2.10:
//   · a match whose server is not also a MEMBER → -518, the whole group is discarded
//   · match is Firewall-only (guest/rsso silently store nothing)
describe("parseUserGroupFromCLI — config match", () => {
  const MATCH_CLI = `
config user group
    edit "AD-VPN-Users"
        set group-type firewall
        set member "AD-Corp"
        config match
            edit 1
                set server-name "AD-Corp"
                set group-name "CN=VPN-Users,OU=Groups,DC=corp,DC=local"
            next
        end
    next
end`;

  it("parses a remote group row", () => {
    const f = parseUserGroupFromCLI(MATCH_CLI)!.form;
    expect(f.matches).toEqual([
      { server_name: "AD-Corp", group_name: "CN=VPN-Users,OU=Groups,DC=corp,DC=local" },
    ]);
    // The sub-block must not leak into the group's own fields.
    expect(f.name).toBe("AD-VPN-Users");
    expect(f.members).toEqual(["AD-Corp"]);
  });

  it("parses several rows", () => {
    const f = parseUserGroupFromCLI(`
config user group
    edit "G"
        set member "AD-Corp" "NPS"
        config match
            edit 1
                set server-name "AD-Corp"
                set group-name "CN=A,DC=corp"
            next
            edit 2
                set server-name "NPS"
                set group-name "CN=B,DC=corp"
            next
        end
    next
end`)!.form;
    expect(f.matches).toEqual([
      { server_name: "AD-Corp", group_name: "CN=A,DC=corp" },
      { server_name: "NPS", group_name: "CN=B,DC=corp" },
    ]);
  });

  it("keeps a DN containing spaces", () => {
    const f = parseUserGroupFromCLI(`
config user group
    edit "G"
        set member "AD-Corp"
        config match
            edit 1
                set server-name "AD-Corp"
                set group-name "CN=VPN Users,OU=Head Office,DC=corp"
            next
        end
    next
end`)!.form;
    expect(f.matches?.[0].group_name).toBe("CN=VPN Users,OU=Head Office,DC=corp");
  });

  it("drops a half-filled row rather than shipping a -3", () => {
    const f = parseUserGroupFromCLI(`
config user group
    edit "G"
        set member "AD-Corp"
        config match
            edit 1
                set server-name "AD-Corp"
            next
            edit 2
                set group-name "CN=Orphan,DC=corp"
            next
        end
    next
end`)!.form;
    expect(f.matches).toBeUndefined();
  });

  it("ignores match on a group type that cannot store it", () => {
    const f = parseUserGroupFromCLI(`
config user group
    edit "Guests"
        set group-type guest
        config match
            edit 1
                set server-name "AD-Corp"
                set group-name "CN=A,DC=corp"
            next
        end
    next
end`)!.form;
    expect(f.matches).toBeUndefined();
  });

  it("leaves a group with no match block untouched", () => {
    const f = parseUserGroupFromCLI(`
config user group
    edit "Office"
        set group-type firewall
        set member "alice"
    next
end`)!.form;
    expect(f.matches).toBeUndefined();
    expect(f.members).toEqual(["alice"]);
  });

  // ⚠️ -518: a match server that is not a member discards the WHOLE group, so the draft the user
  // reviews adds it — and so does the backend.
  it("adds every match server to the member list", () => {
    const out = userGroupDraftToForm(parseUserGroupFromCLI(`
config user group
    edit "G"
        set member "alice"
        config match
            edit 1
                set server-name "AD-Corp"
                set group-name "CN=A,DC=corp"
            next
        end
    next
end`)!.form);
    expect(out.members).toEqual(["alice", "AD-Corp"]);
    expect(out.matches).toEqual([{ server_name: "AD-Corp", group_name: "CN=A,DC=corp" }]);
  });

  it("does not duplicate a server already listed as a member", () => {
    const out = userGroupDraftToForm({
      name: "G", group_type: "firewall", members: ["AD-Corp"],
      matches: [{ server_name: "AD-Corp", group_name: "CN=A,DC=corp" }],
    });
    expect(out.members).toEqual(["AD-Corp"]);
  });
});
