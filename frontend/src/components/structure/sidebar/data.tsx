import React from "react";
import {
  FiUsers, FiServer, FiShield, FiKey,
  FiUploadCloud, FiCpu, FiHardDrive,
  FiMapPin, FiZap, FiGlobe, FiWifi, FiFile, FiLock, FiShare2, FiGitBranch, FiClock,
  FiServer as FiServer2, FiGitMerge, FiActivity, FiClipboard,
  FiTrendingDown, FiFileText, FiGrid, FiSliders, FiUserCheck, FiLayers, FiPackage,
  FiTool, FiRadio, FiCornerDownRight, FiList, FiBarChart2, FiBell, FiTag, FiTarget, FiGitPullRequest,
  FiInbox,
} from "react-icons/fi";
import { AiOutlineUser } from "react-icons/ai";
import type { JSX } from "react/jsx-dev-runtime";
import { MdSpaceDashboard } from "react-icons/md";
import { BsCalendar3 } from "react-icons/bs";

export type SidebarLink = {
  /** Route name under /admin — also the React key. */
  name: string;
  label?: string;
  icon?: React.ReactNode;
  badge?: string;
  /**
   * Extra words the menu filter should match on. The console has ~45 pages and
   * people look for them by the FortiOS name ("policy", "phase1", "ips"), not by
   * the label we happened to pick.
   */
  keywords?: string;
};

export type SidebarSection = {
  /** Stable id — used for the collapsed/expanded memory in localStorage. */
  key: string;
  title: string;
  /** Shown in the collapsed rail, where the title has nowhere to go. */
  icon?: React.ReactNode;
  links: SidebarLink[];
};

type GetLinksParams = { isAdmin: boolean };

