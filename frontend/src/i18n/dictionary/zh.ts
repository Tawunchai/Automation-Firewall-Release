/**
 * Simplified Chinese, assembled.
 *
 * The parts are split by area of the console — see ./merge.ts for why — and the two exports here
 * are what ../translate.ts and the tests consume: `zhParts` for the conflict check, `th` for the
 * lookup itself.
 */
import { buildDict, type Dict } from "./merge";

import { common } from "./zh/common";
import { device } from "./zh/device";
import { policy } from "./zh/policy";
import { addresses } from "./zh/addresses";
import { countries } from "./zh/countries";
import { security } from "./zh/security";
import { vpn } from "./zh/vpn";
import { sdwan } from "./zh/sdwan";
import { userauth } from "./zh/userauth";
import { audit } from "./zh/audit";
import { diagnostics } from "./zh/diagnostics";
import { account } from "./zh/account";
import { ai } from "./zh/ai";
import { logs } from "./zh/logs";
import { groups } from "./zh/groups";
import { trafficShaping } from "./zh/trafficShaping";
import { topology } from "./zh/topology";
import { network } from "./zh/network";
import { system } from "./zh/system";
import { snmp } from "./zh/snmp";
import { changeRequests } from "./zh/changeRequests";
import { words } from "./zh/words";

export const zhParts: readonly Dict[] = [
  common, device, policy, addresses, countries, security, vpn, sdwan, userauth, audit,
  diagnostics, account, ai, logs, groups, topology, network, system, snmp, words, trafficShaping,
  changeRequests,
];

export const zh: Dict = buildDict(zhParts, "zh");
