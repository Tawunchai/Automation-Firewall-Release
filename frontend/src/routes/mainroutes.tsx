import { lazy, useMemo } from "react";
import { Navigate, useRoutes, type RouteObject } from "react-router-dom";
import Loadable from "../components/load/Loadable";
import { useAuth } from "../contexts/AuthContext.logic";

// ===== Pages =====
const Dashboard      = Loadable(lazy(() => import("../pages/dashboard/index")));
const Account        = Loadable(lazy(() => import("../pages/account/index")));
const User           = Loadable(lazy(() => import("../pages/user/index")));
const Devices        = Loadable(lazy(() => import("../pages/device/index")));
const ConfigDeploy   = Loadable(lazy(() => import("../pages/config-deploy/index")));
const AiAssistant    = Loadable(lazy(() => import("../pages/ai-assistant/index")));
const AiSimulate     = Loadable(lazy(() => import("../pages/ai-assistant/simulate")));
const DiagTraceroute = Loadable(lazy(() => import("../pages/diagnostics/traceroute")));
const Troubleshooting = Loadable(lazy(() => import("../pages/diagnostics/troubleshooting")));  // was Session Monitor
const Notify         = Loadable(lazy(() => import("../pages/notify/index")));
const NotifyChannelCreate   = Loadable(lazy(() => import("../pages/notify/channel-create")));
const NotifyChannelEdit     = Loadable(lazy(() => import("../pages/notify/channel-edit")));
const NotifyRecipientCreate = Loadable(lazy(() => import("../pages/notify/recipient-create")));
const LocalTraffic   = Loadable(lazy(() => import("../pages/logs/local-traffic")));
const ChangeRequests = Loadable(lazy(() => import("../pages/change-requests/index")));
const Audit          = Loadable(lazy(() => import("../pages/audit/index")));
const RuleLifecycle  = Loadable(lazy(() => import("../pages/rule-lifecycle/index")));
const Service        = Loadable(lazy(() => import("../pages/service/index")));
const Calendar       = Loadable(lazy(() => import("../pages/calendar/index")));
const PasswordPolicy    = Loadable(lazy(() => import("../pages/password-policy/index")));
const FirewallPolicy    = Loadable(lazy(() => import("../pages/firewall-policy/index")));
const FirewallPolicyCreate = Loadable(lazy(() => import("../pages/firewall-policy/create")));
const FirewallPolicyEdit   = Loadable(lazy(() => import("../pages/firewall-policy/edit")));
const FwAddresses       = Loadable(lazy(() => import("../pages/fw-addresses/index")));
const FwServices        = Loadable(lazy(() => import("../pages/fw-services/index")));
const Schedules         = Loadable(lazy(() => import("../pages/schedules/index")));
const VirtualIPs        = Loadable(lazy(() => import("../pages/virtual-ips/index")));
const VirtualIPForm     = Loadable(lazy(() => import("../pages/virtual-ips/vip-form")));
const FwServicesCreate  = Loadable(lazy(() => import("../pages/fw-services/create")));
const FwServicesEdit    = Loadable(lazy(() => import("../pages/fw-services/edit")));
const FwAddressCreate   = Loadable(lazy(() => import("../pages/fw-addresses/create")));
const FwAddressEdit     = Loadable(lazy(() => import("../pages/fw-addresses/edit")));
const GroupsCreate      = Loadable(lazy(() => import("../pages/fw-groups/create")));
const GroupsEdit        = Loadable(lazy(() => import("../pages/fw-groups/edit")));
const IPPools           = Loadable(lazy(() => import("../pages/ip-pools/index")));
const IPPoolCreate      = Loadable(lazy(() => import("../pages/ip-pools/create")));
const IPPoolEdit        = Loadable(lazy(() => import("../pages/ip-pools/edit")));
// The config as a picture: what is connected to what, and what is permitted between them.
// Read-only and computed entirely from reads this console already makes.
const Topology          = Loadable(lazy(() => import("../pages/topology/index")));
// The biggest FortiOS surface this console could not reach: QoS.
const TrafficShaping    = Loadable(lazy(() => import("../pages/traffic-shaping/index")));
const ShaperCreate      = Loadable(lazy(() => import("../pages/traffic-shaping/shaper-create")));
const ShaperEdit        = Loadable(lazy(() => import("../pages/traffic-shaping/shaper-edit")));
const ShapingPolicyCreate = Loadable(lazy(() => import("../pages/traffic-shaping/policy-create")));
const Interfaces        = Loadable(lazy(() => import("../pages/interfaces/index")));
const InterfaceZoneCreate = Loadable(lazy(() => import("../pages/interfaces/zone-create")));
const InterfaceZoneEdit   = Loadable(lazy(() => import("../pages/interfaces/zone-edit")));
const StaticRoutes      = Loadable(lazy(() => import("../pages/static-routes/index")));
const DHCPServers       = Loadable(lazy(() => import("../pages/dhcp-servers/index")));
const DHCPServerCreate  = Loadable(lazy(() => import("../pages/dhcp-servers/create")));
const DHCPServerEdit    = Loadable(lazy(() => import("../pages/dhcp-servers/edit")));
const LogSettings       = Loadable(lazy(() => import("../pages/log-settings/index")));
const HAStatus          = Loadable(lazy(() => import("../pages/ha-status/index")));
const SNMPPage          = Loadable(lazy(() => import("../pages/snmp/index")));
const DeviceAdmins      = Loadable(lazy(() => import("../pages/device-admins/index")));
const DeviceAdminCreate = Loadable(lazy(() => import("../pages/device-admins/create")));
const DeviceAdminEdit   = Loadable(lazy(() => import("../pages/device-admins/edit")));
const StaticRouteCreate = Loadable(lazy(() => import("../pages/static-routes/create")));
const StaticRouteEdit   = Loadable(lazy(() => import("../pages/static-routes/edit")));
const IPsecTunnels      = Loadable(lazy(() => import("../pages/vpn/ipsec-tunnels")));
const IPsecWizard       = Loadable(lazy(() => import("../pages/vpn/ipsec-wizard")));
const IPsecTemplates    = Loadable(lazy(() => import("../pages/vpn/ipsec-templates")));
const ConfigDrift       = Loadable(lazy(() => import("../pages/drift/index")));
const SecurityProfiles  = Loadable(lazy(() => import("../pages/security-profiles/index")));
const AntiVirusForm     = Loadable(lazy(() => import("../pages/security-profiles/antivirus-form")));
const WebFilterForm     = Loadable(lazy(() => import("../pages/security-profiles/webfilter-form")));
const DNSFilterForm     = Loadable(lazy(() => import("../pages/security-profiles/dnsfilter-form")));
const AppControlForm    = Loadable(lazy(() => import("../pages/security-profiles/appcontrol-form")));
const FileFilterForm    = Loadable(lazy(() => import("../pages/security-profiles/file-filter-form")));
const IPSForm           = Loadable(lazy(() => import("../pages/security-profiles/ips-form")));
const SSLSSHForm        = Loadable(lazy(() => import("../pages/security-profiles/sslssh-form")));
const SDWAN             = Loadable(lazy(() => import("../pages/sdwan/index")));
const SDWANMemberForm   = Loadable(lazy(() => import("../pages/sdwan/member-form")));
const SDWANZoneForm     = Loadable(lazy(() => import("../pages/sdwan/zone-form")));
const SDWANRuleForm     = Loadable(lazy(() => import("../pages/sdwan/rule-form")));
const SDWANSLAForm      = Loadable(lazy(() => import("../pages/sdwan/sla-form")));
const WebRatingList     = Loadable(lazy(() => import("../pages/security-profiles/web-rating-overrides")));
const WebRatingForm     = Loadable(lazy(() => import("../pages/security-profiles/web-rating-form")));
const UserDefinition       = Loadable(lazy(() => import("../pages/user-auth/user-definition")));
const UserDefinitionCreate = Loadable(lazy(() => import("../pages/user-auth/user-definition-create")));
const UserDefinitionEdit   = Loadable(lazy(() => import("../pages/user-auth/user-definition-edit")));
const UserGroups        = Loadable(lazy(() => import("../pages/user-auth/user-groups")));
const UserGroupCreate   = Loadable(lazy(() => import("../pages/user-auth/user-group-create")));
const UserGroupEdit     = Loadable(lazy(() => import("../pages/user-auth/user-group-edit")));
const LDAPServers       = Loadable(lazy(() => import("../pages/user-auth/ldap-servers")));
const LDAPServerCreate  = Loadable(lazy(() => import("../pages/user-auth/ldap-server-create")));
const LDAPServerEdit    = Loadable(lazy(() => import("../pages/user-auth/ldap-server-edit")));
const RADIUSServers     = Loadable(lazy(() => import("../pages/user-auth/radius-servers")));
const RADIUSServerCreate = Loadable(lazy(() => import("../pages/user-auth/radius-server-create")));
const RADIUSServerEdit  = Loadable(lazy(() => import("../pages/user-auth/radius-server-edit")));
const MainLayout     = Loadable(lazy(() => import("../components/structure/MainLayout")));

