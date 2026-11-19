// The pure half of pool-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import type { IPPool, IPPoolPayload } from "../../api/objectGroups";
import { type PoolDraft } from "./pool-model";

export const BLANK_POOL: PoolDraft = {
  name: "", type: "overload", startIp: "", endIp: "",
  sourceStartIp: "", sourceEndIp: "", blockSize: 128, numBlocksPerUser: 8,
  arpReply: true, arpInterface: "", associatedInterface: "", permitAnyHost: false, comments: "",
};

export const poolToDraft = (p: IPPool): PoolDraft => ({
  name: p.name, type: p.type, startIp: p.start_ip, endIp: p.end_ip,
  sourceStartIp: p.source_start_ip ?? "", sourceEndIp: p.source_end_ip ?? "",
  blockSize: p.block_size || 128, numBlocksPerUser: p.num_blocks_per_user || 8,
  arpReply: p.arp_reply, arpInterface: p.arp_interface ?? "",
  associatedInterface: p.associated_interface ?? "",
  permitAnyHost: p.permit_any_host, comments: p.comments ?? "",
});

export const buildPoolPayload = (d: PoolDraft): IPPoolPayload => ({
  name: d.name.trim(), type: d.type,
  start_ip: d.startIp.trim(), end_ip: d.endIp.trim(),
  source_start_ip: d.sourceStartIp.trim(), source_end_ip: d.sourceEndIp.trim(),
  block_size: d.blockSize, num_blocks_per_user: d.numBlocksPerUser,
  arp_reply: d.arpReply, arp_interface: d.arpInterface,
  associated_interface: d.associatedInterface,
  permit_any_host: d.permitAnyHost, comments: d.comments,
});
