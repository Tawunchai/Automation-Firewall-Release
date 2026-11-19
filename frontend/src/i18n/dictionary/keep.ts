/**
 * Strings that render the same in all three languages, on purpose.
 *
 * Every entry here is a claim: "the right thing to show a Thai or Chinese operator is the English."
 * That claim is only true for a few kinds of string, and the reason is always the same — the word
 * on screen has to match a word somewhere else that nobody can translate:
 *
 *   - PROTOCOL, ALGORITHM AND CLI TOKENS (TCP, ICMP, ESP, 3des) and the CMDB paths beside the AI
 *     Assistant's proposals (`firewall address`, `router static`, `system sdwan`). An operator
 *     comparing this console against `show firewall policy` has to match them character for
 *     character, and the CMDB paths are literally where the object is written.
 *   - HARDWARE LABELS (WAN1, DMZ, HA, LAN) — printed on the front of the FortiGate. Translating the
 *     screen would make it disagree with the box on the rack.
 *   - COLUMN BADGES (AV, APP, WEB, FQ, GE, RNG …) — two- and three-letter codes in the narrow
 *     columns of the policy and address tables. They are FortiOS's abbreviations, and there is no
 *     two-character Thai or Chinese that means the same thing.
 *   - PRODUCT AND VENDOR NAMES (FortiGate, FortiGuard, Fortinet, Google, LINE).
 *   - UNITS AND SYMBOLS (MB, Gbps, RTT, ⌘K) and NETWORKING ACRONYMS that are read as acronyms in
 *     all three languages (VPN, NAT, SA, BGP, LDAP, RADIUS, SAML).
 *   - SAMPLE VALUES AND PLACEHOLDERS (cn=admin,dc=example,dc=com, your@gmail.com, XXXX-XXXX) —
 *     literal strings a person copies, not sentences.
 *   - A handful of strings the extractor cannot tell from prose: a CSS custom property, a Tailwind
 *     class list, a debug log line, a sentence fragment the JSX splits mid-word.
 *
 * ../dictionary.test.ts checks both directions: an entry here must still be a string the app can
 * render (no stale claims), and anything the app renders must be here or translated (no gaps).
 */

