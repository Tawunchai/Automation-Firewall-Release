/**
 * Thai — the interpolated sentences, assembled.
 *
 * Kept apart from the exact-match table because ../translate.ts uses them differently: the exact
 * table is a Map lookup, these are compiled to regexes and scanned only when that lookup misses.
 * Mixing them would put every plain string through the scan for nothing.
 */
import { buildDict, type Dict } from "./merge";

import { commonPatterns } from "./th/common.patterns";
import { devicePatterns } from "./th/device.patterns";
import { policyPatterns } from "./th/policy.patterns";
import { securityPatterns } from "./th/security.patterns";
import { vpnPatterns } from "./th/vpn.patterns";
import { sdwanPatterns } from "./th/sdwan.patterns";
import { userauthPatterns } from "./th/userauth.patterns";
import { auditPatterns } from "./th/audit.patterns";
import { diagnosticsPatterns } from "./th/diagnostics.patterns";
import { accountPatterns } from "./th/account.patterns";
import { aiPatterns } from "./th/ai.patterns";
import { addressesPatterns } from "./th/addresses.patterns";
import { logsPatterns } from "./th/logs.patterns";
import { groupsPatterns } from "./th/groups.patterns";
import { trafficShapingPatterns } from "./th/trafficShaping.patterns";
import { topologyPatterns } from "./th/topology.patterns";
import { networkPatterns } from "./th/network.patterns";
import { systemPatterns } from "./th/system.patterns";
import { changeRequestsPatterns } from "./th/changeRequests.patterns";

export const thPatterns: Dict = buildDict(
  [commonPatterns, devicePatterns, policyPatterns, securityPatterns, vpnPatterns, sdwanPatterns, userauthPatterns, auditPatterns, diagnosticsPatterns, accountPatterns, aiPatterns, addressesPatterns, logsPatterns, groupsPatterns, topologyPatterns, networkPatterns, systemPatterns, trafficShapingPatterns, changeRequestsPatterns],
  "th-patterns",
);
