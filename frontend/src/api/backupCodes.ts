import { baseApi } from "./http";

export type BackupCodesStatus = {
  total: number;
  used: number;
  remaining: number;
};

export const VerifyBackupCode = async (
  pendingToken: string,
  backupCode: string
) => {
  const res = await baseApi.post("/auth/verify-backup-code", {
    pending_token: pendingToken,
    backup_code: backupCode,
  });
  return res.data;
};
