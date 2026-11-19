import { describe, it, expect } from "vitest";
import {
  parseDNSFilterFromCLI, parseAllDNSFiltersFromCLI, dnsFilterDraftToForm,
} from "./parseDNSFilterCLI";
import { canApplyViaREST } from "./applyViaREST";
import { extractPrereqBlocks } from "./parsePrereqCLI";

// The CLI shape the prompt teaches the model to emit (see the DNS Filter section of ai.go), and
// which round-trips against the lab FortiGate (80E / 7.2.10).
const FULL_CLI = `config dnsfilter domain-filter
    edit 0
        set name "DNS-Block-Social"
        config entries
            edit 1
                set domain "*.facebook.com"
                set type wildcard
                set action block
                set status enable
            next
            edit 2
                set domain "facebook.com"
                set type simple
                set action block
                set status enable
            next
            edit 3
                set domain "intranet.local"
                set type simple
                set action allow
                set status enable
            next
        end
    next
end
config dnsfilter profile
    edit "DNS-Block-Social"
        set comment "Block social media at DNS"
        set block-botnet enable
        set safe-search enable
        set youtube-restrict moderate
        set log-all-domain enable
        set redirect-portal 10.0.0.9
        set external-ip-blocklist "feed1" "feed2"
        config domain-filter
            set domain-filter-table 0
        end
        config ftgd-dns
            set options error-allow
            config filters
                edit 1
                    set category 26
                    set action block
                next
                edit 2
                    set category 3
                next
            end
        end
        config dns-translation
            edit 1
                set src 10.1.1.1
                set dst 10.2.2.2
                set netmask 255.255.255.0
            next
        end
    next
end`;

