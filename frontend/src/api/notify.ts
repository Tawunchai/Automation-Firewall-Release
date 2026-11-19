import { baseApi } from "./http";

// Notify Management — alert rules, delivery channels, and the record of what was sent.
//
// Admin-only on the server: a channel holds a LINE bot token, and a rule decides who gets woken at
// 3am. Neither is a personal preference.

// ── the catalogue ────────────────────────────────────────────────────────────

export type NotifyKind =
  | "interface-link"
  | "device-unreachable"
  | "license-expiry"
  | "cpu-peak"
  | "memory-peak"
  | "session-spike"
  | "disk-usage";

export type NotifySeverity = "info" | "warning" | "critical";

export type NotifyKindInfo = {
  kind: NotifyKind;
  title: string;
  /** "link" (link & reachability) or "resource" (thresholds). Groups the picker. */
  family: "link" | "resource" | string;
  description: string;

  /** False for the kinds that watch a STATE — a port is up or it is not. The form hides the field. */
  has_threshold: boolean;
  threshold_unit?: string;
  threshold_default?: number;
  threshold_min?: number;
  threshold_max?: number;

  has_subjects: boolean;
  subject_label?: string;
  default_severity: NotifySeverity;
};

export type NotifyKindCatalogue = {
  kinds: NotifyKindInfo[];
  /** How long one poll is. A "sustained for N polls" field is meaningless without it. */
  pollSeconds: number;
};

export const ListNotifyKinds = async (): Promise<NotifyKindCatalogue> => {
  const res = await baseApi.get("/notify/kinds");
  return { kinds: res.data.data ?? [], pollSeconds: res.data.poll_seconds ?? 60 };
};

// ── channels & recipients ────────────────────────────────────────────────────

export type NotifyChannelType = "line" | "email";

export type NotifyRecipient = {
  id: number;
  notify_channel_id: number;
  channel_name: string;
  channel_type: NotifyChannelType;
  name: string;
  target: string;
  is_group: boolean;
  enabled: boolean;
};

export type NotifyChannel = {
  id: number;
  name: string;
  type: NotifyChannelType;
  enabled: boolean;
  description: string;
  /** The token itself never leaves the server. This is how the form shows "configured". */
  has_token: boolean;

  last_tested_at: string | null;
  last_test_status: "" | "ok" | "fail";
  last_test_error: string;

  recipient_count: number;
  recipients: NotifyRecipient[];
  created_at: string;
};

export const ListNotifyChannels = async (): Promise<NotifyChannel[]> => {
  const res = await baseApi.get("/notify/channels");
  return res.data.data ?? [];
};

export type NotifyChannelPayload = {
  name: string;
  type?: NotifyChannelType;
  description?: string;
  enabled?: boolean;
  /** Write-only. Empty on an update means "leave the stored token alone". */
  token?: string;
};

export const CreateNotifyChannel = async (p: NotifyChannelPayload): Promise<NotifyChannel> => {
  const res = await baseApi.post("/notify/channels", p);
  return res.data.data;
};

export const UpdateNotifyChannel = async (id: number, p: NotifyChannelPayload): Promise<NotifyChannel> => {
  const res = await baseApi.patch(`/notify/channels/${id}`, p);
  return res.data.data;
};

export const DeleteNotifyChannel = async (id: number): Promise<void> => {
  await baseApi.delete(`/notify/channels/${id}`);
};

export type NotifySendResult = {
  status: "sent" | "partial" | "failed" | "no-recipients";
  sent: number;
  failed: number;
  results?: { recipient: string; ok: boolean; error?: string }[];
  error?: string;
};

/** Sends a real message through the stored token to the stored destinations. */
export const TestNotifyChannel = async (id: number): Promise<NotifySendResult> => {
  const res = await baseApi.post(`/notify/channels/${id}/test`);
  return res.data;
};

export type NotifyRecipientPayload = {
  notify_channel_id: number;
  name?: string;
  target: string;
  is_group?: boolean;
  enabled?: boolean;
};

export const CreateNotifyRecipient = async (p: NotifyRecipientPayload): Promise<NotifyRecipient> => {
  const res = await baseApi.post("/notify/recipients", p);
  return res.data.data;
};

