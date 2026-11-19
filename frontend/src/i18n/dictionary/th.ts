/**
 * Thai, assembled.
 *
 * The parts are split by area of the console — see ./merge.ts for why — and the two exports here
 * are what ../translate.ts and the tests consume: `thParts` for the conflict check, `th` for the
 * lookup itself.
 */
import { buildDict, type Dict } from "./merge";

import { common } from "./th/common";
import { device } from "./th/device";
import { policy } from "./th/policy";
import { addresses } from "./th/addresses";
import { countries } from "./th/countries";
import { security } from "./th/security";
import { vpn } from "./th/vpn";
import { sdwan } from "./th/sdwan";
import { userauth } from "./th/userauth";
import { audit } from "./th/audit";
import { diagnostics } from "./th/diagnostics";
import { account } from "./th/account";
import { ai } from "./th/ai";
import { logs } from "./th/logs";
import { groups } from "./th/groups";
import { trafficShaping } from "./th/trafficShaping";
import { topology } from "./th/topology";
import { network } from "./th/network";
import { system } from "./th/system";
import { snmp } from "./th/snmp";
import { changeRequests } from "./th/changeRequests";
import { words } from "./th/words";

export const thParts: readonly Dict[] = [
  common, device, policy, addresses, countries, security, vpn, sdwan, userauth, audit,
  diagnostics, account, ai, logs, groups, topology, network, system, snmp, words, trafficShaping,
  changeRequests,
];

export const th: Dict = buildDict(thParts, "th");
