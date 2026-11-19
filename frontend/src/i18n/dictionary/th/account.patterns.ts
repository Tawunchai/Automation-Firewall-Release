/**
 * Thai — the interpolated sentences of the account and credential pages.
 */
import type { Dict } from "../merge";

export const accountPatterns: Dict = {
  "Device #{}": "อุปกรณ์ #{}",
  "File must be smaller than {} MB.": "ไฟล์ต้องมีขนาดเล็กกว่า {} MB",
  "On — OTP is used for: {}": "เปิดอยู่ — ใช้ OTP กับ: {}",
  "These flows stop working immediately: {}": "ขั้นตอนเหล่านี้จะหยุดทำงานทันที: {}",
  "System is under maintenance — you will be signed out in {}s.":
    "ระบบอยู่ระหว่างการบำรุงรักษา — คุณจะถูกออกจากระบบในอีก {} วินาที",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "{} minute ago": "{} นาทีที่แล้ว",
  "{} minutes ago": "{} นาทีที่แล้ว",
  "{} hour ago": "{} ชั่วโมงที่แล้ว",
  "{} hours ago": "{} ชั่วโมงที่แล้ว",
  "{} day ago": "{} วันที่แล้ว",
  "{} days ago": "{} วันที่แล้ว",
  "{} month ago": "{} เดือนที่แล้ว",
  "{} months ago": "{} เดือนที่แล้ว",
};
