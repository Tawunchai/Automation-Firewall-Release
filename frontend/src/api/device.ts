import { baseApi } from "./http";

export interface NetworkDevice {
  id: number;
  name: string;
  vendor: string;
  platform: string;
  mgmt_ip: string;
  port: number;
  /** The FortiGate admin HTTPS/REST port — not `port` above, which is SSH. Most units leave this
   *  at 443, but a unit whose admin GUI was deliberately moved off 443 cannot be reached at all
   *  without this set correctly. */
  api_port: number;
  site: string;
  role: string;
  status: string;
  /**
   * The account unattended work (auto-backup, compliance, the alert sweep) logs in with, and who
   * owns it. Admin-only on the wire, and empty when nobody has nominated one — a device with a
   * backup schedule and no automation account cannot run it, which used to be invisible.
   *
   * A device has NO login of its own any more: people reach it with the credential they map under
   * Profile ▸ Device Credentials.
   */
  automation_account: string;
  automation_owner: string;

  /**
   * Whether unattended work can actually run on this device.
   *
   * "ready"  an account has been nominated for it
   * "legacy" nothing nominated; it falls back to the old login left on the device record, which no
   *          screen maintains and nothing has tested
   * "none"   nothing at all — every scheduled job fails
   *
   * `automation_account` alone could not tell these apart: it names whichever login is in use and
   * reads identically for a nominated credential and for the stale one. That is how a deployment
   * where NO scheduled backup had ever succeeded still looked healthy on this page.
   */
  automation_state?: "ready" | "legacy" | "none";
  automation_warning?: string;
  backup_enabled: boolean;
  backup_cron: string;
  next_backup_at: string | null;
  last_backup_at: string | null;
}

export interface DeviceCreatePayload {
  name: string;
  vendor: string;
  platform: string;
  mgmt_ip: string;
  port?: number;
  api_port?: number;
  site?: string;
  role?: string;
  status?: string;
  backup_enabled?: boolean;
  backup_cron?: string;
}

export type DeviceUpdatePayload = Partial<DeviceCreatePayload>;

export interface AutomationJob {
  id: number;
  type: string;
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";
  network_device_id: number;
  triggered_by: string;
  result: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  device?: NetworkDevice;
}

export interface ConfigBackup {
  id: number;
  network_device_id: number;
  automation_job_id: number;
  git_commit: string;
  sha256: string;
  path: string;
  size_bytes: number;
  lines: number;
  diff_summary: string; // "+N/-N lines"  backup  ( = backup )
  created_at: string;
}

// ── Devices ──────────────────────────────────────────────────────────────────
export const ListDevices = async (): Promise<NetworkDevice[]> => {
  const res = await baseApi.get<{ data: NetworkDevice[] }>("/devices");
  return res.data.data ?? [];
};

export const CreateDevice = async (payload: DeviceCreatePayload) => {
  const res = await baseApi.post("/devices", payload);
  return res.data;
};

// Bulk onboarding (Phase C4) — several device rows in one request, each with its own result. See
// the backend's controller/networkdevice/bulk.go.
export type BulkDeviceRow = {
  name: string;
  vendor: string;
  mgmt_ip: string;
  port?: number;
  site?: string;
};

export type BulkDeviceResult = {
  row: number;
  name: string;
  status: "created" | "failed";
  message?: string;
  device_id?: number;
};

export const UpdateDevice = async (id: number, payload: DeviceUpdatePayload) => {
  const res = await baseApi.patch(`/devices/${id}`, payload);
  return res.data;
};

export const DeleteDevice = async (id: number): Promise<void> => {
  await baseApi.delete(`/devices/${id}`);
};

// ── Backup / Jobs ────────────────────────────────────────────────────────────
export const TriggerBackup = async (deviceId: number): Promise<{ job_id: number; status: string }> => {
  const res = await baseApi.post<{ data: { job_id: number; status: string } }>(
    `/devices/${deviceId}/backup`
  );
  return res.data.data;
};

export const GetJob = async (jobId: number): Promise<AutomationJob> => {
  const res = await baseApi.get<{ data: AutomationJob }>(`/jobs/${jobId}`);
  return res.data.data;
};

export const ListJobs = async (deviceId?: number): Promise<AutomationJob[]> => {
  const res = await baseApi.get<{ data: AutomationJob[] }>("/jobs", {
    params: deviceId ? { device_id: deviceId } : undefined,
  });
  return res.data.data ?? [];
};

export const ResetJob = async (jobId: number): Promise<void> => {
  await baseApi.post(`/jobs/${jobId}/reset`);
};

export const ListDeviceBackups = async (deviceId: number): Promise<ConfigBackup[]> => {
  const res = await baseApi.get<{ data: ConfigBackup[] }>(`/devices/${deviceId}/backups`);
  return res.data.data ?? [];
};

export interface BackupContent {
  id: number;
  device: string;
  git_commit: string;
  lines: number;
  size_bytes: number;
  created_at: string;
  content: string;
}

//  config  backup 1 
export const GetBackupContent = async (backupId: number): Promise<BackupContent> => {
  const res = await baseApi.get<{ data: BackupContent }>(`/backups/${backupId}/content`);
  return res.data.data;
};

