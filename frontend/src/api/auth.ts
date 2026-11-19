import { responseBody } from "./errorText";
import { baseApi as authApi } from "./http";

// =======================
// Types
// =======================
export type LoginInput = {
  email: string;
  password: string;
};

export type LoginUser = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
};

export type LoginResponse = {
  message?: string;
  user?: LoginUser;
  // TOTP (authenticator app)
  requires_totp?: boolean;
  // Email OTP 2FA
  requires_2fa?: boolean;
  masked_email?: string;
  pending_token?: string;
};

export type MeResponse = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  profile: string;
  phone_number: string;
  location: string;
  position: string;
  role: string;
  theme_mode?: string;
  theme_color?: string;
};

export type LogoutResponse = {
  message: string;
};

// =======================
// Types
// =======================
export type CheckUserEmailInput = {
  email: string;
};

/**
 * The reply to step 1 of "I forgot my password".
 *
 * It carries no `reset_token` and no `exists` any more, because the endpoint no longer decides
 * anything: it used to hand an unauthenticated caller a signed token that POST
 * /reset-password-direct accepted as proof of ownership, and to say whether an address was
 * registered. Both are gone — proof now comes from the OTP mailed to the address itself.
 */
export type CheckUserEmailResponse = {
  message?: string;
  error?: string;
};

export type SendOTPInput = {
  email: string;
};

export type SendOTPResponse = {
  message: string;
  error?: string;
};

export type VerifyOTPInput = {
  email: string;
  otp: string;
  new_password: string;
};

export type VerifyOTPResponse = {
  message: string;
  error?: string;
};

// =======================
// API: POST /auth/login
// =======================
export const Login = async (
  payload: LoginInput
): Promise<LoginResponse | null> => {
  // Re-throw errors so the caller can extract the server error message.
  const response = await authApi.post("/auth/login", payload);
  return response.data as LoginResponse;
};

// =======================
// API: GET /security-config
// =======================
export type SecurityConfigResponse = {
  /** สวิตช์ใหญ่ — ปิดแล้ว flow email OTP ทั้งหมดถูกปิดที่ฝั่ง server ไม่ใช่แค่บนหน้าจอ */
  two_step: boolean;
  /** ค่าที่ผู้ใช้ติ๊กไว้ (ยังถูกเก็บไว้แม้สวิตช์ใหญ่ปิด) */
  login_2fa: boolean;
  reset_otp: boolean;
  /** ค่าที่มีผลจริงหลังผ่านสวิตช์ใหญ่ */
  login_2fa_effective: boolean;
  reset_otp_effective: boolean;
};

export const GetSecurityConfig = async (): Promise<SecurityConfigResponse> => {
  try {
    const res = await authApi.get("/security-config");
    return res.data as SecurityConfigResponse;
  } catch {
    // อ่านค่าไม่ได้ = ไม่รู้สถานะ ต้องไม่เดาว่า "เปิดอยู่" เพราะหน้าจอจะโชว์ว่าปลอดภัย
    // กว่าความจริง — เป็นกฎเดียวกับที่ใช้ทั้งหน้า Compliance
    return {
      two_step: false, login_2fa: false, reset_otp: false,
      login_2fa_effective: false, reset_otp_effective: false,
    };
  }
};

// =======================
// API: PATCH /toggle-two-step (สวิตช์ใหญ่)
// =======================
export type ToggleTwoStepResponse = {
  two_step_enabled: boolean;
  login_2fa_effective: boolean;
  reset_otp_effective: boolean;
  message: string;
};

export const ToggleTwoStep = async (): Promise<ToggleTwoStepResponse | null> => {
  try {
    const res = await authApi.patch("/toggle-two-step");
    return res.data as ToggleTwoStepResponse;
  } catch (error) {
    console.error("ToggleTwoStep error:", error);
    return null;
  }
};

// =======================
// API: PATCH /toggle-2fa
// =======================
export type Toggle2FAResponse = {
  two_factor_enabled: boolean;
  message: string;
};

export const Toggle2FA = async (): Promise<Toggle2FAResponse | null> => {
  try {
    const response = await authApi.patch("/toggle-2fa");
    if (response.data && typeof response.data.two_factor_enabled === "boolean") {
      return response.data as Toggle2FAResponse;
    }
    return null;
  } catch (error) {
    console.error("Toggle2FA error:", error);
    return null;
  }
};

// หมายเหตุ: ToggleSignupOTP ถูกถอดออกแล้ว — ระบบนี้ไม่มีหน้าสมัครสมาชิก
// บัญชีถูกสร้างโดย admin ผ่านหน้า Users เท่านั้น (endpoint /toggle-signup-otp,
// /register, /send-otp-signup, /verify-otp-signup, /signup-config ถูกลบทั้งหมด)

