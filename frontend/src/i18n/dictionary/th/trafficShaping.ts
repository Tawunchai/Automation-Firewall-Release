/**
 * Thai — Policy & Objects ▸ Traffic Shaping.
 */
import type { Dict } from "../merge";

export const trafficShaping: Dict = {
  "Traffic Shaping": "จำกัดแบนด์วิดท์",
  "traffic shaper": "ตัวจำกัดแบนด์วิดท์",
  "Shapers": "ตัวจำกัดแบนด์วิดท์",
  "Shaping policies": "กฎการจำกัดแบนด์วิดท์",
  "New shaper": "สร้างตัวจำกัด",
  "Edit shaper": "แก้ไขตัวจำกัด",
  "New shaping policy": "สร้างกฎการจำกัด",
  "Unit": "หน่วย",
  "Guaranteed (floor)": "รับประกันขั้นต่ำ",
  "Maximum (ceiling)": "เพดานสูงสุด",
  "Source interface": "อินเทอร์เฟซต้นทาง",
  "Destination interface": "อินเทอร์เฟซปลายทาง",
  "Shaper — forward": "ตัวจำกัด — ขาไป",
  "Shaper — reverse": "ตัวจำกัด — ขากลับ",
  "Apply the limit per policy": "ใช้เพดานนี้แยกต่อกฎ",
  "used by nothing": "ไม่มีอะไรใช้",
  "usage unknown": "ไม่รู้ว่ามีอะไรใช้",
  "This device has no traffic shaper yet": "เครื่องนี้ยังไม่มีตัวจำกัดแบนด์วิดท์",
  "No shaping policy, so none of the shapers above are applied to anything":
    "ยังไม่มีกฎการจำกัดเลย ตัวจำกัดด้านบนจึงยังไม่ถูกเอาไปใช้กับอะไร",
  "Shapers may well be configured — this is 'unreadable', not 'none'":
    "อาจมีตัวจำกัดตั้งไว้อยู่จริง — นี่คืออ่านไม่ได้ ไม่ใช่ไม่มี",
  "Shaping policy deleted from device": "ลบกฎการจำกัดออกจากอุปกรณ์แล้ว",

  "A shaper is a limit. A shaping policy is which traffic gets it. Either is valid on its own, and a shaper with no policy shapes nothing — which is what the \"used by\" column is for.":
    "ตัวจำกัดคือเพดาน ส่วนกฎการจำกัดคือตัวบอกว่าทราฟฟิกไหนจะโดนเพดานนั้น ทั้งสองอย่างมีอยู่เดี่ยว ๆ ได้ และตัวจำกัดที่ไม่มีกฎก็ไม่ได้จำกัดอะไรเลย — คอลัมน์ \"ถูกใช้โดย\" มีไว้เพื่อบอกเรื่องนี้",
  "0 means UNLIMITED on FortiOS, which is almost never what a shaper is for.":
    "ค่า 0 บน FortiOS แปลว่าไม่จำกัด ซึ่งแทบไม่เคยเป็นสิ่งที่ตัวจำกัดมีไว้ทำ",
  "A maximum of 0 means UNLIMITED on FortiOS — set a real ceiling, or delete the shaper if no limit is what you want":
    "เพดาน 0 บน FortiOS แปลว่าไม่จำกัด — ใส่เพดานจริง หรือลบตัวจำกัดนี้ทิ้งถ้าตั้งใจจะไม่จำกัด",
  "The guaranteed bandwidth is higher than the maximum — the floor cannot be above the ceiling":
    "ค่ารับประกันขั้นต่ำสูงกว่าเพดาน — พื้นจะอยู่สูงกว่าเพดานไม่ได้",
  "Bandwidth cannot be negative": "แบนด์วิดท์ติดลบไม่ได้",
  "Shaper names are limited to 35 characters": "ชื่อตัวจำกัดยาวได้ไม่เกิน 35 ตัวอักษร",
  "Each shaping policy using this shaper gets its OWN full allowance.":
    "กฎแต่ละข้อที่ใช้ตัวจำกัดนี้จะได้โควตาเต็มของตัวเอง",
  "The allowance is SHARED: three policies using this shaper share one limit between them.":
    "โควตานี้ใช้ร่วมกัน: ถ้ามีสามกฎใช้ตัวจำกัดนี้ ทั้งสามจะแบ่งเพดานเดียวกัน",
  "each policy gets its own allowance": "แต่ละกฎได้โควตาของตัวเอง",
  "the allowance is SHARED by every policy using it": "ทุกกฎที่ใช้ตัวจำกัดนี้ใช้โควตาร่วมกัน",
  "This is the half people forget: a download limit set only in the forward direction shapes the REQUESTS, not the file coming back.":
    "นี่คือครึ่งที่คนมักลืม: ถ้าตั้งเพดานดาวน์โหลดไว้แค่ขาไป สิ่งที่ถูกจำกัดคือคำขอ ไม่ใช่ไฟล์ที่วิ่งกลับมา",
  "— none —": "— ไม่มี —",
  "— any —": "— ทั้งหมด —",

  "Loading shaper…": "กำลังโหลด shaper…",
  "No device selected — pick one from the navbar": "ยังไม่ได้เลือกอุปกรณ์ — เลือกจากแถบด้านบน",
  "Shaper list could not be read:": "อ่านรายการ shaper ไม่ได้:",
  "Shaper not found — go back to the list.": "ไม่พบ shaper นี้ — กลับไปที่รายการ",
};
