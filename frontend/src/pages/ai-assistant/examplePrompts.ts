import type { WizardBtnKind } from "./undoKinds";

// The starter chips on the empty AI Assistant screen.
//
// They are the first thing anyone sees, so they read as a menu of what this assistant can do —
// which means an example for something the app cannot actually build is worse than no example at
// all. The list used to offer "ตั้งค่า SSL VPN", "ตั้งค่า DHCP server" and "ตั้งค่า SD-WAN 2 ISP":
// the model answers all three with valid FortiOS CLI, but none of those sections had a REST
// endpoint or a wizard here (see REST_SECTIONS in applyViaREST.ts), so Apply fell back to shipping
// the whole block over SSH — no per-object review, no Fallback undo, no flow chart.
//
// SD-WAN has since gained both (parseSDWANCLI + SDWANWizard + applySDWAN), so it is back on the
// list. SSL VPN and DHCP have not, and are still absent.
//
// Every entry therefore carries the WIZARD KIND it exercises, and examplePrompts.test.ts checks
// that kind against the real wizard vocabulary. An example for a capability that does not exist
// fails the build, and a wizard with no example does too — the list cannot drift either way.
//
// ── WHY label AND prompt ─────────────────────────────────────────────────────
// Because the two want opposite things. A chip has to be SHORT to stay readable in a wrapped row;
// a prompt has to be SPECIFIC or the model answers with a question instead of config. Ran against
// the live model, "เพิ่ม address object subnet", "Port forwarding เข้า server" and "ตั้งค่า IPsec
// VPN Site-to-Site" each came back as a list of "กรุณาระบุ…" — correct behaviour (it cannot invent
// a gateway address) and a useless demo. So the chip shows the short label and sends the specific
// prompt, which the user sees in the tooltip before clicking.
//
// ⚠️ Every `prompt` below was sent to the real model against the lab FortiGate and verified to
// produce a wizard-ready, REST-applicable draft. They are FIXTURES — editing one for style means
// re-running it.

/** What an example exercises: a wizard, the VPN creation flow, or a read-only device query. */
export type ExampleKind = WizardBtnKind | "vpn" | "query";

export type ExamplePrompt = {
  /** Chip text — short. */
  label: string;
  /** What is actually sent. Omitted when the label is already specific enough to send as-is. */
  prompt?: string;
  kind: ExampleKind;
};

/** What clicking this chip sends to the model. */
export const promptOf = (p: ExamplePrompt): string => p.prompt ?? p.label;

/**
 * One example per capability, ordered the way the sidebar is: policy & objects, then security
 * profiles, then users, then VPN, and the read-only questions last.
 *
 * One each on purpose — the screen is a sample of what the assistant builds, not a catalogue.
 */
export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  // ── Policy & Objects ──
  { label: "Create a LAN → WAN policy", kind: "policy" },
  { label: "Add an address object", prompt: "Add an address object for 10.20.30.0/24", kind: "address" },
  { label: "Create a custom service", prompt: "Create a custom service on TCP 9000", kind: "service" },
  { label: "Create office-hours schedule", prompt: "Create an office-hours schedule, Mon-Fri 08:00-17:00", kind: "schedule" },
  // Yields the VIP *and* the policy that lets it in — the pair a port forward actually needs.
  { label: "Port forward to a server", prompt: "Port forward WAN 8080 → 192.168.1.50:80", kind: "virtualip" },
  { label: "Static route to a subnet", prompt: "Create a static route for 172.16.0.0/16 via 192.168.1.1", kind: "route" },

  // ── SD-WAN ──
  // Two ISPs is the shape the whole feature exists for, and it is specific enough that the model
  // emits the full set — a zone, both members, a health check and a rule — rather than asking which
  // interfaces are meant. The gateways are given for the same reason as the VPN peer above: the
  // model will not invent one, and a proposal missing them is not applicable.
  {
    label: "SD-WAN across two ISPs",
    prompt: "Set up SD-WAN over wan1 (gateway 203.0.113.254) and wan2 (gateway 203.0.114.254), "
      + "with a ping health check to 1.1.1.1 and a rule that sends all internet traffic out "
      + "whichever link is meeting the SLA",
    kind: "sdwan",
  },

  // ── Security Profiles ──
  // No parameters needed: an AntiVirus profile's defaults are the whole answer.
  { label: "Create an AntiVirus profile", kind: "antivirus" },
  { label: "Block Facebook (Web Filter)", prompt: "Block Facebook with a Web Filter", kind: "webfilter" },
  { label: "Block YouTube (DNS Filter)", prompt: "Block YouTube with a DNS Filter", kind: "dnsfilter" },
  // Named apps, not "social media": a vague chip makes the model ask WHICH apps.
  { label: "Block TikTok (App Control)", prompt: "Block TikTok and Instagram with Application Control", kind: "appcontrol" },
  { label: "Block .exe downloads", prompt: "Block .exe files downloaded from the internet", kind: "filefilter" },

  // ── User & Authentication ──
  { label: "Create a user in a group", prompt: "Create user somchai and put them in the Staff group", kind: "userdef" },
  { label: "Create a staff user group", prompt: "Create a user group for staff", kind: "usergroup" },
  // The host is given; the bind password / shared secret deliberately is NOT — the model is
  // instructed never to invent a credential, so the wizard opens with that field blank.
  { label: "Add an LDAP server (AD)", prompt: "Add LDAP server 192.168.1.10 pointing at Active Directory", kind: "ldapserver" },
  { label: "Add a RADIUS server", prompt: "Add RADIUS server 192.168.1.20", kind: "radiusserver" },

  // ── VPN. IPsec only — there is no SSL VPN page, endpoint or wizard in this app. ──
  { label: "IPsec site-to-site VPN", prompt: "Set up an IPsec site-to-site tunnel to 203.0.113.50", kind: "vpn" },
  { label: "Remote-access VPN", prompt: "Set up a VPN for staff working from home (FortiClient)", kind: "vpn" },

  // ── Read-only. These run through Fetch from Device (SSH), which can run any show/get command,
  //    so they are not limited to what the REST appliers can build. ──
  { label: "Show every policy", kind: "query" },
  { label: "Show interface status", kind: "query" },
  { label: "Check the routing table", kind: "query" },
  { label: "Check VPN tunnel status", kind: "query" },
];
