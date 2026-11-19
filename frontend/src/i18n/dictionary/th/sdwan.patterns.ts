/**
 * Thai — the interpolated sentences of SD-WAN.
 *
 * The "no X named/with id {} on this device" family are what the edit pages show when a URL points
 * at something that has since been deleted on the firewall. The identifier stays verbatim: it is
 * what the operator would paste into `show system sdwan` to check for themselves.
 */
import type { Dict } from "../merge";

export const sdwanPatterns: Dict = {
  // -- Written to the device -------------------------------------------------
  'SD-WAN zone "{}" created': 'สร้างโซน SD-WAN "{}" แล้ว',
  'SD-WAN zone "{}" updated': 'อัปเดตโซน SD-WAN "{}" แล้ว',
  'SD-WAN member "{}" created on {}': 'สร้างสมาชิก SD-WAN "{}" บน {} แล้ว',
  'SD-WAN member "{}" updated on {}': 'อัปเดตสมาชิก SD-WAN "{}" บน {} แล้ว',
  'SD-WAN rule "{}" created on {}': 'สร้างกฎ SD-WAN "{}" บน {} แล้ว',
  'SD-WAN rule "{}" updated on {}': 'อัปเดตกฎ SD-WAN "{}" บน {} แล้ว',
  'Performance SLA "{}" created on {}': 'สร้าง SLA ประสิทธิภาพ "{}" บน {} แล้ว',
  'Performance SLA "{}" updated on {}': 'อัปเดต SLA ประสิทธิภาพ "{}" บน {} แล้ว',

  // -- Titles ----------------------------------------------------------------
  "Edit SD-WAN Zone — {}": "แก้ไขโซน SD-WAN — {}",
  "Edit SD-WAN Member — {}": "แก้ไขสมาชิก SD-WAN — {}",
  "Performance SLA — {}": "SLA ประสิทธิภาพ — {}",
  "Priority Rule — {}": "กฎลำดับความสำคัญ — {}",
  "Search {}": "ค้นหา{}",

  // -- Not found on the device ----------------------------------------------
  'No SD-WAN zone named "{}" on this device': 'ไม่มีโซน SD-WAN ชื่อ "{}" บนอุปกรณ์นี้',
  'No performance SLA named "{}" on this device':
    'ไม่มี SLA ประสิทธิภาพชื่อ "{}" บนอุปกรณ์นี้',
  "No SD-WAN member with sequence number {} on this device":
    "ไม่มีสมาชิก SD-WAN ที่มีหมายเลขลำดับ {} บนอุปกรณ์นี้",
  "No SD-WAN rule with id {} on this device": "ไม่มีกฎ SD-WAN ที่มี id {} บนอุปกรณ์นี้",

  // -- Limits the firewall imposes ------------------------------------------
  "A performance SLA accepts at most {} servers":
    "SLA ประสิทธิภาพหนึ่งรายการรับเซิร์ฟเวอร์ได้ไม่เกิน {} ตัว",
  "A performance SLA name cannot contain {}": "ชื่อ SLA ประสิทธิภาพห้ามมี {}",

  // -- Readouts --------------------------------------------------------------
  "Best quality · {}": "คุณภาพดีที่สุด · {}",
  "· every {}ms": "· ทุก {} มิลลิวินาที",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Choose {}": "เลือก {}",
};
