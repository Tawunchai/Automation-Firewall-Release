/**
 * Simplified Chinese — the interpolated sentences, assembled.
 *
 * Kept apart from the exact-match table because ../translate.ts uses them differently: the exact
 * table is a Map lookup, these are compiled to regexes and scanned only when that lookup misses.
 * Mixing them would put every plain string through the scan for nothing.
 */
import { buildDict, type Dict } from "./merge";

import { commonPatterns } from "./zh/common.patterns";
import { devicePatterns } from "./zh/device.patterns";
import { policyPatterns } from "./zh/policy.patterns";
import { securityPatterns } from "./zh/security.patterns";
import { vpnPatterns } from "./zh/vpn.patterns";
import { sdwanPatterns } from "./zh/sdwan.patterns";
import { userauthPatterns } from "./zh/userauth.patterns";
import { auditPatterns } from "./zh/audit.patterns";
import { diagnosticsPatterns } from "./zh/diagnostics.patterns";
import { accountPatterns } from "./zh/account.patterns";
import { aiPatterns } from "./zh/ai.patterns";
import { addressesPatterns } from "./zh/addresses.patterns";
import { logsPatterns } from "./zh/logs.patterns";
import { groupsPatterns } from "./zh/groups.patterns";
import { trafficShapingPatterns } from "./zh/trafficShaping.patterns";
import { topologyPatterns } from "./zh/topology.patterns";
import { networkPatterns } from "./zh/network.patterns";
import { systemPatterns } from "./zh/system.patterns";
import { changeRequestsPatterns } from "./zh/changeRequests.patterns";

export const zhPatterns: Dict = buildDict(
  [commonPatterns, devicePatterns, policyPatterns, securityPatterns, vpnPatterns, sdwanPatterns, userauthPatterns, auditPatterns, diagnosticsPatterns, accountPatterns, aiPatterns, addressesPatterns, logsPatterns, groupsPatterns, topologyPatterns, networkPatterns, systemPatterns, trafficShapingPatterns, changeRequestsPatterns],
  "zh-patterns",
);
