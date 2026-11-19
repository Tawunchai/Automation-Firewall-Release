/**
 * Thai — IPsec Tunnels, the VPN Creation Wizard, its templates, and Tunnel Health.
 *
 * IKE vocabulary is the one place this file resists translating: phase 1, phase 2, SA, DPD, PFS and
 * the Diffie-Hellman groups are what both ends of a tunnel call them, they appear in the peer's
 * logs as well as this one's, and a tunnel that will not come up is debugged by comparing the two.
 * So the surrounding sentence is Thai and those terms stay — เฟส 1 / เฟส 2 for the phases, which
 * Thai network writing does say, and the acronyms as they are.
 *
 * The template descriptions ("On-demand tunnel for users using the FortiClient software") are the
 * console's own, not FortiOS's, and are translated in full.
 */
import type { Dict } from "../merge";

export const vpn: Dict = {
  // -- Tunnel list -----------------------------------------------------------
  Tunnel: "อุโมงค์",
  TUNNEL: "อุโมงค์",
  "Create the first tunnel": "สร้างอุโมงค์แรก",
  "Edit tunnel": "แก้ไขอุโมงค์",
  "Delete tunnel": "ลบอุโมงค์",
  "Failed to create tunnel": "สร้างอุโมงค์ไม่สำเร็จ",
  "Failed to delete tunnel": "ลบอุโมงค์ไม่สำเร็จ",
  "This device has no IPsec tunnel yet": "อุปกรณ์นี้ยังไม่มีอุโมงค์ IPsec",
  "Search tunnels…": "ค้นหาอุโมงค์…",
  "Search templates…": "ค้นหาเทมเพลต…",
  "A tunnel can't be renamed — edit its settings below.":
    "ไม่สามารถเปลี่ยนชื่ออุโมงค์ได้ — ให้แก้ไขการตั้งค่าด้านล่างแทน",
  "A tunnel named": "อุโมงค์ชื่อ",
  "already exists on this device — Create will fail. Pick another name.":
    "มีอยู่บนอุปกรณ์นี้แล้ว — การสร้างจะล้มเหลว โปรดตั้งชื่ออื่น",
  "e.g. HQ-to-Branch": "เช่น HQ-to-Branch",
  DESCRIPTION: "คำอธิบาย",
  TEMPLATE: "เทมเพลต",
  WIZARD: "ตัวช่วยสร้าง",
  Actions: "การกระทำ",
  Settings: "การตั้งค่า",
  Method: "วิธีการ",
  Custom: "กำหนดเอง",
  Individual: "รายบุคคล",
  Range: "ช่วง",
  "(range": "(ช่วง",
  ", group": ", กลุ่ม",
  "in use": "ใช้งานอยู่",
  "src → dst": "ต้นทาง → ปลายทาง",
  "Advanced…": "ขั้นสูง…",

  // -- Wizard flow -----------------------------------------------------------
  "VPN Setup": "การตั้งค่า VPN",
  "Review Settings": "ตรวจทานการตั้งค่า",
  "Template type": "ชนิดเทมเพลต",
  "Object Summary": "สรุปอ็อบเจกต์",
  "Computing impact…": "กำลังคำนวณผลกระทบ…",
  "Device creation": "การสร้างบนอุปกรณ์",
  "The following settings should be reviewed prior to creating the VPN.":
    "ควรตรวจทานการตั้งค่าต่อไปนี้ก่อนสร้าง VPN",
  "Select a FortiGate above to start — the wizard reads its interfaces and routing table.":
    "เลือก FortiGate ด้านบนเพื่อเริ่ม — ตัวช่วยสร้างจะอ่านอินเทอร์เฟซและตารางเราต์ของอุปกรณ์",
  "These are FortiGate's built-in IPsec templates. Use":
    "นี่คือเทมเพลต IPsec ที่มีมากับ FortiGate ใช้",
  "to launch the IPsec Wizard, or configure a tunnel directly under":
    "เพื่อเปิดตัวช่วยสร้าง IPsec หรือจะตั้งค่าอุโมงค์โดยตรงที่",
  "IPsec Tunnels → Create New": "อุโมงค์ IPsec → สร้างใหม่",
  "This wizard builds": "ตัวช่วยสร้างนี้สร้าง",
  "tunnels. Hub-and-Spoke and Custom aren't wired up here — build those in the FortiGate GUI.":
    "อุโมงค์ ส่วน Hub-and-Spoke และแบบกำหนดเองยังไม่ได้ต่อไว้ที่นี่ — ให้สร้างใน GUI ของ FortiGate",
  "Custom form. The next steps are Network, Authentication and Phase 2.":
    "ฟอร์มแบบกำหนดเอง ขั้นถัดไปคือ เครือข่าย การยืนยันตัวตน และเฟส 2",
  "Configure phase 1 and phase 2 by hand — the full manual tunnel editor.":
    "ตั้งค่าเฟส 1 และเฟส 2 ด้วยตนเอง — ตัวแก้ไขอุโมงค์แบบเต็มรูปแบบ",
  "is the manual tunnel editor — you set phase 1 and phase 2 by hand. It creates":
    "คือตัวแก้ไขอุโมงค์แบบแมนวล — คุณตั้งค่าเฟส 1 และเฟส 2 เอง โดยจะสร้าง",
  "only the tunnel": "เฉพาะตัวอุโมงค์เท่านั้น",
  "(no address objects, policies or routes), exactly like the FortiGate GUI's":
    "(ไม่สร้างแอดเดรสอ็อบเจกต์ นโยบาย หรือเส้นทาง) เหมือนกับใน GUI ของ FortiGate ทุกประการ",

  // -- Templates -------------------------------------------------------------
  "Site to Site": "ไซต์ต่อไซต์",
  "Site to Site - FortiGate": "ไซต์ต่อไซต์ - FortiGate",
  "Site to Site - Cisco": "ไซต์ต่อไซต์ - Cisco",
  "Site to Site - FortiGate (SD-WAN)": "ไซต์ต่อไซต์ - FortiGate (SD-WAN)",
  "Site-to-Site / Custom": "ไซต์ต่อไซต์ / กำหนดเอง",
  "Dialup User": "ผู้ใช้แบบไดอัลอัป",
  "Dialup - FortiGate": "ไดอัลอัป - FortiGate",
  "Dialup - FortiClient (Windows, Mac OS, Android)":
    "ไดอัลอัป - FortiClient (Windows, macOS, Android)",
  "Dialup - iOS (Native)": "ไดอัลอัป - iOS (ไคลเอนต์ในตัว)",
  "Dialup - Android (Native L2TP/IPsec)": "ไดอัลอัป - Android (L2TP/IPsec ในตัว)",
  "Dialup - Windows (Native L2TP/IPsec)": "ไดอัลอัป - Windows (L2TP/IPsec ในตัว)",
  "Dialup - Cisco Firewall": "ไดอัลอัป - ไฟร์วอลล์ Cisco",
  "Dialup - Cisco IPsec Client": "ไดอัลอัป - ไคลเอนต์ IPsec ของ Cisco",
  "Hub-and-Spoke": "ฮับแอนด์สโป๊ก",
  "Hub-and-Spoke - FortiGate (Hub)": "ฮับแอนด์สโป๊ก - FortiGate (ฮับ)",
  "Hub-and-Spoke - FortiGate (Spoke)": "ฮับแอนด์สโป๊ก - FortiGate (สโป๊ก)",
  "Static tunnel between this FortiGate and a remote FortiGate.":
    "อุโมงค์แบบสแตติกระหว่าง FortiGate เครื่องนี้กับ FortiGate ปลายทาง",
  "Static tunnel between this FortiGate and a remote Cisco firewall.":
    "อุโมงค์แบบสแตติกระหว่าง FortiGate เครื่องนี้กับไฟร์วอลล์ Cisco ปลายทาง",
  "Static tunnel between this FortiGate using SD-WAN and a remote FortiGate.":
    "อุโมงค์แบบสแตติกระหว่าง FortiGate เครื่องนี้ที่ใช้ SD-WAN กับ FortiGate ปลายทาง",
  "On-demand tunnel between two FortiGate devices.":
    "อุโมงค์แบบเรียกใช้เมื่อต้องการระหว่างอุปกรณ์ FortiGate สองเครื่อง",
  "On-demand tunnel between a FortiGate device and a Cisco Firewall.":
    "อุโมงค์แบบเรียกใช้เมื่อต้องการระหว่างอุปกรณ์ FortiGate กับไฟร์วอลล์ Cisco",
  "On-demand tunnel for users using the FortiClient software.":
    "อุโมงค์แบบเรียกใช้เมื่อต้องการสำหรับผู้ใช้ที่ใช้ซอฟต์แวร์ FortiClient",
  "On-demand tunnel for users using the Cisco IPsec client.":
    "อุโมงค์แบบเรียกใช้เมื่อต้องการสำหรับผู้ใช้ที่ใช้ไคลเอนต์ IPsec ของ Cisco",
  "On-demand tunnel for iPhone/iPad users using the native iOS IPsec client.":
    "อุโมงค์แบบเรียกใช้เมื่อต้องการสำหรับผู้ใช้ iPhone/iPad ที่ใช้ไคลเอนต์ IPsec ในตัวของ iOS",
  "On-demand tunnel for Android users using the native L2TP/IPsec client.":
    "อุโมงค์แบบเรียกใช้เมื่อต้องการสำหรับผู้ใช้ Android ที่ใช้ไคลเอนต์ L2TP/IPsec ในตัว",
  "On-demand tunnel for Windows users using the native L2TP/IPsec client.":
    "อุโมงค์แบบเรียกใช้เมื่อต้องการสำหรับผู้ใช้ Windows ที่ใช้ไคลเอนต์ L2TP/IPsec ในตัว",
  "Hub role in a Hub-and-Spoke auto-discovery VPN configuration.":
    "บทบาทฮับในการตั้งค่า VPN แบบฮับแอนด์สโป๊กที่ค้นหาเส้นทางอัตโนมัติ",
  "Spoke role in a Hub-and-Spoke auto-discovery VPN configuration.":
    "บทบาทสโป๊กในการตั้งค่า VPN แบบฮับแอนด์สโป๊กที่ค้นหาเส้นทางอัตโนมัติ",

  // -- Network / gateway -----------------------------------------------------
  "Remote Gateway": "เกตเวย์ปลายทาง",
  "Remote Gateway Address": "แอดเดรสเกตเวย์ปลายทาง",
  "Remote Gateway Route": "เส้นทางไปยังเกตเวย์ปลายทาง",
  "Remote device": "อุปกรณ์ปลายทาง",
  "Remote device type": "ชนิดอุปกรณ์ปลายทาง",
  "Remote IP address": "IP แอดเดรสปลายทาง",
  "Remote IP/netmask": "IP/เน็ตมาสก์ ปลายทาง",
  "Remote Address": "แอดเดรสปลายทาง",
  "Remote address group": "กลุ่มแอดเดรสปลายทาง",
  "Remote Subnets": "ซับเน็ตปลายทาง",
  "Local Gateway": "เกตเวย์ต้นทาง",
  "Local Address": "แอดเดรสต้นทาง",
  "Local address group": "กลุ่มแอดเดรสต้นทาง",
  "Local subnets": "ซับเน็ตต้นทาง",
  "Local interface": "อินเทอร์เฟซต้นทาง",
  "Local subnets fills in from this interface's network.":
    "ซับเน็ตต้นทางจะเติมค่าจากเครือข่ายของอินเทอร์เฟซนี้",
  "Static IP Address": "IP แอดเดรสแบบคงที่",
  "Dynamic DNS": "ไดนามิก DNS",
  "IP Address": "IP แอดเดรส",
  "IP Version": "เวอร์ชัน IP",
  "Subnet Mask": "ซับเน็ตมาสก์",
  "Interface binding": "การผูกอินเทอร์เฟซ",
  "INTERFACE BINDING": "การผูกอินเทอร์เฟซ",
  "Tunnel interface": "อินเทอร์เฟซของอุโมงค์",
  "Tunnel Interface": "อินเทอร์เฟซของอุโมงค์",
  "Tunnel IP": "IP ของอุโมงค์",
  "Select an address…": "เลือกแอดเดรส…",
  "Select a user group…": "เลือกกลุ่มผู้ใช้…",
  "Select the interface the tunnel binds to…": "เลือกอินเทอร์เฟซที่อุโมงค์จะผูกไว้…",
  "Select the interface clients connect to…": "เลือกอินเทอร์เฟซที่ไคลเอนต์เชื่อมต่อเข้ามา…",
  "Select the LAN interface…": "เลือกอินเทอร์เฟซฝั่ง LAN…",
  "Select the WAN to share…": "เลือก WAN ที่จะแชร์…",
  "This side is behind NAT": "ฝั่งนี้อยู่หลัง NAT",
  "The remote site is behind NAT, so it has no address to dial: this becomes a":
    "ไซต์ปลายทางอยู่หลัง NAT จึงไม่มีแอดเดรสให้เรียกเข้า กรณีนี้จะกลายเป็น",
  "Exchange interface IP": "แลกเปลี่ยน IP ของอินเทอร์เฟซ",

  // -- Authentication --------------------------------------------------------
  "Pre-shared key": "คีย์ที่แชร์ไว้ล่วงหน้า",
  "Pre-shared Key": "คีย์ที่แชร์ไว้ล่วงหน้า",
  "Certificate Name": "ชื่อใบรับรอง",
  "Peer Certificate CA": "CA ของใบรับรองเพียร์",
  "Peer ID": "Peer ID",
  "Any peer ID": "Peer ID ใดก็ได้",
  "Specify a peer ID": "ระบุ Peer ID",
  "Local ID": "Local ID",
  "Group Name (peerid)": "ชื่อกลุ่ม (peerid)",
  "Require 'Group Name' on VPN client": "บังคับให้ไคลเอนต์ VPN ระบุ 'ชื่อกลุ่ม'",
  "Clients must present this name — the tunnel negotiates in aggressive mode.":
    "ไคลเอนต์ต้องแสดงชื่อนี้ — อุโมงค์จะเจรจาในโหมด aggressive",
  "Accept Types": "ชนิดที่ยอมรับ",
  "Optional — pins which CA must have signed the client's certificate.":
    "ไม่บังคับ — กำหนดว่า CA ใดต้องเป็นผู้เซ็นใบรับรองของไคลเอนต์",
  "Optional — pins which CA must have signed the peer's certificate.":
    "ไม่บังคับ — กำหนดว่า CA ใดต้องเป็นผู้เซ็นใบรับรองของเพียร์",
  "Optional — pins which CA must have signed the remote's certificate.":
    "ไม่บังคับ — กำหนดว่า CA ใดต้องเป็นผู้เซ็นใบรับรองของฝั่งปลายทาง",

  // -- Phase 1 / phase 2 -----------------------------------------------------
  "IKE Version": "เวอร์ชัน IKE",
  "Phase 1 interface": "อินเทอร์เฟซเฟส 1",
  "Phase 1 Proposal": "ข้อเสนอเฟส 1",
  "Phase 2": "เฟส 2",
  "Phase 2 interface": "อินเทอร์เฟซเฟส 2",
  "Phase 2 Proposal": "ข้อเสนอเฟส 2",
  "Phase 2 Selectors": "ตัวเลือกเฟส 2",
  "Diffie-Hellman Groups": "กลุ่ม Diffie-Hellman",
  "Key Lifetime (seconds)": "อายุคีย์ (วินาที)",
  "Enable PFS": "เปิดใช้ PFS",
  "Enable Replay Detection": "เปิดใช้การตรวจจับการเล่นซ้ำ",
  "Always Up (Keep Alive)": "เปิดตลอดเวลา (Keep Alive)",
  "Auto-negotiate": "เจรจาอัตโนมัติ",
  "Dead Peer Detection": "การตรวจจับเพียร์ที่ไม่ตอบสนอง (DPD)",
  "DPD retry count": "จำนวนครั้งที่ลองใหม่ของ DPD",
  "DPD retry interval": "ช่วงเวลาลองใหม่ของ DPD",
  "Keepalive Frequency": "ความถี่ของ Keepalive",
  "NAT Traversal": "NAT Traversal",
  "Forward Error Correction": "การแก้ไขข้อผิดพลาดล่วงหน้า (FEC)",
  "Not supported over API": "ไม่รองรับผ่าน API",

  // -- Client / mode config --------------------------------------------------
  "Client Options": "ตัวเลือกของไคลเอนต์",
  "Client Address Range": "ช่วงแอดเดรสของไคลเอนต์",
  "Enable IPv4 Split Tunnel": "เปิดใช้ Split Tunnel แบบ IPv4",
  "Split Tunnel Group": "กลุ่ม Split Tunnel",
  "Auto Connect": "เชื่อมต่ออัตโนมัติ",
  "Save Password": "บันทึกรหัสผ่าน",
  "Allow Endpoint Registration": "อนุญาตให้ลงทะเบียนอุปกรณ์ปลายทาง",
  "Endpoint Registration": "การลงทะเบียนอุปกรณ์ปลายทาง",
  "Easy configuration key": "คีย์สำหรับตั้งค่าอย่างง่าย",

  // -- L2TP ------------------------------------------------------------------
  "L2TP over IPsec": "L2TP บน IPsec",
  "L2TP server": "เซิร์ฟเวอร์ L2TP",
  "L2TP Policy": "นโยบาย L2TP",
  "L2TP Route": "เส้นทาง L2TP",
  "L2TP route:": "เส้นทาง L2TP:",
  "via l2t.root": "ผ่าน l2t.root",
  "uses the OS's built-in client:": "ใช้ไคลเอนต์ที่มากับระบบปฏิบัติการ:",
  "This device already has an": "อุปกรณ์นี้มีอยู่แล้วหนึ่งรายการคือ",
  "There is only one per device — creating this Native VPN will":
    "มีได้เพียงหนึ่งรายการต่ออุปกรณ์ — การสร้าง Native VPN นี้จะ",
  "disabled (last Native VPN)": "ถูกปิดใช้งาน (Native VPN ล่าสุด)",
  "L2TP server exists per device, so a second Android/Windows VPN replaces this one's settings.":
    "เซิร์ฟเวอร์ L2TP มีได้หนึ่งรายการต่ออุปกรณ์ การสร้าง VPN สำหรับ Android/Windows อีกรายการจึงจะแทนที่การตั้งค่าของรายการนี้",
  ". The L2TP server hands out the addresses and checks the user group, so there is no split tunnel, DNS push or client options — and only":
    " เซิร์ฟเวอร์ L2TP เป็นผู้แจกแอดเดรสและตรวจสอบกลุ่มผู้ใช้ จึงไม่มี split tunnel การ push DNS หรือตัวเลือกของไคลเอนต์ — และมีเพียง",

  // -- Policy and routing ----------------------------------------------------
  "Policy & Routing": "นโยบายและการกำหนดเส้นทาง",
  "Local to remote policies": "นโยบายจากต้นทางไปปลายทาง",
  "Remote to local policies": "นโยบายจากปลายทางมาต้นทาง",
  "Internet Access": "การเข้าถึงอินเทอร์เน็ต",
  "Internet access policy": "นโยบายการเข้าถึงอินเทอร์เน็ต",
  Internet: "อินเทอร์เน็ต",
  "Shared WAN": "WAN ที่แชร์",
  "NAT configuration": "การตั้งค่า NAT",
  "Add route": "เพิ่มเส้นทาง",
  "Static route": "เส้นทางแบบสแตติก",
  "BGP route": "เส้นทาง BGP",
  "Blackhole route": "เส้นทางแบบ blackhole",
  "Routing protocol": "โปรโตคอลการกำหนดเส้นทาง",
  "as the routing protocol.": "เป็นโปรโตคอลการกำหนดเส้นทาง",
  "Looking up the route…": "กำลังค้นหาเส้นทาง…",
  "None — the tunnel carries only the subnets above. Share Local — the remote site reaches the Internet through this site's WAN. Use Remote — this site reaches the Internet through the remote site.":
    "ไม่มี — อุโมงค์รับส่งเฉพาะซับเน็ตด้านบนเท่านั้น · แชร์ฝั่งนี้ — ไซต์ปลายทางออกอินเทอร์เน็ตผ่าน WAN ของไซต์นี้ · ใช้ฝั่งปลายทาง — ไซต์นี้ออกอินเทอร์เน็ตผ่านไซต์ปลายทาง",
  "Once the default route points into the tunnel, the tunnel's own packets would loop back into it. This gateway keeps a host route to the remote gateway on the physical link.":
    "เมื่อเส้นทางเริ่มต้นชี้เข้าไปในอุโมงค์แล้ว แพ็กเก็ตของตัวอุโมงค์เองจะวนกลับเข้าไปในอุโมงค์ เกตเวย์นี้จึงคงเส้นทางแบบโฮสต์ไปยังเกตเวย์ปลายทางไว้บนลิงก์กายภาพ",
  "Just the tunnel (phase1/phase2) — no dependent objects found.":
    "สร้างเฉพาะอุโมงค์ (เฟส 1/เฟส 2) — ไม่พบอ็อบเจกต์ที่เกี่ยวข้อง",
  "and everything created with it will be permanently removed from":
    "และทุกสิ่งที่ถูกสร้างขึ้นมาพร้อมกันจะถูกลบอย่างถาวรจาก",
  "object(s). Policies on this tunnel are removed automatically; anything else still pointing at it will be reported and left in place.":
    "อ็อบเจกต์ นโยบายบนอุโมงค์นี้จะถูกลบอัตโนมัติ ส่วนสิ่งอื่นที่ยังชี้มาที่อุโมงค์นี้จะถูกรายงานและคงไว้ตามเดิม",

  // -- Hub and spoke ---------------------------------------------------------
  "BGP (auto-discovery)": "BGP (ค้นหาอัตโนมัติ)",
  "Auto discovery sender": "ผู้ส่งการค้นหาอัตโนมัติ",
  "Auto discovery receiver": "ผู้รับการค้นหาอัตโนมัติ",
  "Local AS": "Local AS",
  "Hub gateway (public IP)": "เกตเวย์ของฮับ (IP สาธารณะ)",
  "Spoke type": "ชนิดของสโป๊ก",
  "Spoke range prefix": "พรีฟิกซ์ช่วงของสโป๊ก",
  "Spoke tunnel IPs": "IP อุโมงค์ของสโป๊ก",
  "Aggregate member": "สมาชิกของ aggregate",
  "The Hub-and-Spoke VPN will be set up using":
    "VPN แบบฮับแอนด์สโป๊กนี้จะถูกตั้งค่าโดยใช้",
  "The hub FortiGate's public address this spoke dials.":
    "แอดเดรสสาธารณะของ FortiGate ฝั่งฮับที่สโป๊กนี้เรียกเข้า",
  "The private BGP AS both ends share.": "หมายเลข BGP AS ส่วนตัวที่ทั้งสองฝั่งใช้ร่วมกัน",
  "The overlay subnet the hub accepts dynamic BGP peers from.":
    "ซับเน็ตโอเวอร์เลย์ที่ฮับยอมรับเพียร์ BGP แบบไดนามิกเข้ามา",
  "This device's address on the tunnel overlay.":
    "แอดเดรสของอุปกรณ์นี้บนโอเวอร์เลย์ของอุโมงค์",
  "Each spoke's tunnel IP — one BGP neighbor per entry.":
    "IP อุโมงค์ของแต่ละสโป๊ก — หนึ่งรายการต่อหนึ่ง BGP neighbor",
  "tunnel and the remote FortiGate connects to": "อุโมงค์ และ FortiGate ปลายทางเชื่อมต่อไปยัง",

  // -- Tunnel Health ---------------------------------------------------------
  "VPN Tunnel Health": "สุขภาพอุโมงค์ VPN",
  "Pick a device to see its tunnel status": "เลือกอุปกรณ์เพื่อดูสถานะอุโมงค์",
  "Reading the IPsec status from the device…": "กำลังอ่านสถานะ IPsec จากอุปกรณ์…",
  Up: "ทำงาน",
  Down: "ไม่ทำงาน",
  "Partly up": "ทำงานบางส่วน",
  "Bring down": "สั่งให้หยุดทำงาน",
  "Reset counters": "รีเซ็ตตัวนับ",
  "SA left": "SA ที่เหลือ",
  "No SA at all": "ไม่มี SA เลย",
  "Every phase 2 selector has an SA": "ตัวเลือกเฟส 2 ทุกรายการมี SA",
  "Never negotiated": "ไม่เคยเจรจาเลย",
  "peers established": "เพียร์ที่สร้างการเชื่อมต่อแล้ว",
  Ingress: "ขาเข้า",
  "No selectors configured.": "ยังไม่ได้ตั้งค่าตัวเลือกใด ๆ",
  "The device lists no phase 2 selector for this tunnel in its runtime table":
    "อุปกรณ์ไม่ได้แสดงตัวเลือกเฟส 2 ของอุโมงค์นี้ในตารางขณะทำงาน",
  "No selector in the runtime table — it has never negotiated, or phase 2 was never configured":
    "ไม่มีตัวเลือกในตารางขณะทำงาน — อาจไม่เคยเจรจาเลย หรือไม่เคยตั้งค่าเฟส 2 ไว้",
  "Some selectors are still down, so part of the traffic will not pass":
    "ตัวเลือกบางรายการยังไม่ทำงาน ทราฟฟิกบางส่วนจึงจะผ่านไม่ได้",
  "Traffic using this selector drops immediately until it negotiates again":
    "ทราฟฟิกที่ใช้ตัวเลือกนี้จะถูกทิ้งทันทีจนกว่าจะเจรจากันใหม่",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Address objects": "แอดเดรสอ็อบเจกต์",
  "Firewall policies": "นโยบายไฟร์วอลล์",
  "Routes": "เส้นทาง",
  "Aggressive": "โหมด Aggressive",
  "Main": "โหมด Main",
  "Main (ID protection)": "Main (ปกป้องตัวตน)",
  "All (full tunnel)": "ทั้งหมด (full tunnel)",
  "Disabled (full tunnel)": "ปิดใช้ (full tunnel)",
  "Full tunnel — all client traffic is sent through this FortiGate.": "Full tunnel — ทราฟฟิกทั้งหมดของไคลเอ็นต์จะถูกส่งผ่าน FortiGate เครื่องนี้",
  "Android Native": "Android แบบเนทีฟ",
  "Android (Native L2TP/IPsec)": "Android (L2TP/IPsec เนทีฟ)",
  "iOS Native": "iOS แบบเนทีฟ",
  "iOS (Native)": "iOS (เนทีฟ)",
  "Windows Native": "Windows แบบเนทีฟ",
  "Windows (Native L2TP/IPsec)": "Windows (L2TP/IPsec เนทีฟ)",
  "Native": "แบบเนทีฟ",
  "Client-based": "ใช้ไคลเอ็นต์",
  "Cisco Client": "ไคลเอ็นต์ Cisco",
  "Cisco IPsec Client": "ไคลเอ็นต์ Cisco IPsec",
  "FortiClient (Windows, Mac OS, Android)": "FortiClient (Windows, Mac OS, Android)",
  "A remote behind NAT has no address to dial — the tunnel becomes dialup and waits for it to connect.": "ปลายทางที่อยู่หลัง NAT ไม่มีแอดเดรสให้เรียกเข้า — อุโมงค์จะกลายเป็นแบบ dialup และรอให้ฝั่งนั้นเชื่อมต่อเข้ามา",
  "Could not read the tunnel status": "อ่านสถานะอุโมงค์ไม่สำเร็จ",
  "Counters reset": "รีเซ็ตตัวนับแล้ว",
  "Creating…": "กำลังสร้าง…",
  "Custom — created by the VPN Creation Wizard": "กำหนดเอง — สร้างโดยตัวช่วยสร้าง VPN",
  "Custom IPsec tunnel": "อุโมงค์ IPsec แบบกำหนดเอง",
  "Custom (manual editor)": "กำหนดเอง (แก้ไขด้วยตนเอง)",
  "Dialup": "แบบ Dialup",
  "Dialup — the remote connects in": "Dialup — ฝั่งปลายทางเป็นผู้เชื่อมต่อเข้ามา",
  "(directly connected)": "(เชื่อมต่อโดยตรง)",
  "Edit IPsec Tunnel": "แก้ไขอุโมงค์ IPsec",
  "IPsec tunnel": "อุโมงค์ IPsec",
  "No tunnel matches your search": "ไม่มีอุโมงค์ที่ตรงกับคำค้นของคุณ",
  "Enter a valid CIDR (e.g. 192.168.1.0/24).": "กรอก CIDR ให้ถูกต้อง (เช่น 192.168.1.0/24)",
  "Enter a valid CIDR (e.g. 2001:db8::/64).": "กรอก CIDR ให้ถูกต้อง (เช่น 2001:db8::/64)",
  "Forced": "บังคับ",
  "Forces NAT-T encapsulation instead of auto-detecting it.": "บังคับใช้การห่อหุ้มแบบ NAT-T แทนการตรวจหาอัตโนมัติ",
  "Key Lifetime": "อายุของคีย์",
  "Phase 2 Key Lifetime": "อายุของคีย์ Phase 2",
  "Phase 1 DH Groups": "DH Group ของ Phase 1",
  "Phase 2 Local": "ฝั่งท้องถิ่นของ Phase 2",
  "Phase 2 Remote": "ฝั่งปลายทางของ Phase 2",
  "Phase 2 selectors": "ตัวเลือกของ Phase 2",
  "Local Port": "พอร์ตฝั่งท้องถิ่น",
  "Remote Port": "พอร์ตฝั่งปลายทาง",
  "Ports / Protocol": "พอร์ต / โปรโตคอล",
  "Primary IP": "IP หลัก",
  "Not required": "ไม่จำเป็น",
  "No NAT between sites": "ไม่มี NAT ระหว่างไซต์",
  "The remote site is behind NAT": "ไซต์ปลายทางอยู่หลัง NAT",
  "This site is behind NAT": "ไซต์นี้อยู่หลัง NAT",
  "On Demand": "เมื่อมีการร้องขอ",
  "On Idle": "เมื่อไม่มีทราฟฟิก",
  "PFS": "PFS (Perfect Forward Secrecy)",
  "Replay Detection": "ตรวจจับการเล่นซ้ำ",
  "Share Local": "ใช้ฝั่งท้องถิ่นร่วมกัน",
  "Signature": "ลายเซ็นดิจิทัล",
  "Static": "แบบคงที่",
  "The device rejected the command": "อุปกรณ์ปฏิเสธคำสั่งนี้",
  "The first spoke's tunnel IP + the overlay netmask (its mask sizes the whole overlay subnet).": "IP อุโมงค์ของ spoke ตัวแรก + เน็ตมาสก์ของ overlay (เน็ตมาสก์นี้กำหนดขนาดซับเน็ต overlay ทั้งหมด)",
  "The hub's tunnel IP + the overlay netmask.": "IP อุโมงค์ของ hub + เน็ตมาสก์ของ overlay",
  "The local networks clients may reach (the policy's destination).": "เครือข่ายท้องถิ่นที่ไคลเอ็นต์เข้าถึงได้ (ปลายทางของนโยบาย)",
  "The local networks clients reach over the VPN (the split-tunnel group).": "เครือข่ายท้องถิ่นที่ไคลเอ็นต์เข้าถึงผ่าน VPN (กลุ่ม split tunnel)",
  "Use in Wizard": "ใช้ในตัวช่วยสร้าง",
  "Use Remote": "ใช้ค่าจากฝั่งปลายทาง",
  "Use System DNS": "ใช้ DNS ของระบบ",
  "VPN Creation Wizard": "ตัวช่วยสร้าง VPN",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Hub gateway": "เกตเวย์ของฮับ",
  "Split Tunnel": "Split Tunnel (แยกเส้นทาง)",
  "Easy configuration key is a FortiManager feature — enter the hub's gateway and tunnel settings manually below.": "Easy configuration key เป็นคุณสมบัติของ FortiManager — กรอกเกตเวย์และการตั้งค่าอุโมงค์ของฮับด้วยตนเองด้านล่าง",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Allow endpoint registration": "อนุญาตให้เอ็นด์พอยต์ลงทะเบียน",
  "Always up (keep alive)": "เปิดไว้ตลอด (keep alive)",
  "Auto connect": "เชื่อมต่ออัตโนมัติ",
  "Autokey keep alive": "คงอุโมงค์ไว้เสมอ (autokey keep alive)",
  "Availability": "ความพร้อมใช้งาน",
  "Client software": "ซอฟต์แวร์ไคลเอนต์",
  "Enable IPv4 split tunnel": "เปิดใช้ split tunnel สำหรับ IPv4",
  "Enable perfect forward secrecy": "เปิดใช้ perfect forward secrecy",
  "Enable replay detection": "เปิดใช้การตรวจจับ replay",
  "Internet access": "การออกอินเทอร์เน็ต",
  "Mode config": "โหมดคอนฟิก (mode config)",
  "Native client platform": "แพลตฟอร์มไคลเอนต์ของระบบปฏิบัติการ",
  "No samples in this window yet — history starts when the console does.": "ยังไม่มีค่าที่เก็บไว้ในช่วงเวลานี้ — ประวัติจะเริ่มนับตั้งแต่ตอนที่คอนโซลเริ่มทำงาน",
  "Pick a tunnel": "เลือกอุโมงค์",
  "Sampled every five minutes — a partial tunnel counts as half": "เก็บค่าทุกห้านาที — อุโมงค์ที่ขึ้นบางส่วนนับเป็นครึ่งหนึ่ง",
  "Save password": "บันทึกรหัสผ่าน",
  "Specify the local gateway": "ระบุเกตเวย์ฝั่งนี้",

  // -- The AI Assistant's VPN wizard: its review rows, validation and apply note ----
  // IKEv1 / IKEv2 are deliberately absent: they are the version tokens both ends print, and
  // ../keep.ts is where a string that stays English in both languages belongs.
  "A pre-shared key is required": "ต้องระบุคีย์ที่แชร์ไว้ล่วงหน้า",
  "A tunnel name is required": "ต้องระบุชื่ออุโมงค์",
  "A tunnel with this name already exists — Apply overwrites its phase 1 / phase 2.":
    "มีอุโมงค์ชื่อนี้อยู่แล้ว — การปรับใช้จะเขียนทับเฟส 1 / เฟส 2 ของอุโมงค์นั้น",
  "Apply creates everything this tunnel needs over REST. You can undo it from the chat with Fallback.":
    "การปรับใช้จะสร้างทุกอย่างที่อุโมงค์นี้ต้องใช้ผ่าน REST และย้อนคืนได้จากหน้าแชทด้วยปุ่มย้อนคืน",
  "Certificate (signature)": "ใบรับรอง (ลายเซ็นดิจิทัล)",
  "Client pool": "พูลแอดเดรสของไคลเอนต์",
  "Creates": "สร้าง",
  "Delete IPsec tunnel": "ลบอุโมงค์ IPsec",
  "Dialup (clients connect in)": "Dialup (ไคลเอนต์เชื่อมต่อเข้ามา)",
  "Dialup (dynamic peer)": "Dialup (เพียร์แบบไดนามิก)",
  "Disabled (all traffic)": "ปิดใช้ (ทราฟฟิกทั้งหมด)",
  "Everything created with this tunnel will be permanently removed from":
    "ทุกสิ่งที่ถูกสร้างขึ้นมาพร้อมกับอุโมงค์นี้จะถูกลบอย่างถาวรจาก",
  "Hide the key": "ซ่อนคีย์",
  "Hub-and-Spoke (ADVPN + BGP)": "ฮับแอนด์สโป๊ก (ADVPN + BGP)",
  "IKE version": "เวอร์ชัน IKE",
  "NAT traversal": "NAT Traversal",
  "Names the device already has are reused, not duplicated.":
    "ชื่อที่มีอยู่บนอุปกรณ์แล้วจะถูกนำกลับมาใช้ ไม่ได้สร้างซ้ำ",
  "Networks": "เครือข่าย",
  "Only admins can apply": "เฉพาะผู้ดูแลระบบเท่านั้นที่ปรับใช้ได้",
  "Peer CA": "CA ของเพียร์",
  "Remote gateway": "เกตเวย์ปลายทาง",
  "Remote subnets": "ซับเน็ตปลายทาง",
  "Remote tunnel IP": "IP อุโมงค์ฝั่งปลายทาง",
  "Reviewed from the AI's proposal": "ตรวจทานมาจากข้อเสนอของ AI",
  "Show the key": "แสดงคีย์",
  "Split destinations": "ปลายทางของ Split Tunnel",
  "Split tunnel": "Split Tunnel (แยกเส้นทาง)",
  "System DNS": "DNS ของระบบ",
  "The far end must be set to the same key.": "ฝั่งปลายทางต้องตั้งคีย์เดียวกันนี้",
  "The tunnel stays down until the far end is configured to match (PSK, proposal, selectors).":
    "อุโมงค์จะยังไม่ทำงานจนกว่าฝั่งปลายทางจะตั้งค่าให้ตรงกัน (PSK, proposal, selectors)",
  "Tunnel name": "ชื่ออุโมงค์",
  "Updates": "อัปเดต",
  "as a dialup listener with its client pool, split-tunnel group and policy":
    "เป็นตัวรอรับการเชื่อมต่อแบบ dialup พร้อมพูลแอดเดรสของไคลเอนต์ กลุ่ม split tunnel และนโยบาย",
  "shared secret": "คีย์ลับที่ใช้ร่วมกัน",
  "templates": "เทมเพลต",
  "with its phase 1 / phase 2 and the addresses, policies and routes it needs":
    "พร้อมเฟส 1 / เฟส 2 และแอดเดรส นโยบาย และเส้นทางที่จำเป็น",
  "with its tunnel interface, BGP process and policies":
    "พร้อมอินเทอร์เฟซของอุโมงค์ กระบวนการ BGP และนโยบาย",
};