//  config  .conf (auth  cookie →  axios blob)
export const DownloadBackup = async (backupId: number, filename: string): Promise<void> => {
  const res = await baseApi.get(`/backups/${backupId}/download`, { responseType: "blob" });
  const url = window.URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

// DELETE /backups/:id — remove one stored config backup (admin only on the server).
export const DeleteBackup = async (backupId: number): Promise<void> => {
  await baseApi.delete(`/backups/${backupId}`);
};

// ── Config Deploy (push config ) ────────────────────────────
export type DeployStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL";

export interface ConfigDeployResult {
  id: number;
  config_deploy_id: number;
  network_device_id: number;
  device_name: string;
  status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";
  output: string;
  error: string;
  diff: string;
  changed: boolean;
  before_backup_id: number;
  started_at: string | null;
  finished_at: string | null;
}

export interface ConfigDeploy {
  id: number;
  command_text: string;
  mode?: "config" | "query";
  status: DeployStatus;
  triggered_by: string;
  total_devices: number;
  success_count: number;
  failed_count: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  results?: ConfigDeployResult[];
}

export interface CreateDeployPayload {
  device_ids: number[];
  command_text: string;
}

export interface CreateDeployResponse {
  id: number;
  status: string;
  total_devices: number;
}

export const CreateConfigDeploy = async (
  payload: CreateDeployPayload
): Promise<CreateDeployResponse> => {
  const res = await baseApi.post<{ data: CreateDeployResponse }>("/config-deploys", payload);
  return res.data.data;
};

export const GetConfigDeploy = async (id: number): Promise<ConfigDeploy> => {
  const res = await baseApi.get<{ data: ConfigDeploy }>(`/config-deploys/${id}`);
  return res.data.data;
};

// ── Config Query ( — read-only get/show/diagnose) ──────────
export interface CreateQueryPayload {
  device_id: number;
  command_text: string;
}

export const CreateConfigQuery = async (
  payload: CreateQueryPayload
): Promise<{ id: number; status: string; total_devices: number; mode: string }> => {
  const res = await baseApi.post<{ data: { id: number; status: string; total_devices: number; mode: string } }>(
    "/config-deploys/query",
    payload
  );
  return res.data.data;
};

// ── Restore a whole configuration onto a device ──────────────────────────────
//
// This used to be a one-shot POST that pushed the stored config back as CLI lines. It is now two
// steps against a real FortiOS restore, because that operation reboots the firewall and replaces
// the entire configuration: the preview says what would happen, and the POST refuses to run
// without an explicit confirm. See backend/controller/configdeploy/rollback.go.

export interface RollbackPreview {
  backup_id: number;
  device_id: number;
  device_name: string;
  taken_at: string;
  lines: number;
  size_bytes: number;

  /** Platform/firmware token out of the backup file's own header. */
  file_model: string;
  device_model: string;
  device_version: string;

  /** false = the stored text is not a configuration file at all. Blocking. */
  valid: boolean;
  invalid_error?: string;

  /** false = taken from a different model or firmware. Advisory — `force` can override. */
  compatible: boolean;
  incompatible_reason?: string;

  /** Always shown. The reboot is not optional. */
  warnings: string[];
}

export const GetRollbackPreview = async (backupId: number): Promise<RollbackPreview> => {
  const res = await baseApi.get<RollbackPreview>(`/backups/${backupId}/rollback-preview`);
  return res.data;
};

export interface RollbackResult {
  id: number;
  status: string;
  device_name: string;
  session_id: string;
  rebooting: boolean;
  message: string;
}

export const RollbackBackup = async (
  backupId: number,
  opts?: { force?: boolean }
): Promise<RollbackResult> => {
  const res = await baseApi.post<{ data: RollbackResult }>(
    `/backups/${backupId}/rollback`,
    { confirm: true, force: opts?.force ?? false }
  );
  return res.data.data;
};

// ── Batch Backup ─────────────────────────────────────────────────────────────
export interface BatchBackupResponse {
  queued: number;
  skipped: number;
  unreachable: number;
  total: number;
}

export const BatchBackup = async (deviceIds?: number[]): Promise<BatchBackupResponse> => {
  const res = await baseApi.post<BatchBackupResponse>("/devices/batch-backup", {
    device_ids: deviceIds ?? [],
  });
  return res.data;
};

// ── Reachability (TCP ping  backup) ─────────────────────────────────────
export interface ReachabilityResult {
  reachable: boolean;
  latency_ms: number;
  host: string;
  port: number;
  error?: string;
}

export const PingDevice = async (deviceId: number): Promise<ReachabilityResult> => {
  const res = await baseApi.get<ReachabilityResult>(`/devices/${deviceId}/ping`);
  return res.data;
};

export interface WorkerHealth {
  online: boolean;
  last_seen: string | null;
  message: string;
}

export const GetWorkerHealth = async (): Promise<WorkerHealth> => {
  const res = await baseApi.get<WorkerHealth>("/worker/health");
  return res.data;
};
