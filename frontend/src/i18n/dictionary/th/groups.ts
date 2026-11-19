/**
 * Thai — Address Groups, Service Groups, IP Pools, Zones, and the usage scan that guards every
 * delete in Policy & Objects.
 *
 * Two translation decisions worth writing down, because they recur across this file:
 *
 *   OBJECT TYPE NAMES stay recognisable. "Address Group" is เกตุ์…no — it is the name of a thing an
 *   operator will also see in `show firewall addrgrp` and in FortiGate's own GUI, so the Thai reads
 *   as a description of the English term rather than replacing it: "กลุ่มแอดเดรส". The same for
 *   service group, zone and IP pool. The four NAT pool TYPES (Overload, One-to-One, Fixed Port
 *   Range, Port Block Allocation) are left in English in ../keep.ts: they are CLI values.
 *
 *   THE WARNINGS KEEP THEIR EDGE. Several strings here exist because FortiOS accepts something and
 *   then silently does not do it — an empty group, an oversubscribed pool, a zone with no ports.
 *   The Thai says what will happen ("จะไม่ผ่านทราฟฟิกใด ๆ โดยไม่แจ้งอะไรเลย"), not a softened
 *   "โปรดตรวจสอบ". A hedged warning about a silent failure is a silent failure.
 */
import type { Dict } from "../merge";

