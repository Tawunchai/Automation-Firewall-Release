/**
 * Simplified Chinese — the two confirmations the Address form produces.
 *
 * The address name stays verbatim: it is the mkey on the device, and the operator will type it
 * again in a policy or look for it in `show firewall address`.
 */
import type { Dict } from "../merge";

export const addressesPatterns: Dict = {
  'Address "{}" created on {}': '已在 {2} 上创建地址“{1}”',
  'Address "{}" updated on {}': '已在 {2} 上更新地址“{1}”',
};