export const keepAsIs: readonly string[] = [
  // -- Protocols, algorithms, transport ------------------------------------
  "TCP", "UDP", "ICMP", "ICMPv6", "SCTP", "ESP", "GRE", "SSH", "Telnet",
  "FTP", "IMAP", "POP3", "SMTP", "CIFS", "HTTP", "DNS", "SSL", "IPS",
  "HTTPS", "SNMP", "NNTP", "TELNET",
  "IPv4", "V6", "3des", "7z", "port 22", "port 23",

  // Log destinations and wire formats on the Log Settings page. Syslog and FortiAnalyzer are a
  // protocol and a product; CSV/CEF/RFC 5424 are the format names an operator matches against
  // whatever is parsing the logs at the other end.
  "Syslog", "FortiAnalyzer", "CSV", "CEF", "RFC 5424",

  // Syslog transport modes and the two FortiOS setting names beside them. `reliable` and
  // `legacy-reliable` are CLI values, `facility` is the syslog term every language uses, and
  // `override` is the HA field an operator matches against `show system ha`.
  "Reliable (TCP)", "Legacy reliable", "Facility", "Override",

  // The policy matrix's worst level, and the NAT suffix on a topology path. Both are the same
  // string in all three languages: "any" is the CLI value a rule actually holds, and NAT is read
  // as an acronym everywhere.
  "any / any / any", "· NAT",

  // Bandwidth units and shaper priorities: CLI values an operator matches against
  // `show firewall shaper traffic-shaper`, plus the two acronyms every language reads as acronyms.

  // -- The four firewall/ippool types ---------------------------------------
  // CLI values, not descriptions: an operator comparing this page against
  // `show firewall ippool` has to match them character for character, and the FortiGate GUI
  // shows the same four words in every language it ships.
  "Overload", "One-to-One", "Fixed Port Range", "Port Block Allocation",

  // -- Networking acronyms, read as acronyms in all three languages ---------
  "VPN", "SD-WAN", "NAT", "DNAT", "SLA #", "BGP", "L2TP", "IKEv",
  "Mode Config", "Autokey Keep Alive", "FQDN", "URL", "FSSO", "SDN Connector",
  "LDAP", "RADIUS", "TACACS+", "SAML", "NAS IP", "Distinguished Name",
  "Common Name Identifier", "ClearPass SPT", "Exchange", "Ping", "IP",
  "PG-13", "ID",
  // The RADIUS authentication methods and the LDAP transport, as the FortiGate's own dropdowns
  // spell them. An operator picking one here has to match it against `set auth-type`.
  "PAP", "CHAP", "MS-CHAP", "MS-CHAP-v2", "LDAPS", "STARTTLS",
  // Sign-on products, named after the product. "FSSO" alone is above; these are the full labels
  // FortiOS puts in its user-type list.
  "Fortinet Single Sign-On (FSSO)", "RADIUS Single Sign-On (RSSO)", "FortiToken Cloud",
  // Interface and address types that are read as their acronym in all three languages.
  "VLAN", "VXLAN", "EMAC VLAN", "WiFi SSID", "DHCP", "IPv6",
  // A predefined FortiOS service, and the service group's own name for "no restriction".
  "ANY",

  // -- Column badges: the narrow-column codes of the policy and address tables
  "AV", "APP", "WEB", "FILE", "AI", "AL", "IC", "TC", "DY", "FQ", "GE", "IF",
  "MC", "RNG", "WC",

  // -- Units and symbols -----------------------------------------------------
  "KB", "MB", "GB", "TB", "PB", "Mbps", "Gbps", "Tbps", "CPU",
  "0 B",

  // -- Hardware labels on the faceplate, and the sample site name ------------
  "WAN1", "WAN2", "DMZ", "HA", "LAN", "HQ",

  // -- Product and vendor names ----------------------------------------------
  "FortiGate", "FortiGate !", "FortiGate-80E", "FortiToken",
  "FortiClient", "Cisco",
  "FortiExplorer", "FortiGuard", "FortiGate Cloud",
  "Firewall Automation", "FortiOS CLI", "LINE", "AutoWall",

  // -- CMDB paths and CLI, shown as labels beside what they write ------------
  "firewall address",
  "firewall policy",
  "firewall vip",
  "firewall service custom",
  "firewall schedule recurring",
  "firewall schedule onetime",
  "firewall schedule group",
  "firewall.schedule recurring",
  "firewall.schedule onetime",
  "firewall.schedule group",
  "router static",
  // The `config <path>` line shown above an AI proposal, which is the command it will run.
  "config firewall address",
  "config firewall policy",
  "config firewall service custom",
  "config dnsfilter profile",
  "config dnsfilter domain-filter",
  "system sdwan",
  "user local",
  "user ldap",
  "user radius",
  "antivirus profile",
  "webfilter profile",
  "webfilter urlfilter",
  "dnsfilter profile",
  "dnsfilter domain-filter",
  "file-filter profile",
  "get system status",
  "show config firewall service custom",
  "monitor/virtual-wan/members status",
  "cd worker && python worker.py",
  'config firewall address edit "LAN-Net" set subnet 10.0.1.0 255.255.255.0 next end',
  "BACKEND_URL",
  "REDIS_URL",

  // -- Sample values and placeholders someone copies verbatim ----------------
  // The example object names in the Address Group, IP Pool and Zone forms. They are names an
  // operator types, in a namespace that is ASCII on the device, so a translated placeholder would
  // suggest a name FortiOS would not take.
  "branch-nat", "inside",
  "username@server.domain.com",
  "admin@network.local",
  "your@gmail.com",
  "XXXX-XXXX",
  "0XXXXXXXXX",
  "cn=admin,dc=example,dc=com",
  "dc=example,dc=com",
  "CN=VPN-Users,OU=Groups,DC=corp,DC=local",
  "e.g. 1.1.1.1",
  "e.g. www.office.com",
  "noc@example.com",
  "U0123456789abcdef0123456789abcdef",

  // -- Interpolated labels that are all acronym and value -------------------
  "AS {} · {}",
  "DNAT {} → {}",
  "DNAT {}:{} → {}:{} ({})",
  "IP/{}",
  "SDN {}",

  // -- CLI values and identifiers that appear as JSX text --------------------
  // The relaxed lowercase rule in scripts/i18n-extract.mjs lets a bare word between two tags
  // through, which is what finds "route" and "policy" — and also finds these, which are values
  // read back from the device or written into its config.
  "seq", "ttl",
  "router-id", "virtual-wan-link",
  "self-authenticated", "example.com", "branch.example.com",

  // -- Halves of a word or a sentence that JSX splits ------------------------
  // Each of these is rendered beside an expression, so neither piece is a phrase anything could
  // translate on its own: `categor{n === 1 ? "y" : "ies"}`, and prose broken by an inline <b>.
  "categor", "it.", "one.", "seconds.",
  "and", "from", "of", "or", "to", "this", "with",

  // -- Truncated column labels (Create / Read / Update in the Change Ledger) -
  "C…", "R…", "U…",

  // -- A word the JSX splits in half, so neither half is a sentence ----------
  "Firewall polic",

  // -- CLI the Local Traffic page prints for someone to paste ---------------
  // The empty-log diagnosis ends in the exact commands that switch local-in logging on. They are
  // rendered inside <pre>, which the JSX runtime already leaves alone, but they are harvested from
  // the array that builds them and so have to be claimed here too. A translated `set` is a command
  // that does not exist — this is the CLI-token rule, applied to whole lines.
  "config log setting",
  "set local-in-allow enable",
  "set local-in-deny-unicast enable",
  "set local-traffic enable",

  // FortiOS's own word for an address it declines to geolocate — it appears on every row of a
  // Local Traffic log on a private network. The page drops it rather than showing it (see
  // pages/logs/format.ts), so what is kept here is the TOKEN it compares against, not a label.
  "Reserved",

  // -- Not prose at all: CSS custom properties, class lists, debug output.
  // Listed rather than filtered out of the extractor, so the inventory stays a
  // complete record of every string the app can put on screen.
  // The focus trap's list of things that can hold focus (components/ui/Modal). A CSS selector,
  // passed to querySelectorAll and never rendered — translating it would break the trap.
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])",
  "match.{}.group",
  "match.{}.server",
  "loader-trickle {} linear forwards",
  // -- Troubleshooting: the CLI of a suggested policy, and service names --
  "edit 0",
  "set action accept",
  "set nat enable",
  "set schedule \"always\"",
  "<incoming interface>",
  "<outgoing interface>",
  "<a service for {}>",
  "NTP",
  "RDP",
  "SNAT",

  // -- SSL/SSH inspection and IPS: protocol and version names, FortiOS tokens --
  // The inspected protocols and TLS versions as FortiOS lists them, the CLI tokens an operator
  // types (`gui-proxy-inspection`, the `no-inspection` profile, the flow-based mode), the GUI paths
  // they follow on the FortiGate itself, and the sample values of the CVE and regex fields.
  "FTPS", "IMAPS", "POP3S", "SMTPS", "DNS over TLS",
  "SSL 3.0", "TLS 1.0", "TLS 1.1", "TLS 1.2", "TLS 1.3",
  "OS", "flow-based", "gui-proxy-inspection", "no-inspection",
  "System > Certificates", "System > Feature Visibility",
  "CVE-2014-*", "CVE-2021-44228, CVE-2014-*",
  ".*\\\\.bank\\\\.co\\\\.th",

  // -- AI Assistant simulation: not prose ---------------------------------------------
  // SVG path data (the shield and globe glyphs) and the querySelector strings the packet walk
  // animates by, harvested from the constants that hold them; and the policy-field labels the walk
  // prints as `srcintf lan ≠ port1`, which name the CLI attribute.
  "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  "M 1.6 12 H 22.4", "M 3.4 16.6 H 20.6", "M 3.4 7.4 H 20.6",
  "[data-ann=\"{}\"]", "[data-drop=\"{}\"]", "[data-halo=\"{}\"]",
  "[data-name=\"{}\"]", "[data-ov-drop=\"{}\"]",
  "[data-ov-wire=\"{}\"]",
  "[data-row=\"{}\"]", "[data-rowink=\"{}\"]", "[data-stripe=\"{}\"]",
  "[data-walkstep][data-owner=\"{}\"]",
  "srcintf {} ≠ {}", "dstintf {} ≠ {}",

  // -- Audit: the standard's own name, the CLI label, the AI marker, a debug line ------
  "ISO/IEC 27001", "FORTIOS CLI", "(AI)", "[{}] crashed",

  // -- Units, which are never translated (see the house rules in th/common.ts) -------
  // formatBitsPerSecond's zero case. "bps" is a unit and stays English like MB and GB; the
  // string appears whole because the formatter builds it rather than assembling it from parts.
  "0 bps",

  // -- Tile labels, version tokens and a column badge ------------------------------
  // WAN and IPsec label two tiles on the topology stage; each is a Tile label prop rather than
  // part of a sentence, which is why they arrive as their own strings. WAN is printed on the
  // front of the FortiGate and IPsec is the protocol name, so both fall under the hardware-label
  // and acronym rules above. AS prefixes an autonomous-system number on a traceroute hop.
  "WAN", "IPsec", "AS",
  // SNMP protocol versions, as FortiOS and every NMS print them. An operator matching this screen
  // against their monitoring tool has to see the same characters.
  "SNMP v1/v2c", "SNMP v3", "SNMP v1/v2c Community",
  // IKE versions. Both ends of a tunnel print these, and a tunnel that will not come up is
  // debugged by comparing the two sides - the same rule th/vpn.ts applies to phase 1 and phase 2.
  "IKEv1", "IKEv2",
  // REF heads the reference-count column on Interfaces, beside the existing AV/APP/WEB badges.
  "REF",
  // The sidebar wordmark is AutoWall, split into two spans so each half takes its own colour.
  // Render-time translation sees the halves separately, and half a product name is still one.
  "Wall",
  // Not text at all: a class list the extractor could not tell from prose. The Tailwind filter in
  // scripts/i18n-extract.mjs keys off utility-shaped tokens, and this repo own component classes
  // look nothing like those. Translating it would unstyle the panel.
  "panel panel-flush",
  // The autonomous-system prefix with its number, as traceroute prints it, and the per-hop
  // latency - a separator and a unit, with nothing in either to translate.
  "AS{}{}", "· {} ms",
];