export const groups: Dict = {
  // ── Page and section names ────────────────────────────────────────────────
  "Address Groups": "กลุ่มแอดเดรส",
  "Service Groups": "กลุ่มเซอร์วิส",
  "IP Pools": "IP Pool",
  "Zones": "โซน",
  "address group": "กลุ่มแอดเดรส",
  "service group": "กลุ่มเซอร์วิส",
  "IP pool": "IP pool",

  // The one-line subtitle under each page title.
  "A named set of members a policy can reference once instead of one rule per address.":
    "ชุดสมาชิกที่ตั้งชื่อไว้ ให้ policy อ้างถึงครั้งเดียว แทนการเขียนกฎแยกทีละแอดเดรส",
  "A name for several interfaces, so a policy can be written once for “inside”.":
    "ชื่อที่ใช้เรียกอินเทอร์เฟซหลายตัวรวมกัน เพื่อเขียน policy ของ “ฝั่งใน” ครั้งเดียวจบ",
  "The source addresses a policy's NAT translates to.":
    "ชุด IP ต้นทางที่ NAT ของ policy จะแปลงไปเป็น",

  // ── Table headers ─────────────────────────────────────────────────────────
  "CONTAINS": "สมาชิก",
  "FLAGS": "ธง",
  "EXTERNAL RANGE": "ช่วง IP ภายนอก",
  "ADDRESSES": "จำนวนแอดเดรส",
  "INTERFACES": "อินเทอร์เฟซ",
  "INTRA-ZONE": "ภายในโซน",
  // The same four headers as rendered in mixed case — the table stopped upper-casing them in CSS.
  "Contains": "สมาชิก",
  "Flags": "ธง",
  "External Range": "ช่วง IP ภายนอก",
  "Intra-zone": "ภายในโซน",
  "DELETE": "ลบ",

  // ── Group form ────────────────────────────────────────────────────────────
  "What this group is for": "กลุ่มนี้มีไว้ทำอะไร",
  "No members yet": "ยังไม่มีสมาชิก",
  "Search name or member…": "ค้นหาจากชื่อหรือสมาชิก…",
  "Create the first one": "สร้างอันแรก",
  "matches nothing": "ไม่แมตช์อะไรเลย",
  "An empty group matches nothing, so a policy using it would silently pass no traffic":
    "กลุ่มที่ไม่มีสมาชิกจะไม่แมตช์อะไรเลย policy ที่ใช้กลุ่มนี้จึงจะไม่ผ่านทราฟฟิกใด ๆ โดยไม่แจ้งอะไรเลย",
  "Exclude members": "ยกเว้นสมาชิก",
  "— subtract addresses from the group above": "— ตัดแอดเดรสออกจากกลุ่มด้านบน",
  "— lets a static route name this group as its destination":
    "— ให้ static route ระบุกลุ่มนี้เป็นปลายทางได้",
  "Explicit proxy group": "กลุ่มสำหรับ explicit proxy",
  "— for proxy policies, not firewall policies": "— ใช้กับ proxy policy ไม่ใช่ firewall policy",

  // ── IP pool form ──────────────────────────────────────────────────────────
  "New IP pool": "สร้าง IP pool",
  "Edit IP pool": "แก้ไข IP pool",
  "Search pools…": "ค้นหา pool…",
  "External IP — start": "IP ภายนอก — เริ่ม",
  "External IP — end": "IP ภายนอก — สิ้นสุด",
  "Internal IP — start": "IP ภายใน — เริ่ม",
  "Internal IP — end": "IP ภายใน — สิ้นสุด",
  "Block size": "ขนาดบล็อก",
  "Blocks per user": "จำนวนบล็อกต่อผู้ใช้",
  "Associated interface": "อินเทอร์เฟซที่ผูกไว้",
  "ARP reply": "ตอบ ARP",
  "Any": "ทั้งหมด",
  "— on by default on the device. With it off, nothing answers ARP for this range and the pool is unreachable unless something else does.":
    "— บนอุปกรณ์เปิดไว้เป็นค่าเริ่มต้น ถ้าปิด จะไม่มีอะไรตอบ ARP ให้ช่วงนี้ และ pool จะเข้าถึงไม่ได้ เว้นแต่มีอย่างอื่นตอบแทน",
  "Enter an external IP range to see what this pool will do.":
    "ใส่ช่วง IP ภายนอกเพื่อดูว่า pool นี้จะทำอะไร",
  "One external address shared by everything, ports rewritten. This is plain PAT — pick One-to-One or Fixed Port Range if you meant each host to get its own address.":
    "ใช้ IP ภายนอกตัวเดียวร่วมกันทั้งหมดและเขียนพอร์ตใหม่ นี่คือ PAT ธรรมดา — ถ้าตั้งใจให้แต่ละเครื่องได้ IP ของตัวเอง ให้เลือก One-to-One หรือ Fixed Port Range",

  // ── IP pool validation ────────────────────────────────────────────────────
  "External IP range needs two IPv4 addresses": "ช่วง IP ภายนอกต้องมี IPv4 สองค่า",
  "The external range ends before it starts": "ช่วง IP ภายนอกสิ้นสุดก่อนเริ่ม",
  "The internal range ends before it starts": "ช่วง IP ภายในสิ้นสุดก่อนเริ่ม",
  "Fixed Port Range needs an internal IP range as well as an external one":
    "Fixed Port Range ต้องมีช่วง IP ภายในด้วย ไม่ใช่แค่ภายนอก",
  "Block size is required": "ต้องระบุขนาดบล็อก",
  "Blocks per user is required": "ต้องระบุจำนวนบล็อกต่อผู้ใช้",
  "Name is too long — FortiOS allows 79 characters": "ชื่อยาวเกินไป — FortiOS รับได้ 79 ตัวอักษร",

  // ── Zones ─────────────────────────────────────────────────────────────────
  "New zone": "สร้างโซน",
  "Search zones or ports…": "ค้นหาโซนหรือพอร์ต…",
  "Intra-zone traffic": "ทราฟฟิกภายในโซน",
  "Deny — traffic between members still needs a policy":
    "Deny — ทราฟฟิกระหว่างสมาชิกยังต้องมี policy",
  "Allow — members can reach each other with no rule":
    "Allow — สมาชิกคุยกันเองได้โดยไม่ต้องมีกฎ",
  "No interfaces reported": "อุปกรณ์ไม่ได้รายงานอินเทอร์เฟซ",
  "no address": "ไม่มีไอพี",
  "no interfaces — matches nothing": "ไม่มีอินเทอร์เฟซ — ไม่แมตช์อะไรเลย",
  "An interface can only be in one zone, and FortiOS also refuses one that a firewall policy names directly. Ports already in another zone are greyed out here; the policy conflict only shows as the device's refusal when you save.":
    "อินเทอร์เฟซหนึ่งตัวอยู่ได้โซนเดียว และ FortiOS ยังปฏิเสธตัวที่มี firewall policy อ้างถึงตรง ๆ ด้วย พอร์ตที่อยู่ในโซนอื่นแล้วจะถูกทำเป็นสีจางตรงนี้ ส่วนกรณีที่ชนกับ policy จะเห็นเป็นคำปฏิเสธจากอุปกรณ์ตอนกดบันทึกเท่านั้น",

  // ── Clone + bulk ──────────────────────────────────────────────────────────
  "Clone": "โคลน",
  "Clone policy": "โคลน policy",
  "CLONE POLICY": "โคลน POLICY",
  "Name for the copy": "ชื่อของสำเนา",
  "Select every policy": "เลือกทุก policy",
  "Clear selection": "ล้างที่เลือก",
  "PARTLY APPLIED": "สำเร็จบางส่วน",

  // ── The usage scan ────────────────────────────────────────────────────────
  "Checking what still references it…": "กำลังตรวจว่ายังมีอะไรอ้างถึงอยู่บ้าง…",
  "Still referenced by 1 place": "ยังถูกอ้างถึงอยู่ 1 ที่",
  "Remove it from these first. FortiOS refuses the delete anyway, with an error code that names none of them.":
    "ต้องเอาออกจากที่เหล่านี้ก่อน ยังไง FortiOS ก็ปฏิเสธการลบอยู่แล้ว แต่ตอบมาเป็นรหัสที่ไม่ได้บอกว่าที่ไหนบ้าง",
  "Nothing references it. Every table was readable and the device agrees the count is zero.":
    "ไม่มีอะไรอ้างถึง อ่านตารางได้ครบทุกตาราง และอุปกรณ์ยืนยันว่าจำนวนอ้างอิงเป็นศูนย์",
  "the list could not be read": "อ่านรายการไม่ได้",
  "the interface list could not be read": "อ่านรายการอินเทอร์เฟซไม่ได้",

  "A group needs at least one member — an empty group matches nothing, so a policy that uses it would silently pass no traffic":
    "กลุ่มต้องมีสมาชิกอย่างน้อยหนึ่งรายการ — กลุ่มว่างไม่แมตช์อะไรเลย นโยบายที่ใช้กลุ่มนั้นจะไม่ปล่อยทราฟฟิกใด ๆ โดยไม่มีอะไรเตือน",
  "A zone needs at least one interface — an empty zone matches nothing, so a policy that uses it would silently pass no traffic":
    "โซนต้องมีอินเทอร์เฟซอย่างน้อยหนึ่งตัว — โซนว่างไม่แมตช์อะไรเลย นโยบายที่ใช้โซนนั้นจะไม่ปล่อยทราฟฟิกใด ๆ โดยไม่มีอะไรเตือน",
  "New Zone": "สร้างโซน",
  "Zone names are limited to 35 characters": "ชื่อโซนยาวได้ไม่เกิน 35 ตัวอักษร",
};
