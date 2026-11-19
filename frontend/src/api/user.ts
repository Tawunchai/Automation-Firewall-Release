import { responseBody } from "./errorText";
import { baseApi as userApi } from "./http";

// =======================
// Types
// =======================
export type UserResponse = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  profile: string;
  phone_number: string;
  location: string;
  position: string;
  role: string;
  message?: string;
  error?: string;
};

export type CreateUserInput = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  profile: string;
  /** ข้อมูลโปรไฟล์เสริม — ฟอร์มสร้างผู้ใช้ไม่ได้เก็บ เติมทีหลังที่หน้า Edit ได้ */
  phone_number?: string;
  location?: string;
  position?: string;
  app_role_id: number;
};

export type UpdateUserInput = {
  email?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  profile?: string;
  phone_number?: string;
  location?: string;
  position?: string;
  app_role_id?: number;
};

export type DeleteUserResponse = {
  message: string;
};

// =======================
// API: GET /users
// =======================
export const ListUser = async (): Promise<UserResponse[] | null> => {
  try {
    const response = await userApi.get("/users");

    if (Array.isArray(response.data)) {
      return response.data as UserResponse[];
    }

    const data = response.data?.data ?? response.data;

    if (Array.isArray(data)) {
      return data as UserResponse[];
    }

    console.error("Expected array but got:", response.data);
    return null;
  } catch (error) {
    console.error("ListUser error:", error);
    return null;
  }
};

// =======================
// API: GET /users/:id
// =======================
export const ListUserByID = async (id: number | string): Promise<UserResponse | null> => {
  try {
    const response = await userApi.get(`/users/${id}`);

    if (response.data && typeof response.data === "object") {
      return response.data as UserResponse;
    }

    console.error("Unexpected ListUserByID response:", response.data);
    return null;
  } catch (error) {
    console.error("ListUserByID error:", error);
    return null;
  }
};

// =======================
// API: POST /create-users
// =======================
export const CreateUser = async (
  payload: CreateUserInput
): Promise<UserResponse | null> => {
  try {
    const response = await userApi.post("/create-users", payload);

    if (response.data && typeof response.data === "object") {
      return response.data as UserResponse;
    }

    console.error("Unexpected CreateUser response:", response.data);
    return null;
  } catch (error) {
    console.error("CreateUser error:", error);
    return null;
  }
};

// =======================
// API: PATCH /update-users/:id
// =======================
export const UpdateUserByID = async (
  id: number | string,
  payload: UpdateUserInput
): Promise<UserResponse | null> => {
  try {
    const response = await userApi.patch(`/update-users/${id}`, payload);

    if (response.data && typeof response.data === "object") {
      return response.data as UserResponse;
    }

    console.error("Unexpected UpdateUserByID response:", response.data);
    return null;
  } catch (error) {
    console.error("UpdateUserByID error:", error);
    return null;
  }
};

// =======================
// API: DELETE /delete-users/:id
// =======================
export const DeleteUserByID = async (
  id: number | string
): Promise<DeleteUserResponse | null> => {
  try {
    const response = await userApi.delete(`/delete-users/${id}`);

    if (response.data && response.data.message) {
      return response.data as DeleteUserResponse;
    }

    console.error("Unexpected DeleteUserByID response:", response.data);
    return null;
  } catch (error) {
    console.error("DeleteUserByID error:", error);
    return null;
  }
};


export type RoleResponse = {
  id: number;
  role: string;
};

export type UpdateUserByAdminPayload = {
  email?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  profile?: string;
  phone_number?: string;
  location?: string;
  position?: string;
  app_role_id?: number;
};

export type UpdateUserByAdminResponse = {
  message?: string;
  data?: UserResponse;
  error?: string;
};

// =======================
// API: GET /roles
// =======================
export const ListRoles = async (): Promise<RoleResponse[] | null> => {
  try {
    const response = await userApi.get("/roles");

    if (Array.isArray(response.data)) {
      return response.data as RoleResponse[];
    }

    const data = response.data?.data ?? response.data;

    if (Array.isArray(data)) {
      return data as RoleResponse[];
    }

    console.error("Expected role array but got:", response.data);
    return null;
  } catch (error) {
    console.error("ListRoles error:", error);
    return null;
  }
};

// =======================
// API: PATCH /admin/users/:id
// =======================
export const UpdateUserIDByAdmin = async (
  id: number,
  payload: UpdateUserByAdminPayload
): Promise<UpdateUserByAdminResponse> => {
  try {
    const response = await userApi.patch(`/admin/users/${id}`, payload);
    return response.data as UpdateUserByAdminResponse;
  } catch (error) {
    console.error("UpdateUserIDByAdmin error:", error);
    return (
      (responseBody(error) as UpdateUserByAdminResponse) || {
        error: "Update user by admin failed",
      }
    );
  }
};