// ===== Public Pages =====
const Authentication = Loadable(lazy(() => import("../pages/authentication/index")));
const Loader         = Loadable(lazy(() => import("../components/load/Loader")));

const publicOnlyRoutes: RouteObject[] = [];

// ── Admin routes ───────────────────────────────────────────────────────────────
const AdminRoutes = (): RouteObject[] => [
  ...publicOnlyRoutes,
  { path: "/", element: <Navigate to="/admin" replace /> },
  {
    path: "/admin",
    element: <MainLayout />,
    children: [
      { index: true,              element: <Dashboard /> },
      { path: "dashboard",        element: <Dashboard /> },
      { path: "profile",          element: <Account /> },
      { path: "user",             element: <User /> },
      { path: "devices",          element: <Devices /> },
      { path: "fw-interfaces",         element: <Interfaces /> },
      { path: "fw-interfaces/zones/create", element: <InterfaceZoneCreate /> },
      { path: "fw-interfaces/zones/edit",   element: <InterfaceZoneEdit /> },
      { path: "topology",              element: <Topology /> },
      { path: "static-routes",         element: <StaticRoutes /> },
      { path: "static-routes/create",  element: <StaticRouteCreate /> },
      { path: "static-routes/edit",    element: <StaticRouteEdit /> },
      { path: "dhcp-servers",          element: <DHCPServers /> },
      { path: "dhcp-servers/create",   element: <DHCPServerCreate /> },
      { path: "dhcp-servers/edit",     element: <DHCPServerEdit /> },
      { path: "log-settings",          element: <LogSettings /> },
      { path: "ha-status",             element: <HAStatus /> },
      { path: "snmp",                  element: <SNMPPage /> },
      // Admin-only, including the read — the list names who can administer the firewall.
      { path: "device-admins",         element: <DeviceAdmins /> },
      { path: "device-admins/create",  element: <DeviceAdminCreate /> },
      { path: "device-admins/edit",    element: <DeviceAdminEdit /> },
      { path: "ipsec-tunnels",         element: <IPsecTunnels /> },
      { path: "ipsec-wizard",          element: <IPsecWizard /> },
      { path: "ipsec-templates",       element: <IPsecTemplates /> },
      { path: "config-deploy",    element: <ConfigDeploy /> },
      // The approval queue. An admin REVIEWS here; see the user tree below for the other half —
      // the same page, with the review controls absent because the server refuses them anyway.
      { path: "change-requests",  element: <ChangeRequests /> },
      { path: "ai-assistant",     element: <AiAssistant /> },
      // The Simulate walk, at page size. It is a route rather than a full-screen overlay so it has
      // a URL, a Back button and the browser's own history; the run itself is handed over in
      // memory (ai-assistant/simulateHandoff.ts), so the page reads nothing from the firewall.
      { path: "ai-assistant/simulate", element: <AiSimulate /> },
      // Diagnostics. Troubleshooting is REST-only in its policy-trace half — the rest run an SSH
      // command on the firewall and are admin-gated on the server too.
      { path: "diagnostics/traceroute",       element: <DiagTraceroute /> },
      { path: "diagnostics/troubleshooting",  element: <Troubleshooting /> },
      // Ping is now the admin-only "Ping" tab of Troubleshooting; its old page address lands there.
      { path: "diagnostics/ping",             element: <Navigate to="/admin/diagnostics/troubleshooting?tab=ping" replace /> },
      // The page's old address (Session Monitor) still lands on it.
      { path: "diagnostics/sessions",         element: <Navigate to="/admin/diagnostics/troubleshooting" replace /> },
      { path: "audit",            element: <Audit /> },
      { path: "rule-lifecycle",   element: <RuleLifecycle /> },
      // The Change Ledger is a tab of Configuration Drift now. The old path still resolves, so a
      // bookmark or a link in an old notification lands on the same timeline.
      { path: "change-ledger",    element: <Navigate to="/admin/config-drift?show=console" replace /> },
      { path: "config-drift", element: <ConfigDrift /> },
      { path: "service",          element: <Service /> },
      { path: "calendar",         element: <Calendar /> },
      { path: "notify",           element: <Notify /> },
      { path: "notify/channels/create",   element: <NotifyChannelCreate /> },
      { path: "notify/channels/edit",     element: <NotifyChannelEdit /> },
      { path: "notify/recipients/create", element: <NotifyRecipientCreate /> },
      { path: "password-policy",  element: <PasswordPolicy /> },
      // There is no /admin/credentials any more. Device credentials are not an admin screen about
      // "the passwords we store" — they are each person's OWN firewall account, so they live on
      // that person's profile (pages/account/credentials) for admins and users alike.
      //
      // Admin tree only, for the same reason the old live-session tab was: a traffic log lists
      // internal addresses and everything each of them reached.
      { path: "logs/local-traffic", element: <LocalTraffic /> },
      { path: "firewall-policy",  element: <FirewallPolicy /> },
      { path: "firewall-policy/create", element: <FirewallPolicyCreate /> },
      { path: "firewall-policy/edit",   element: <FirewallPolicyEdit /> },
      { path: "fw-addresses",     element: <FwAddresses /> },
      { path: "fw-services",        element: <FwServices /> },
      { path: "fw-services/create",  element: <FwServicesCreate /> },
      { path: "fw-services/edit",    element: <FwServicesEdit /> },
      { path: "fw-addresses/create", element: <FwAddressCreate /> },
      { path: "fw-addresses/edit",   element: <FwAddressEdit /> },
      { path: "fw-addresses/groups/create", element: <GroupsCreate kind="address" /> },
      { path: "fw-addresses/groups/edit",   element: <GroupsEdit kind="address" /> },
      { path: "fw-services/groups/create",  element: <GroupsCreate kind="service" /> },
      { path: "fw-services/groups/edit",    element: <GroupsEdit kind="service" /> },
      { path: "ip-pools",            element: <IPPools /> },
      { path: "ip-pools/create",     element: <IPPoolCreate /> },
      { path: "ip-pools/edit",       element: <IPPoolEdit /> },
      { path: "traffic-shaping",     element: <TrafficShaping /> },
      { path: "traffic-shaping/shapers/create", element: <ShaperCreate /> },
      { path: "traffic-shaping/shapers/edit",   element: <ShaperEdit /> },
      { path: "traffic-shaping/policies/create", element: <ShapingPolicyCreate /> },
      { path: "schedules",           element: <Schedules /> },
      { path: "virtual-ips",         element: <VirtualIPs /> },
      { path: "virtual-ips/create",  element: <VirtualIPForm /> },
      { path: "virtual-ips/edit",    element: <VirtualIPForm /> },
      { path: "security-profiles/antivirus/create", element: <AntiVirusForm /> },
      { path: "security-profiles/antivirus/edit",   element: <AntiVirusForm /> },
      { path: "security-profiles/webfilter/create", element: <WebFilterForm /> },
      { path: "security-profiles/webfilter/edit",   element: <WebFilterForm /> },
      { path: "security-profiles/dnsfilter/create", element: <DNSFilterForm /> },
      { path: "security-profiles/dnsfilter/edit",   element: <DNSFilterForm /> },
      { path: "security-profiles/application-control/create", element: <AppControlForm /> },
      { path: "security-profiles/application-control/edit",   element: <AppControlForm /> },
      { path: "security-profiles/file-filter/create", element: <FileFilterForm /> },
      { path: "security-profiles/file-filter/edit",   element: <FileFilterForm /> },
      { path: "security-profiles/ips/create", element: <IPSForm /> },
      { path: "security-profiles/ips/edit",   element: <IPSForm /> },
      { path: "security-profiles/ssl-ssh-inspection/create", element: <SSLSSHForm /> },
      { path: "security-profiles/ssl-ssh-inspection/edit",   element: <SSLSSHForm /> },
      // Web Rating Overrides is not a "profile" — it is its own table (webfilter/ftgd-local-rating)
      // with URL/Category/Status columns, so it gets its own list rather than the shared one.
      // The SD-WAN create/edit forms are pages, not dialogs — each is big enough to want a URL,
      // a Back button and a reload that does not lose it.
      { path: "sdwan", element: <SDWAN /> },
      { path: "sdwan/members/create", element: <SDWANMemberForm /> },
      { path: "sdwan/members/edit",   element: <SDWANMemberForm /> },
      { path: "sdwan/zones/create",   element: <SDWANZoneForm /> },
      { path: "sdwan/zones/edit",     element: <SDWANZoneForm /> },
      { path: "sdwan/rules/create",   element: <SDWANRuleForm /> },
      { path: "sdwan/rules/edit",     element: <SDWANRuleForm /> },
      { path: "sdwan/performance-slas/create", element: <SDWANSLAForm /> },
      { path: "sdwan/performance-slas/edit",   element: <SDWANSLAForm /> },
      { path: "security-profiles/web-rating-overrides", element: <WebRatingList /> },
      { path: "security-profiles/web-rating-overrides/create", element: <WebRatingForm /> },
      { path: "security-profiles/web-rating-overrides/edit",   element: <WebRatingForm /> },
      { path: "security-profiles/:category", element: <SecurityProfiles /> },
      { path: "user-definition",        element: <UserDefinition /> },
      { path: "user-definition/create", element: <UserDefinitionCreate /> },
      { path: "user-definition/edit",   element: <UserDefinitionEdit /> },
      { path: "user-groups",         element: <UserGroups /> },
      { path: "user-groups/create",  element: <UserGroupCreate /> },
      { path: "user-groups/edit",    element: <UserGroupEdit /> },
      { path: "ldap-servers",          element: <LDAPServers /> },
      { path: "ldap-servers/create",   element: <LDAPServerCreate /> },
      { path: "ldap-servers/edit",     element: <LDAPServerEdit /> },
      { path: "radius-servers",        element: <RADIUSServers /> },
      { path: "radius-servers/create", element: <RADIUSServerCreate /> },
      { path: "radius-servers/edit",   element: <RADIUSServerEdit /> },
    ],
  },
  { path: "*", element: <Navigate to="/admin" replace /> },
];