// =======================
// API: PATCH /toggle-reset-otp
// =======================
export type ToggleResetOTPResponse = {
  reset_otp_enabled: boolean;
  message: string;
};

export const ToggleResetOTP = async (): Promise<ToggleResetOTPResponse | null> => {
  try {
    const res = await authApi.patch("/toggle-reset-otp");
    return res.data as ToggleResetOTPResponse;
  } catch (error) {
    console.error("ToggleResetOTP error:", error);
    return null;
  }
};

// =======================
// API: GET /auth/me
// =======================
export const GetMe = async (): Promise<MeResponse | null> => {
  try {
    const response = await authApi.get("/auth/me");

    if (response.data && typeof response.data === "object") {
      return response.data as MeResponse;
    }

    console.error("Unexpected GetMe response:", response.data);
    return null;
  } catch (error) {
    console.error("GetMe error:", error);
    return null;
  }
};

// =======================
// API: POST /auth/logout
// =======================
export const Logout = async (): Promise<LogoutResponse | null> => {
  try {
    const response = await authApi.post("/auth/logout");

    if (response.data && response.data.message) {
      return response.data as LogoutResponse;
    }

    console.error("Unexpected logout response:", response.data);
    return null;
  } catch (error) {
    console.error("Logout error:", error);
    return null;
  }
};

// =======================
// API: POST /auth/verify-2fa  (email OTP login)
// =======================
export type VerifyLoginOTPPayload = {
  pending_token: string;
  otp: string;
};

export const VerifyLoginOTP = async (
  payload: VerifyLoginOTPPayload
): Promise<{ message: string; user: LoginUser } | null> => {
  const response = await authApi.post("/auth/verify-2fa", payload);
  return response.data;
};

// =======================
// API: POST /check-user-email
// =======================
export const CheckUserEmail = async (
  payload: CheckUserEmailInput
): Promise<CheckUserEmailResponse | null> => {
  try {
    const response = await authApi.post("/check-user-email", payload);

    if (response.data && typeof response.data === "object") {
      return response.data as CheckUserEmailResponse;
    }

    console.error("Unexpected CheckUserEmail response:", response.data);
    return null;
  } catch (error) {
    console.error("CheckUserEmail error:", error);

    const body = responseBody(error);
    if (body) return body as CheckUserEmailResponse;

    return null;
  }
};

// =======================
// API: POST /send-otp
// =======================
export const SendOTP = async (
  payload: SendOTPInput
): Promise<SendOTPResponse | null> => {
  try {
    const response = await authApi.post("/send-otp", payload);

    if (response.data && typeof response.data === "object") {
      return response.data as SendOTPResponse;
    }

    console.error("Unexpected SendOTP response:", response.data);
    return null;
  } catch (error) {
    console.error("SendOTP error:", error);

    const body = responseBody(error);
    if (body) return body as SendOTPResponse;

    return null;
  }
};

// =======================
// API: POST /verify-otp-password
// =======================
export const VerifyOTPAddUpdatePassword = async (
  payload: VerifyOTPInput
): Promise<VerifyOTPResponse | null> => {
  try {
    const response = await authApi.post("/verify-otp-password", payload);

    if (response.data && typeof response.data === "object") {
      return response.data as VerifyOTPResponse;
    }

    console.error("Unexpected VerifyOTP response:", response.data);
    return null;
  } catch (error) {
    console.error("VerifyOTP error:", error);

    const body = responseBody(error);
    if (body) return body as VerifyOTPResponse;

    return null;
  }
};

// =======================
// There is no direct password reset any more
// =======================
//
// POST /reset-password-direct took { email, new_password, reset_token } and the token came
// straight out of the /check-user-email response above, so naming an address was the entire
// proof of ownership. The endpoint is gone from the backend; resetting a password requires the
// OTP mailed to the address, and when email OTP is switched off it is an admin action.

// Types: Email + PhoneNumber
// =======================
export type EmailAndPhoneNumberResponse = {
  id: number;
  email: string;
  phone_number: string;
};

// =======================
// API: GET /email-phone-numbers
// =======================
export const ListEmailAndPhoneNumber = async (): Promise<
  EmailAndPhoneNumberResponse[] | null
> => {
  try {
    const response = await authApi.get("/email-phone-numbers");

    if (Array.isArray(response.data)) {
      return response.data as EmailAndPhoneNumberResponse[];
    }

    const data = response.data?.data ?? response.data;

    if (Array.isArray(data)) {
      return data as EmailAndPhoneNumberResponse[];
    }

    console.error("Expected email-phone-number array but got:", response.data);
    return null;
  } catch (error) {
    console.error("ListEmailAndPhoneNumber error:", error);
    return null;
  }
};