export const getLinks = ({ isAdmin }: GetLinksParams): SidebarSection[] => {
  const dashboardLinks: SidebarLink[] = [
    { name: "dashboard", label: "Dashboard", icon: <MdSpaceDashboard />, keywords: "status overview cpu memory sessions" },
  ];

  // Automation — the console's own machinery: the inventory it keeps, and the work it runs against
  // it. Everything here changes something or queues a job.
  //
  // The observing pages that used to sit in this section moved out, because "run this against the
  // fleet" and "tell me what the firewall is doing" are different errands and the section had grown
  // to nine entries covering both: Troubleshoot joined Diagnostics (it asks the device a question),
  // Rule Lifecycle / Audit became Analytics (they look back at what is already there), and Change
  // Ledger joined Security (it is the audit trail of who changed what).
  const automationLinks: SidebarLink[] = [
    { name: "devices",       label: "Devices",       icon: <FiHardDrive />,   keywords: "inventory fortigate backup jobs" },
    { name: "config-deploy", label: "Multi Config",  icon: <FiUploadCloud />, keywords: "push cli script worker terminal deploy" },
    { name: "ai-assistant",  label: "Wizard Config", icon: <FiCpu />,         keywords: "chat wizard generate prompt apply ai assistant" },
    // The approval queue. Here rather than in Analytics, which is where Config Drift and Rule
    // Lifecycle live: those look BACK at a firewall and write nothing, while this section's errand
    // is "change something or queue a job" — and a change request is precisely a queued job that
    // becomes a write the moment somebody approves it.
    //
    // Not admin-gated, unlike Notify or Audit. Both roles need it and both roles can use it: an
    // admin reviews, and the account whose Save turned into a 202 needs to see what became of it
    // and to be able to take it back. Every endpoint behind it is open to the requester except the
    // review, which the page itself does not offer to a non-admin.
    { name: "change-requests", label: "Change Requests", icon: <FiInbox />, keywords: "approval approve reject review queue pending proposal propose request withdraw second pair of eyes change control separation of duties 202 maker checker firewall policy virtual ip security profile" },
  ];

  // FortiGate "Diagnostics" — the tools that ask the firewall a question and show its answer.
  //
  // Troubleshooting leads the section: "why can't A reach B?" is the question people arrive with.
  // It walks the policy table for one connection and shows the route, the rule that decides it, NAT,
  // inspection and the fix — animated. It was Session Monitor, with a second tab listing live
  // sessions over SSH; that tab was removed on request, so the page is now open to every signed-in
  // user (everything on it is CMDB + monitor GETs).
  //
  // Ping and Trace Route are SSH end to end with no half a non-admin could use, so they are
  // admin-gated on the server (controller/diagstream) and hidden here to match. A menu entry that
  // always 403s is worse than no entry.
  const diagnosticsLinks: SidebarLink[] = [
    { name: "diagnostics/troubleshooting",  label: "Troubleshooting",        icon: <FiList />,      keywords: "troubleshoot policy lookup trace packet match why blocked denied connection route nat reach session monitor ping icmp echo reachability latency loss live" },
    ...(isAdmin
      ? [
        { name: "diagnostics/traceroute", label: "Trace Route", icon: <FiCornerDownRight />, keywords: "hops path tracert route trace live latency asn owner geo" },
      ]
      : []),
  ];

  // Analytics — the pages that look BACK at a firewall instead of changing it.
  //
  // Both are computed from data the console already has (live hit counters, the policy table) and
  // neither writes to a device, which is what separates them from Automation above and from
  // Diagnostics, whose tools each go and ask the firewall something now.
  const analyticsLinks: SidebarLink[] = [
    // Drift leads the section. It is the only page here that can tell you something happened that
    // nobody in this console did, and that is the finding people most need put in front of them.
    // It also carries the Change Ledger, as a tab, so the ledger's search words point here too.
    { name: "config-drift",   label: "Config Drift",   icon: <FiGitPullRequest />, keywords: "unauthorised change outside console cli backup compare diff who changed baseline change ledger history audit trail revert rollback analytics chart" },
    { name: "rule-lifecycle", label: "Rule Lifecycle", icon: <FiTrendingDown />, keywords: "stale hit count cleanup unused" },
    // Audit reads the whole policy table and reports what is wrong with it — admin-only, like the
    // Security Profiles it comments on.
    ...(isAdmin
      ? [
        { name: "audit", label: "Audit / Review", icon: <FiClipboard />, keywords: "shadow unused review findings standards pci iso nist control evidence" },
      ]
      : []),
  ];

  // FortiGate "Network" section — mirrors the device's own Network menu.
  const networkLinks: SidebarLink[] = [
    // Topology leads the section: it is the only entry that answers "what does this firewall look
    // like" rather than "what is in this table", and it is where people start when they do not yet
    // know which table they need.
    { name: "topology",       label: "Topology",      icon: <FiGitMerge />,  keywords: "map diagram picture graph segments paths connected visual overview what talks to what" },
    { name: "fw-interfaces",  label: "Interfaces",    icon: <FiShare2 />,    keywords: "port vlan lan wan physical zone zones inside outside dmz intrazone segment" },
    { name: "static-routes",  label: "Static Routes", icon: <FiGitBranch />, keywords: "routing gateway subnet blackhole" },
    { name: "dhcp-servers",   label: "DHCP Servers",  icon: <FiServer />,    keywords: "dhcp lease address pool range reservation mac scope exclude gateway dns" },
    { name: "sdwan",          label: "SD-WAN",        icon: <FiGitMerge />, keywords: "zone member rule performance sla virtual wan link load balance failover" },
  ];

  // Each group entry sits directly under the objects it groups, because that is the order the work
  // happens in: you make the addresses, then you put them in a group, then you write one rule
  // instead of six. IP Pools goes last — it is referenced from the policy form's NAT section
  // rather than from its address fields.
  const policyLinks: SidebarLink[] = [
    { name: "firewall-policy",   label: "Firewall Policy", icon: <FiShield />, keywords: "rules nat allow deny ipv4 clone duplicate bulk select" },
    { name: "fw-addresses",      label: "Addresses",       icon: <FiMapPin />, keywords: "subnet fqdn geography object addrgrp address groups exclude nested set" },
    { name: "fw-services",       label: "Services",        icon: <FiZap />,    keywords: "port tcp udp protocol custom servicegrp service groups member proxy" },
    { name: "schedules",         label: "Schedules",       icon: <FiClock />,  keywords: "recurring onetime time window" },
    { name: "virtual-ips",       label: "Virtual IPs",     icon: <FiGlobe />,  keywords: "vip dnat port forward" },
    { name: "ip-pools",          label: "IP Pools",        icon: <FiPackage />, keywords: "ippool snat source nat overload one-to-one fixed port range pba cgnat" },
    { name: "traffic-shaping",   label: "Traffic Shaping", icon: <FiActivity />, keywords: "qos bandwidth shaper limit rate throttle priority guaranteed maximum per policy dscp" },
  ];

  // FortiGate "VPN" section — IPsec management, in the device's own menu order.
  const vpnLinks: SidebarLink[] = [
    { name: "ipsec-tunnels",   label: "IPsec Tunnels",         icon: <FiLock />,     keywords: "phase1 phase2 site to site" },
    { name: "ipsec-wizard",    label: "IPsec Wizard",          icon: <FiGitMerge />, keywords: "create template hub spoke dialup" },
    { name: "ipsec-templates", label: "IPsec Tunnel Template", icon: <FiServer2 />,  keywords: "preset custom remote access" },
  ];

  // Log & Report — the section FortiOS itself calls "Log & Report", holding the pages whose errand
  // is "show me the record", not "change something" or "judge the config".
  //
  // Local Traffic is admin-only for the same reason the old live-session tab was: a traffic log
  // lists internal addresses and everything each of them reached.
  const logReportLinks: SidebarLink[] = [
    ...(isAdmin
      ? [{ name: "logs/local-traffic", label: "Local Traffic", icon: <FiFileText />, keywords: "log traffic local event syslog memory admin login vpn" }]
      : []),
    // Last, because it decides what the entry above it has to show: with implicit-deny logging off
    // there is nothing in Local Traffic to find, however well you search.
    { name: "log-settings", label: "Log Settings", icon: <FiSliders />, keywords: "logging syslog fortianalyzer memory disk implicit deny local in local out resolve retention destination" },
  ];

  // Notify is admin-only: a channel holds a LINE bot's access token, and a rule decides who is
  // woken at 3am. Every /notify endpoint is admin-gated on the server, so showing the entry to a
  // user would be a menu item that can only 403.
  const appsLinks: SidebarLink[] = [
    ...(isAdmin
      ? [{ name: "notify", label: "Notify", icon: <FiBell />, keywords: "line alert message webhook notification broadcast port down cpu peak threshold" }]
      : []),
    { name: "calendar", label: "Calendar", icon: <BsCalendar3 />, keywords: "schedule maintenance window events" },
  ];

  // Security — who may use this console.
  //
  // Change Ledger used to lead this section. It is now a tab of Config Drift (Analytics): the ledger
  // is what this console changed and drift is what changed without it, and reading one without the
  // other was half an answer. /admin/change-ledger still redirects there.
  //
  // What is left is admin-only, so the section is pushed only when it has something in it — an
  // empty heading in a user's menu would be a section that leads nowhere.
  const securityLinks: SidebarLink[] = [
    ...(isAdmin
      ? [
        { name: "user",            label: "Users",           icon: <FiUsers />,  keywords: "accounts roles admin console" },
        { name: "service",         label: "Services",        icon: <FiServer />, keywords: "email smtp settings" },
        { name: "password-policy", label: "Password Policy", icon: <FiKey />,    keywords: "complexity expiry rules" },
        // Credentials used to sit here, as an admin page about the device passwords the console
        // stores. It is gone: what people actually needed was to attach THEIR OWN firewall account
        // to a device, so that the firewall's log names them instead of one shared `admin`. That is
        // personal, not administrative, so it moved onto the profile page — reachable from the
        // identity menu by every role (see pages/account/credentials).
      ]
      : []),
  ];

  // FortiGate "System" — the unit's own configuration.
  const systemLinks: SidebarLink[] = [
    { name: "ha-status",    label: "HA Status",    icon: <FiShare2 />, keywords: "ha high availability cluster failover heartbeat primary secondary peer active passive standalone" },
    // SNMP is admin-only for the same reason Administrators is: a community string is a shared
    // password in all but name, and a v3 user carries two real ones. Hiding the menu entry matches
    // the endpoint, which refuses a non-admin write.
    ...(isAdmin
      ? [{ name: "snmp", label: "SNMP", icon: <FiRadio />, keywords: "snmp agent community v1 v2c v3 trap query oid mib poll monitor zabbix prtg nagios librenms engine-id sysinfo notify host security level auth priv" }]
      : []),
    // Administrators is admin-only: the list names who can reach the firewall and from where.
    ...(isAdmin
      ? [{ name: "device-admins", label: "Administrators", icon: <FiUserCheck />, keywords: "admin account login accprofile access profile trusted host two factor super_admin device firewall account" }]
      : []),
    // Device Identities (/admin/host-pins) used to sit here. The owner removed the page on
    // 2026-11-19 as something no user needs to look at; the PINNING ITSELF is untouched, and
    // GET/DELETE /host-pins are still served for the one case that needs them — see the comment
    // above those routes in routes_app.go.
  ];

  const sections: SidebarSection[] = [
    { key: "dashboard",   title: "Dashboard",        icon: <FiGrid />,      links: dashboardLinks },
    { key: "automation",  title: "Automation",       icon: <FiZap />,       links: automationLinks },
    { key: "diagnostics", title: "Diagnostics",      icon: <FiTool />,      links: diagnosticsLinks },
    { key: "analytics",   title: "Analytics",        icon: <FiBarChart2 />, links: analyticsLinks },
    { key: "logreport",   title: "Log & Report",     icon: <FiFileText />,  links: logReportLinks },
    { key: "network",     title: "Network",          icon: <FiShare2 />,    links: networkLinks },
    { key: "policy",      title: "Policy & Objects", icon: <FiShield />,    links: policyLinks },
    { key: "vpn",         title: "VPN",              icon: <FiLock />,      links: vpnLinks },
    // The box itself, rather than the traffic through it. HA is read-only; Administrators is
    // admin-only end to end and is added below with the other admin sections.
    { key: "system",      title: "System",           icon: <FiServer2 />,   links: systemLinks },
  ];

  if (isAdmin) {
    sections.push({
      key: "profiles",
      title: "Security Profiles",
      icon: <FiLayers />,
      links: [
        { name: "security-profiles/ips",                 label: "Intrusion Prevention", icon: <FiTarget />, keywords: "ips sensor signature exploit attack cve severity filter block reset" },
        { name: "security-profiles/antivirus",           label: "AntiVirus",           icon: <FiShield />, keywords: "av scan virus outbreak sandbox" },
        { name: "security-profiles/webfilter",           label: "Web Filter",          icon: <FiGlobe />,  keywords: "url category ftgd block" },
        { name: "security-profiles/dnsfilter",           label: "DNS Filter",          icon: <FiWifi />,   keywords: "domain botnet category" },
        { name: "security-profiles/application-control", label: "Application Control", icon: <FiCpu />,    keywords: "app signature sensor p2p" },
        { name: "security-profiles/file-filter",         label: "File Filter",         icon: <FiFile />,   keywords: "filetype extension block exe" },
        { name: "security-profiles/ssl-ssh-inspection",  label: "SSL/SSH Inspection",  icon: <FiLock />,   keywords: "deep inspection certificate tls" },
        { name: "security-profiles/web-rating-overrides", label: "Web Rating Overrides", icon: <FiTag />,   keywords: "url rating category override ftgd local rating custom" },
      ],
    });

    sections.push({
      key: "userauth",
      title: "User & Authentication",
      icon: <FiUserCheck />,
      links: [
        { name: "user-definition", label: "User Definition", icon: <AiOutlineUser />, keywords: "local user account password 2fa" },
        { name: "user-groups",     label: "User Groups",     icon: <FiUsers />,       keywords: "group firewall guest fsso" },
        { name: "ldap-servers",    label: "LDAP Servers",    icon: <FiServer2 />,     keywords: "directory ad bind dn" },
        { name: "radius-servers",  label: "RADIUS Servers",  icon: <FiKey />,         keywords: "aaa secret nas auth" },
      ],
    });
  }

  sections.push({ key: "apps", title: "Apps", icon: <FiPackage />, links: appsLinks });
  if (securityLinks.length > 0) {
    sections.push({ key: "security", title: "Security", icon: <FiSliders />, links: securityLinks });
  }

  return sections;
};