export const UpdateNotifyRecipient = async (
  id: number,
  p: Partial<NotifyRecipientPayload>,
): Promise<NotifyRecipient> => {
  const res = await baseApi.patch(`/notify/recipients/${id}`, p);
  return res.data.data;
};

export const DeleteNotifyRecipient = async (id: number): Promise<void> => {
  await baseApi.delete(`/notify/recipients/${id}`);
};

// ── rules ────────────────────────────────────────────────────────────────────

export type NotifyRule = {
  id: number;
  name: string;
  kind: NotifyKind;
  enabled: boolean;

  /** 0 = every FortiGate in the inventory, including ones added after the rule was written. */
  network_device_id: number;
  device_name: string;

  subjects: string;
  threshold: number;
  sustained_polls: number;
  cooldown_minutes: number;
  notify_on_resolve: boolean;
  severity: NotifySeverity;

  recipient_ids: number[];
  recipients: NotifyRecipient[];

  /** How many subjects this rule is in alarm on right now — the state table, surfaced. */
  firing: number;
  created_at: string;
};

export type NotifyRulePayload = {
  name?: string;
  kind?: NotifyKind;
  enabled?: boolean;
  network_device_id?: number;
  subjects?: string;
  threshold?: number;
  sustained_polls?: number;
  cooldown_minutes?: number;
  notify_on_resolve?: boolean;
  severity?: NotifySeverity;
  recipient_ids?: number[];
};

export const ListNotifyRules = async (): Promise<NotifyRule[]> => {
  const res = await baseApi.get("/notify/rules");
  return res.data.data ?? [];
};

export const CreateNotifyRule = async (p: NotifyRulePayload): Promise<NotifyRule> => {
  const res = await baseApi.post("/notify/rules", p);
  return res.data.data;
};

export const UpdateNotifyRule = async (id: number, p: NotifyRulePayload): Promise<NotifyRule> => {
  const res = await baseApi.patch(`/notify/rules/${id}`, p);
  return res.data.data;
};

export const DeleteNotifyRule = async (id: number): Promise<void> => {
  await baseApi.delete(`/notify/rules/${id}`);
};

export const TestNotifyRule = async (id: number): Promise<NotifySendResult> => {
  const res = await baseApi.post(`/notify/rules/${id}/test`);
  return res.data;
};

// ── history & overview ───────────────────────────────────────────────────────

export type NotifyEvent = {
  id: number;
  created_at: string;
  notify_rule_id: number;
  rule_name: string;
  kind: NotifyKind;
  network_device_id: number;
  device_name: string;
  subject: string;
  severity: NotifySeverity;
  state: "firing" | "resolved";
  title: string;
  message: string;
  value: number;
  delivery_status: "sent" | "partial" | "failed" | "no-recipients";
  delivered: number;
  failed: number;
  delivery_detail: string;
};

export type NotifyEventPage = {
  data: NotifyEvent[];
  total: number;
  limit: number;
  offset: number;
};

export type NotifyEventQuery = {
  state?: string;
  kind?: string;
  severity?: string;
  device_id?: number;
  limit?: number;
  offset?: number;
};

export const ListNotifyEvents = async (q: NotifyEventQuery = {}): Promise<NotifyEventPage> => {
  const res = await baseApi.get("/notify/events", { params: q });
  return res.data;
};

export const ClearNotifyEvents = async (beforeDays: number): Promise<{ removed: number }> => {
  const res = await baseApi.delete("/notify/events", { params: { before_days: beforeDays } });
  return res.data;
};

export type NotifyOverview = {
  rules: number;
  rules_enabled: number;
  firing: number;
  channels: number;
  recipients: number;
  events_24h: number;
  failed_24h: number;
  poll_seconds: number;
  /** Whether anything could actually be delivered right now. The page says so plainly. */
  smtp_ready: boolean;
  smtp_error?: string;
  line_ready: boolean;
};

export const GetNotifyOverview = async (): Promise<NotifyOverview> => {
  const res = await baseApi.get("/notify/overview");
  return res.data.data;
};

export type NotifySweepResult = {
  Devices: number;
  Rules: number;
  Fired: number;
  Resolved: number;
  Suppressed: number;
};

/** Runs one sweep now instead of waiting up to a minute for the scheduler. */
export const RunNotifySweep = async (): Promise<NotifySweepResult> => {
  const res = await baseApi.post("/notify/run");
  return res.data.data;
};
