import { baseApi } from "./http";

// Streaming the Change Ledger to an external SIEM webhook as it happens — Phase C1. A sibling of
// Notify, not part of it: see the backend's services/siemexport.go for why.

export type SIEMExportPolicy = {
  enabled: boolean;
  webhook_url: string;
};

export const GetSIEMExportPolicy = async (): Promise<SIEMExportPolicy> => {
  const res = await baseApi.get<SIEMExportPolicy>("/admin/siem-export");
  return res.data;
};

export const UpdateSIEMExportPolicy = async (enabled: boolean, webhookUrl: string): Promise<SIEMExportPolicy> => {
  const res = await baseApi.patch<{ data: SIEMExportPolicy }>("/admin/siem-export", {
    enabled, webhook_url: webhookUrl,
  });
  return res.data.data;
};

export const TestSIEMWebhook = async (webhookUrl: string): Promise<{ message: string }> => {
  const res = await baseApi.post("/admin/siem-export/test", { webhook_url: webhookUrl });
  return res.data;
};
