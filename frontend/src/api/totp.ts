import { baseApi } from "./http";

export type TOTPStatus = {
  is_verified: boolean;
  is_enabled: boolean;
  global_enabled: boolean;
};

export type TOTPSetupInitResponse = {
  qr_image: string; // base64 PNG
};

// GET /totp/status
export const GetTOTPStatus = async (): Promise<TOTPStatus> => {
  try {
    const res = await baseApi.get("/totp/status");
    return res.data as TOTPStatus;
  } catch {
    return { is_verified: false, is_enabled: false, global_enabled: false };
  }
};

// GET /totp/setup-init — generates QR code and unverified DB record
export const InitTOTPSetup = async (): Promise<TOTPSetupInitResponse | null> => {
  try {
    const res = await baseApi.get("/totp/setup-init");
    return res.data as TOTPSetupInitResponse;
  } catch (error) {
    console.error("InitTOTPSetup error:", error);
    return null;
  }
};

// POST /totp/setup-verify — verify first code and activate TOTP
//
// server ตั้งทั้ง is_verified และ is_enabled เป็น true — คืนค่ากลับมาให้ client ใช้ตรง ๆ
// จะได้ไม่ต้องเดาเอง (การเดาผิดตรงนี้ทำให้หน้าจอขึ้น "TOTP Disabled" ทันทีหลังตั้งค่าเสร็จ)
export const VerifyTOTPSetup = async (code: string): Promise<{ is_verified: boolean; is_enabled: boolean }> => {
  try {
    const res = await baseApi.post("/totp/setup-verify", { code });
    return {
      is_verified: res.data?.is_verified ?? true,
      is_enabled: res.data?.is_enabled ?? true,
    };
  } catch (error) {
    console.error("VerifyTOTPSetup error:", error);
    throw error;
  }
};

// PATCH /totp/toggle-enabled — pause/resume TOTP without losing setup
//
// ส่ง `enabled` ไปตรง ๆ เสมอ ("Enable" ต้องเปิด "Disable" ต้องปิด) — ไม่ปล่อยให้ server
// สลับค่าเอง เพราะถ้าสถานะที่หน้าจอถืออยู่ไม่ตรงกับ DB (คนละแท็บ / เพิ่งตั้งค่าเสร็จ)
// ปุ่มจะทำตรงข้ามกับที่ตัวเองเขียนไว้
export const ToggleTOTPEnabled = async (enabled?: boolean): Promise<{ is_enabled: boolean }> => {
  const res = await baseApi.patch("/totp/toggle-enabled", enabled === undefined ? {} : { enabled });
  return res.data;
};

// DELETE /totp/disable — permanently remove TOTP setup
export const DisableTOTP = async (): Promise<boolean> => {
  try {
    await baseApi.delete("/totp/disable");
    return true;
  } catch (error) {
    console.error("DisableTOTP error:", error);
    throw error;
  }
};

// GET /totp/global (admin)
export const GetTOTPGlobal = async (): Promise<{ enabled: boolean }> => {
  try {
    const res = await baseApi.get("/totp/global");
    return res.data;
  } catch {
    return { enabled: false };
  }
};

// PATCH /totp/global-toggle (admin)
export const ToggleTOTPGlobal = async (): Promise<{ enabled: boolean }> => {
  try {
    const res = await baseApi.patch("/totp/global-toggle");
    return res.data;
  } catch (error) {
    console.error("ToggleTOTPGlobal error:", error);
    throw error;
  }
};

// POST /auth/verify-totp — verify TOTP code during login
export const VerifyTOTPLogin = async (
  pendingToken: string,
  code: string
): Promise<{ message: string; user: { id: number; email: string; first_name: string; last_name: string; role: string } } | null> => {
  // Deliberately not caught: the login screen has to distinguish a wrong code (401) from a network
  // failure, and both would arrive as `null` if this swallowed them.
  const res = await baseApi.post("/auth/verify-totp", {
    pending_token: pendingToken,
    code,
  });
  return res.data;
};