describe("parseDNSFilterFromCLI", () => {
  it("returns null when the CLI has no dnsfilter profile", () => {
    expect(parseDNSFilterFromCLI(`config firewall address
    edit "LAN"
        set subnet 10.0.0.0 255.255.255.0
    next
end`)).toBeNull();
  });

  it("parses the basics", () => {
    const p = parseDNSFilterFromCLI(FULL_CLI)!;
    expect(p.target).toBe("DNS-Block-Social");
    expect(p.form.name).toBe("DNS-Block-Social");
    expect(p.form.comment).toBe("Block social media at DNS");
    expect(p.form.redirect_botnet).toBe(true);
    expect(p.form.safe_search).toBe(true);
    expect(p.form.youtube_restrict).toBe("moderate");
    expect(p.form.log_all_domains).toBe(true);
  });

  it("reads the ftgd-dns options flags", () => {
    const p = parseDNSFilterFromCLI(FULL_CLI)!;
    // "error-allow" present, "ftgd-disable" absent → filter ON, rating-error ON.
    expect(p.form.fortiguard_category_filter).toBe(true);
    expect(p.form.allow_rating_error).toBe(true);
  });

  it("treats ftgd-disable as the master toggle being off", () => {
    const p = parseDNSFilterFromCLI(`config dnsfilter profile
    edit "X"
        config ftgd-dns
            set options ftgd-disable error-allow
        end
    next
end`)!;
    expect(p.form.fortiguard_category_filter).toBe(false);
    expect(p.form.allow_rating_error).toBe(true);
  });

  // A row with no `set action` is MONITOR — that is the CMDB default, so FortiOS omits the line
  // from `show` output. Reading it as "allow" would silently un-monitor a category on the next save.
  it("reads a category row with no action as monitor, not allow", () => {
    const p = parseDNSFilterFromCLI(FULL_CLI)!;
    expect(p.form.categories).toEqual([
      { category: 26, action: "block" },
      { category: 3, action: "monitor" },
    ]);
  });

  // Defence in depth with the Go sanitizer: even if an `allow` row reaches the parser, it must
  // never become an allow row in the form — FortiOS would store that as "block".
  it("never produces an allow category row", () => {
    const p = parseDNSFilterFromCLI(`config dnsfilter profile
    edit "X"
        config ftgd-dns
            config filters
                edit 1
                    set category 1
                    set action allow
                next
            end
        end
    next
end`)!;
    expect(p.form.categories!.some((c) => c.action === "allow")).toBe(false);
  });

  it("expands a multi-id category row", () => {
    const p = parseDNSFilterFromCLI(`config dnsfilter profile
    edit "X"
        config ftgd-dns
            config filters
                edit 1
                    set category 1 2 3
                    set action block
                next
            end
        end
    next
end`)!;
    expect(p.form.categories).toEqual([
      { category: 1, action: "block" },
      { category: 2, action: "block" },
      { category: 3, action: "block" },
    ]);
  });

  it("links the Static Domain Filter table the profile references", () => {
    const p = parseDNSFilterFromCLI(FULL_CLI)!;
    expect(p.form.domain_filter).toBe(true);
    expect(p.form.domain_filter_entries).toEqual([
      { domain: "*.facebook.com", type: "wildcard", action: "block", status: "enable" },
      { domain: "facebook.com", type: "simple", action: "block", status: "enable" },
      // The domain table's own "allow" is real and must survive — it is a different table from
      // the category filter and has no trap.
      { domain: "intranet.local", type: "simple", action: "allow", status: "enable" },
    ]);
  });

  it("picks the table by id when several are defined", () => {
    const cli = `config dnsfilter domain-filter
    edit 1
        set name "A"
        config entries
            edit 1
                set domain "a.com"
                set type simple
            next
        end
    next
    edit 2
        set name "B"
        config entries
            edit 1
                set domain "b.com"
                set type simple
            next
        end
    next
end
config dnsfilter profile
    edit "X"
        config domain-filter
            set domain-filter-table 2
        end
    next
end`;
    const p = parseDNSFilterFromCLI(cli)!;
    expect(p.form.domain_filter_entries?.map((e) => e.domain)).toEqual(["b.com"]);
  });

  it("parses the redirect portal as Specify when a real IP is given", () => {
    const p = parseDNSFilterFromCLI(FULL_CLI)!;
    expect(p.form.use_default_redirect_portal).toBe(false);
    expect(p.form.redirect_portal_ip).toBe("10.0.0.9");
  });

  // 0.0.0.0 IS "Use FortiGuard Default" — importing it as a specified IP would show the user a
  // portal that isn't set.
  it("reads redirect-portal 0.0.0.0 as Use FortiGuard Default", () => {
    const p = parseDNSFilterFromCLI(`config dnsfilter profile
    edit "X"
        set redirect-portal 0.0.0.0
    next
end`)!;
    expect(p.form.use_default_redirect_portal).toBe(true);
    expect(p.form.redirect_portal_ip).toBe("");
  });

  it("parses the external IP block lists", () => {
    const p = parseDNSFilterFromCLI(FULL_CLI)!;
    expect(p.form.external_ip_blocklist).toBe(true);
    expect(p.form.external_ip_blocklist_names).toEqual(["feed1", "feed2"]);
  });

  it("parses DNS translation rows", () => {
    const p = parseDNSFilterFromCLI(FULL_CLI)!;
    expect(p.form.dns_translation).toBe(true);
    expect(p.form.dns_translation_entries).toEqual([
      { src: "10.1.1.1", dst: "10.2.2.2", netmask: "255.255.255.0", status: "enable" },
    ]);
  });

  it("skips an ipv6 dns-translation row rather than importing it blank", () => {
    const p = parseDNSFilterFromCLI(`config dnsfilter profile
    edit "X"
        config dns-translation
            edit 1
                set addr-type ipv6
                set src6 ::1
                set dst6 ::2
                set prefix 128
            next
        end
    next
end`)!;
    expect(p.form.dns_translation_entries ?? []).toEqual([]);
    expect(p.form.dns_translation).toBeUndefined();
  });

  it("survives a minimal profile", () => {
    const p = parseDNSFilterFromCLI(`config dnsfilter profile
    edit "Bare"
    next
end`)!;
    expect(p.target).toBe("Bare");
    const form = dnsFilterDraftToForm(p.form);
    expect(form.name).toBe("Bare");
    // Untouched fields fall back to the blank form's defaults.
    expect(form.fortiguard_category_filter).toBe(true);
    expect(form.use_default_redirect_portal).toBe(true);
    expect(form.domain_filter).toBe(false);
  });

  it("honours a rename (edit key is the target, set name is the new name)", () => {
    const p = parseDNSFilterFromCLI(`config dnsfilter profile
    edit "OldName"
        set name "NewName"
    next
end`)!;
    expect(p.target).toBe("OldName");
    expect(p.form.name).toBe("NewName");
  });
});