// ── User routes ────────────────────────────────────────────────────────────────
const UserRoutes = (): RouteObject[] => [
  ...publicOnlyRoutes,
  { path: "/", element: <Navigate to="/admin" replace /> },
  {
    path: "/admin",
    element: <MainLayout />,
    children: [
      { index: true,           element: <Dashboard /> },
      { path: "dashboard",     element: <Dashboard /> },
      { path: "profile",       element: <Account /> },
      { path: "devices",       element: <Devices /> },
      { path: "fw-interfaces", element: <Interfaces /> },
      { path: "fw-interfaces/zones/create", element: <InterfaceZoneCreate /> },
      { path: "fw-interfaces/zones/edit",   element: <InterfaceZoneEdit /> },
      // Topology is five reads and a drawing. It writes nothing, so every signed-in user gets it.
      { path: "topology",      element: <Topology /> },
      { path: "static-routes", element: <StaticRoutes /> },
      // Read-open like the rest of Network: every write behind it is admin-gated in the
      // controller, and a menu entry that always 403s is worse than no entry.
      { path: "dhcp-servers",  element: <DHCPServers /> },
      // Log Settings and HA are readable by everyone; every write behind them is admin-gated in
      // the controller. Administrators is NOT here: its read is admin-only too.
      { path: "log-settings",  element: <LogSettings /> },
      { path: "ha-status",     element: <HAStatus /> },
      { path: "snmp",          element: <SNMPPage /> },
      { path: "ipsec-tunnels",   element: <IPsecTunnels /> },
      { path: "ipsec-wizard",    element: <IPsecWizard /> },
      { path: "ipsec-templates", element: <IPsecTemplates /> },
      { path: "config-deploy", element: <ConfigDeploy /> },
      // The other half of the queue, and the reason it is not admin-only: a non-admin's write to a
      // firewall policy, a virtual IP or a security profile IS a change request, so without this
      // route they would press Save, get a 202, and have no way to see what became of it — or to
      // take it back. GET /change-requests and the withdraw endpoint are open to the requester;
      // only the review is admin-gated, and the page hides those controls accordingly. It hides
      // them because a button that can only 403 is worse than no button, NOT as a permission
      // check: controller/changerequest.requireAdmin is the one that decides.
      { path: "change-requests", element: <ChangeRequests /> },
      { path: "ai-assistant",  element: <AiAssistant /> },
      // Read-only, and reachable only from a run the user already has open in the chat.
      { path: "ai-assistant/simulate", element: <AiSimulate /> },
      // Troubleshooting (was Session Monitor) is open to everyone: its policy walk is CMDB + monitor
      // reads computed on the server, with no SSH. The Ping tab IS SSH, so it is admin-gated inside the
      // page — a non-admin landing on ?tab=ping just sees the walk. Trace Route stays admin-only.
      { path: "diagnostics/troubleshooting", element: <Troubleshooting /> },
      { path: "diagnostics/sessions", element: <Navigate to="/admin/diagnostics/troubleshooting" replace /> },
      // Same reasoning: it reads runtime counters and writes nothing.
      { path: "rule-lifecycle", element: <RuleLifecycle /> },
      // Configuration Drift reads the app's own database and writes nothing a user can trigger —
      // Compare now, Acknowledge and Revert are admin-gated in the page and on the server. It was
      // missing from this list, so the sidebar entry every user sees bounced them to /admin; that
      // mattered more once the Change Ledger (which users could always read) moved inside it.
      { path: "config-drift",   element: <ConfigDrift /> },
      { path: "change-ledger",  element: <Navigate to="/admin/config-drift?show=console" replace /> },
      { path: "service",       element: <Service /> },
      { path: "calendar",      element: <Calendar /> },
      // Notify is admin-only now that it does something. It was reachable by everyone while it was
      // a placeholder; every one of its endpoints is admin-gated on the server, because a channel
      // holds a LINE bot token and a rule decides who gets woken at 3am. A route that could only
      // 403 is worse than no route.
    ],
  },
  { path: "*", element: <Navigate to="/admin" replace /> },
];

