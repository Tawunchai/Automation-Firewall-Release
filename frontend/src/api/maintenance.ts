import { baseApi } from "./http";
import axios from "axios";

export type MaintenanceStatus = {
  enabled: boolean;
};

export type PublicMaintenanceStatus = {
  enabled: boolean;
  seconds_remaining: number;
};

export const GetMaintenanceStatus = async (): Promise<MaintenanceStatus> => {
  try {
    const res = await baseApi.get("/maintenance");
    return res.data ?? { enabled: false };
  } catch {
    return { enabled: false };
  }
};

export const ToggleMaintenance = async (): Promise<MaintenanceStatus> => {
  try {
    const res = await baseApi.patch("/maintenance/toggle");
    return res.data ?? { enabled: false };
  } catch {
    return { enabled: false };
  }
};

// Public — no auth required. Returns current maintenance state + seconds until
// the middleware starts blocking (0 means already blocking).
export const GetPublicMaintenanceStatus = async (): Promise<PublicMaintenanceStatus> => {
  try {
    const res = await axios.get(`${baseApi.defaults.baseURL}/maintenance/status`, {
      withCredentials: true,
      headers: { "ngrok-skip-browser-warning": "true" },
    });
    return res.data ?? { enabled: false, seconds_remaining: 0 };
  } catch {
    return { enabled: false, seconds_remaining: 0 };
  }
};