describe("dnsFilterDraftToForm", () => {
  it("fills every field so the wizard never binds undefined", () => {
    const form = dnsFilterDraftToForm({ name: "X" });
    expect(Array.isArray(form.categories)).toBe(true);
    expect(Array.isArray(form.domain_filter_entries)).toBe(true);
    expect(Array.isArray(form.dns_translation_entries)).toBe(true);
    expect(Array.isArray(form.external_ip_blocklist_names)).toBe(true);
    expect(form.youtube_restrict).toBe("strict");
  });
});

describe("parseAllDNSFiltersFromCLI", () => {
  it("parses every profile in a multi-profile answer", () => {
    const cli = `config dnsfilter profile
    edit "DNS-A"
        set comment "a"
    next
    edit "DNS-B"
        set comment "b"
        set block-botnet enable
    next
end`;
    const all = parseAllDNSFiltersFromCLI(cli);
    expect(all.map((p) => p.target)).toEqual(["DNS-A", "DNS-B"]);
    expect(all[1].form.redirect_botnet).toBe(true);
    expect(all[0].form.redirect_botnet).toBeUndefined();
  });

  // Each profile is re-parsed on its own, so the shared tables have to travel with it or the
  // domain rows would vanish for every profile.
  it("keeps each profile's domain table when re-parsing", () => {
    const cli = `config dnsfilter domain-filter
    edit 1
        set name "T1"
        config entries
            edit 1
                set domain "a.com"
                set type simple
                set action block
            next
        end
    next
end
config dnsfilter profile
    edit "DNS-A"
        config domain-filter
            set domain-filter-table 1
        end
    next
end`;
    const all = parseAllDNSFiltersFromCLI(cli);
    expect(all).toHaveLength(1);
    expect(all[0].form.domain_filter).toBe(true);
    expect(all[0].form.domain_filter_entries?.map((e) => e.domain)).toEqual(["a.com"]);
  });

  it("returns [] when there is no dnsfilter profile", () => {
    expect(parseAllDNSFiltersFromCLI("config firewall policy\n    edit 0\n    next\nend")).toEqual([]);
  });
});

// The Apply button only takes the fast REST path when EVERY section is one we can create over
// REST. DNS Filter used to force the whole suggestion down the slow SSH path.
describe("DNS Filter goes through Apply's REST fast path", () => {
  it("accepts a dnsfilter profile + its domain-filter table", () => {
    expect(canApplyViaREST(FULL_CLI)).toBe(true);
  });

  it("accepts a policy that attaches a DNS filter", () => {
    const cli = `${FULL_CLI}
config firewall policy
    edit 0
        set name "LAN-to-WAN"
        set dnsfilter-profile "DNS-Block-Social"
        set utm-status enable
    next
end`;
    expect(canApplyViaREST(cli)).toBe(true);
  });

  it("still falls back to SSH when an unsupported section rides along", () => {
    const cli = `${FULL_CLI}
config vpn ipsec phase1-interface
    edit "tun1"
        set interface "port1"
    next
end`;
    expect(canApplyViaREST(cli)).toBe(false);
  });

  // Apply auto-creates a policy's prerequisites from these blocks; a DNS filter must be one.
  it("is extracted as a policy prerequisite block", () => {
    const blocks = extractPrereqBlocks(FULL_CLI);
    const dns = blocks.find((b) => b.kind === "dnsfilter");
    expect(dns).toBeDefined();
    expect(dns!.name).toBe("DNS-Block-Social");
    // The block must be self-contained CLI the parser can read back on its own.
    expect(parseDNSFilterFromCLI(dns!.cli)?.target).toBe("DNS-Block-Social");
  });
});
