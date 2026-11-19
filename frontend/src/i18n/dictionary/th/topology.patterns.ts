/** Thai — the interpolated sentences the topology map and the policy matrix build. */
import type { Dict } from "../merge";

export const topologyPatterns: Dict = {
  "Could not read the interfaces from {}": "อ่านรายการอินเทอร์เฟซจาก {} ไม่ได้",
  "Topology of {}: {} permitted paths between {} segments":
    "แผนผังของ {}: มีเส้นทางที่อนุญาต {} เส้น ระหว่าง {} เซกเมนต์",
  "Showing {} {} on {}": "กำลังแสดง {} {} บน {}",
  "The map is missing its {} — those could not be read. What is drawn is complete for everything else; the missing part is unknown, not absent.":
    "แผนผังนี้ขาดส่วน{} เพราะอ่านไม่ได้ ส่วนที่วาดอยู่ครบถ้วนสำหรับอย่างอื่นทั้งหมด ส่วนที่หายไปคือ \"ไม่รู้\" ไม่ใช่ \"ไม่มี\"",

  // The scene: the KPI caption, the legend's two counts, and the screen-reader list that is the
  // keyboard path into the same nodes the WebGL canvas draws.
  "Topology of {}, as a list": "แผนผังของ {} ในรูปแบบรายการ",
  "Port {} — {}": "พอร์ต {} — {}",
  "default route via {}{}": "default route ผ่าน {}{}",
  "+{} more not drawn — the {} shown are the ones with an issue or traffic":
    "ยังมีอีก {} เส้นที่ไม่ได้วาด — {} เส้นที่แสดงอยู่คือเส้นที่มีปัญหาหรือมีทราฟฟิก",
  "· {} off-panel": "· อีก {} ตัวไม่อยู่บนหน้าเครื่อง",

  // My devices: how long ago the firewall last pinged a pinned device.
  "checked {}m ago": "ตรวจเมื่อ {} นาทีที่แล้ว",
  "checked {}h ago": "ตรวจเมื่อ {} ชม. ที่แล้ว",
};