export interface SendEmailResponse {
  id: number;
  email: string;
  // The app password is write-only — the backend never echoes a stored secret back to the
  // browser (same convention as device credentials). This only says whether one is set.
  pass_app_set: boolean;
  app_user_id: number;
  two_factor_enabled: boolean;
}

export interface UpdateSendEmailPayload {
  email: string;
  pass_app: string;
}

// =======================
// API: GET /send-emails
// =======================
export const ListSendEmails = async (): Promise<SendEmailResponse[] | null> => {
  try {
    const response = await userApi.get("/send-emails");

    if (Array.isArray(response.data)) {
      return response.data as SendEmailResponse[];
    }

    const data = response.data?.data ?? response.data;

    if (Array.isArray(data)) {
      return data as SendEmailResponse[];
    }

    console.error("Expected send email array but got:", response.data);
    return null;
  } catch (error) {
    console.error("ListSendEmails error:", error);
    return null;
  }
};

// =======================
// API: POST /send-email
// =======================
export const CreateSendEmail = async (
  payload: UpdateSendEmailPayload
): Promise<SendEmailResponse | null> => {
  try {
    const response = await userApi.post("/send-email", payload);
    const data = response.data?.data ?? response.data;
    if (data?.id) return data as SendEmailResponse;
    console.error("Expected created send email object but got:", response.data);
    return null;
  } catch (error) {
    console.error("CreateSendEmail error:", error);
    return null;
  }
};

// =======================
// API: PUT /send-email/:id
// =======================
export const UpdateSendEmailByID = async (
  id: number,
  payload: UpdateSendEmailPayload
): Promise<SendEmailResponse | null> => {
  try {
    const response = await userApi.put(`/send-email/${id}`, payload);

    if (response.data?.data) {
      return response.data.data as SendEmailResponse;
    }

    if (response.data?.id) {
      return response.data as SendEmailResponse;
    }

    console.error("Expected updated send email object but got:", response.data);
    return null;
  } catch (error) {
    console.error("UpdateSendEmailByID error:", error);
    return null;
  }
};

// =======================
// API: POST /upload/profile
//  profile →  URL
// =======================
export type UploadProfileResponse = {
  url: string;
  filename: string;
};

// =======================
// API: POST /users/bulk-delete
// =======================
export type BulkDeleteResponse = { message: string; count: number };

export const BulkDeleteUsers = async (ids: number[]): Promise<BulkDeleteResponse> => {
  const res = await userApi.post("/users/bulk-delete", { ids });
  return res.data;
};

// =======================
// API: PATCH /users/bulk-role
// =======================
export type BulkChangeRoleResponse = { message: string; count: number };

export const BulkChangeRole = async (
  ids: number[],
  appRoleId: number
): Promise<BulkChangeRoleResponse> => {
  const res = await userApi.patch("/users/bulk-role", { ids, app_role_id: appRoleId });
  return res.data;
};

// =======================
// API: PATCH /theme-preference
// =======================
export type ThemePreferencePayload = {
  theme_mode?: string;
  theme_color?: string;
};

export const UpdateThemePreference = async (
  payload: ThemePreferencePayload
): Promise<{ message: string } | null> => {
  try {
    const response = await userApi.patch("/theme-preference", payload);
    return response.data;
  } catch {
    return null;
  }
};

/**
 * UploadProfileImage — แปลงไฟล์รูปภาพเป็น base64 data URL โดยใช้ Canvas API
 * ทำงานทั้งหมดบน client side ไม่ต้องส่งไฟล์ไปเก็บที่ server
 *
 * - Resize ให้เล็กกว่า MAX_SIZE × MAX_SIZE (เก็บ aspect ratio)
 * - แปลงเป็น JPEG 80% quality เพื่อลดขนาด
 * - คืน data URL พร้อมใช้ใน <img src="..."> และเก็บใน DB โดยตรง
 */
const MAX_SIZE = 200; // px (ด้านยาวสุด)

export const UploadProfileImage = async (
  file: File
): Promise<string | null> => {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (readerEvent) => {
      const dataUrl = readerEvent.target?.result as string;
      if (!dataUrl) { resolve(null); return; }

      const img = new Image();
      img.onload = () => {
        let { width, height } = img;

        // Resize proportionally ถ้าใหญ่กว่า MAX_SIZE
        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width >= height) {
            height = Math.round((height * MAX_SIZE) / width);
            width  = MAX_SIZE;
          } else {
            width  = Math.round((width * MAX_SIZE) / height);
            height = MAX_SIZE;
          }
        }

        const canvas  = document.createElement("canvas");
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }

        ctx.drawImage(img, 0, 0, width, height);

        // Export เป็น JPEG 80% quality → data URL
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };

      img.onerror = () => resolve(null);
      img.src = dataUrl;
    };

    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
};
