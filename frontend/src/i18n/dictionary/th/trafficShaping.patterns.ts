/** Thai — the interpolated sentences the Traffic Shaping page builds. */
import type { Dict } from "../merge";

export const trafficShapingPatterns: Dict = {
  "Could not read traffic shaping from {}": "อ่านการตั้งค่าจำกัดแบนด์วิดท์จาก {} ไม่ได้",
  'Shaper "{}" {} on {}': 'ตัวจำกัด "{}" {} บน {} แล้ว',
  'Shaper "{}" deleted from {}': 'ลบตัวจำกัด "{}" ออกจาก {} แล้ว',
  'Shaper "{}" will be removed from {}.': 'ตัวจำกัด "{}" จะถูกลบออกจาก {}',
  'Shaping policy "{}" created on {}': 'สร้างกฎการจำกัด "{}" บน {} แล้ว',
  '"{}" is used by {} shaping {}. The device refuses the delete while that is true.':
    '"{}" ถูกใช้อยู่โดย {} {} — อุปกรณ์จะไม่ยอมให้ลบตราบใดที่ยังเป็นแบบนี้',
  '"{}" could not be deleted': 'ลบ "{}" ไม่สำเร็จ',
  "Delete policy {}": "ลบกฎ {}",
  "used by {}": "ถูกใช้โดย {}",
  "forward: {} · reverse: {}": "ขาไป: {} · ขากลับ: {}",
  "up to {}{} · {} priority · {}": "ไม่เกิน {}{} · ลำดับความสำคัญ {} · {}",
  ", never below {} {}": " และไม่ต่ำกว่า {} {}",

  "Shaper \"{}\" created on {}": "สร้าง shaper \"{}\" บน {} แล้ว",
  "Shaper \"{}\" updated on {}": "อัปเดต shaper \"{}\" บน {} แล้ว",
};
