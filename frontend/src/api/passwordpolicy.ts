import { baseApi } from "./http";

export type PasswordPolicy = {
  min_length: number;
  require_uppercase: boolean;
  require_number: boolean;
  require_special: boolean;
  expiry_days: number;
};

export const GetPasswordPolicy = async (): Promise<PasswordPolicy> => {
  const res = await baseApi.get("/password-policy");
  return res.data as PasswordPolicy;
};

export const UpdatePasswordPolicy = async (
  payload: Partial<PasswordPolicy>
): Promise<{ message: string; data: PasswordPolicy }> => {
  const res = await baseApi.patch("/password-policy", payload);
  return res.data;
};

// ตัวตรวจรหัสผ่านฝั่ง client ย้ายไปอยู่ที่ src/lib/passwordPolicy.ts แล้ว
//
// ของเดิมชื่อ validatePasswordAgainstPolicy อยู่ตรงนี้ แต่ข้อความ error ภาษาไทยในนั้น
// **หายไปหมด** เหลือเป็นสตริงว่างอย่าง " 1 " (โดนตัดตอนไฟล์ถูกบันทึกผิด encoding —
// ไฟล์นี้ยังมี BOM ติดอยู่) มันจึงคืน error ที่อ่านไม่รู้เรื่อง โชคดีที่ยังไม่มีหน้าไหนเรียกใช้
// ตัวใหม่คืน i18n key แทนข้อความดิบ ปัญหานี้จึงเกิดซ้ำไม่ได้อีก