const MainRoutes = (): RouteObject[] => [
  ...publicOnlyRoutes,
  {
    path: "/",
    children: [
      { index: true, element: <Authentication /> },
      { path: "*",   element: <Authentication /> },
    ],
  },
];

// The route table for who is signed in.
//
// Built outside the component and memoised on the four booleans, for two reasons that are easy to
// conflate and are not the same:
//
//   · ONE useRoutes CALL. It used to be five, one per branch, each behind an `if` that returned
//     early — a hook called conditionally, which React's rules forbid. It happened to survive
//     because every branch called exactly one, so the hook ORDER never actually differed; that is
//     luck, not a design, and the next person to add a second hook to one branch would have found
//     out the hard way. Choosing the table first and calling the hook once removes the question.
//   · A STABLE ARRAY. AdminRoutes() rebuilds ~60 route objects and their elements on every call,
//     so an unmemoised call handed useRoutes a brand-new tree on every render of every page —
//     work react-router then has to re-match. The identity now changes only when the signed-in
//     role does, which is the only time the table can differ.
const LOADING_ROUTES: RouteObject[] = [...publicOnlyRoutes, { path: "*", element: <Loader /> }];

function ConfigRoutes() {
  const { isLoading, isAuthed, isAdmin, isUser } = useAuth();

  const routes = useMemo<RouteObject[]>(() => {
    if (isLoading) return LOADING_ROUTES;
    if (!isAuthed) return MainRoutes();
    if (isAdmin) return AdminRoutes();
    if (isUser) return UserRoutes();
    // Signed in, but with a role this console has no table for. The unauthenticated table is the
    // safe answer: it shows the sign-in screen rather than an admin sidebar nobody may use.
    return MainRoutes();
  }, [isLoading, isAuthed, isAdmin, isUser]);

  return useRoutes(routes);
}

export default ConfigRoutes;