export const themeColors = [
  // Violet leads the list because it is the default accent (see DEFAULT_ACCENT
  // in ProviderContext) — the swatch you are wearing should be the first one shown.
  { name: "violet",     color: "#6F6AF8" },
  { name: "azure-blue", color: "#1A97F5" },
  { name: "cyan",       color: "#03C9D7" },
  { name: "purple",     color: "#A855F7" },
  { name: "hot-pink",   color: "#FF5C8E" },
  { name: "coral",      color: "#FB9678" },
  { name: "emerald",    color: "#10B981" },
  { name: "amber",      color: "#F59E0B" },
  { name: "vivid-red",  color: "#EF4444" },
  { name: "orange",     color: "#F97316" },
  { name: "magenta",    color: "#EC4899" },
];

export type UserProfileItem = {
  icon: JSX.Element;
  title: string;
  desc: string;
  iconColor: string;
  iconBg: string;
  link: string;
};

// ── Route → breadcrumb lookup ────────────────────────────────────────────────
// The navbar needs "Policy & Objects › Firewall Policy" for the current URL. Deriving it from the
// same list the sidebar renders means a page can never appear in one and not the other.

export type Crumb = { section: string; label: string; icon?: React.ReactNode };

/**
 * Pages that are reachable but never appear in the sidebar for the CURRENT role — the profile and
 * password screens (they live in the identity menu), plus the admin-only pages a role-filtered menu
 * has dropped. Without these the navbar would fall back to title-casing the slug.
 */
const EXTRA_CRUMBS: Record<string, Crumb> = {
  profile:  { section: "Account",   label: "My Profile",     icon: <AiOutlineUser /> },
  password: { section: "Account",   label: "Password",       icon: <FiKey /> },
  audit:    { section: "Analytics", label: "Audit / Review",  icon: <FiClipboard /> },
  service:  { section: "Security",  label: "Services",       icon: <FiServer /> },
};

/**
 * Resolves an /admin path to its breadcrumb.
 *
 * Matching is longest-first so "security-profiles/antivirus" wins over a hypothetical
 * "security-profiles", and a child route ("firewall-policy/create") still resolves to its parent
 * rather than falling through to the raw slug.
 */
export const resolveCrumb = (pathname: string, sections: SidebarSection[]): Crumb => {
  const clean = pathname.replace(/^\/+admin\/?/, "").replace(/\/+$/, "").toLowerCase();
  if (!clean) return { section: "Dashboard", label: "Dashboard", icon: <MdSpaceDashboard /> };

  const candidates: Crumb[] = [];
  for (const section of sections) {
    for (const link of section.links) {
      const name = link.name.toLowerCase();
      if (clean === name || clean.startsWith(`${name}/`)) {
        candidates.push({ section: section.title, label: link.label ?? link.name, icon: link.icon });
      }
    }
  }
  if (candidates.length > 0) {
    // Longest match wins — see doc comment.
    return candidates.sort((a, b) => b.label.length - a.label.length)[0];
  }

  const head = clean.split("/")[0];
  if (EXTRA_CRUMBS[head]) return EXTRA_CRUMBS[head];

  // Unknown route: title-case the slug rather than showing an empty bar.
  return {
    section: "Admin",
    label: head.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  };
};
