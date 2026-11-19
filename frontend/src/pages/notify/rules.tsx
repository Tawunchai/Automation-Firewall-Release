import React, { useEffect, useMemo, useState } from "react";
import {
  FiActivity, FiAlertTriangle, FiBell, FiCheck, FiCpu, FiEdit2, FiPlus, FiSend, FiTrash2, FiZap,
} from "react-icons/fi";
import Modal from "../../components/ui/Modal";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { message } from "../../components/ui/toast";
import confirm from "../../components/ui/confirm";
import {
  CreateNotifyRule, DeleteNotifyRule, TestNotifyRule, UpdateNotifyRule,
  type NotifyChannel, type NotifyKind, type NotifyKindInfo, type NotifyRecipient,
  type NotifyRule, type NotifyRulePayload, type NotifySeverity,
} from "../../api/notify";
import type { NetworkDevice } from "../../api/device";
import {
  cooldownText, groupKinds, muteReason, scopeText, severityChip, sustainText, thresholdText,
} from "./format";
import { apiErrorDetail } from "../../api/errorText";

// Alert rules — "what is worth being told about, and who hears it".
//
// The list is a status board, not a settings page: a rule that is currently in alarm says so, and a
// rule that could never reach anybody says THAT, which is the one thing this screen has to be
// honest about. An enabled, correct, completely mute rule is the failure mode that would otherwise
// only be discovered during the outage it was written for.

type Props = {
  rules: NotifyRule[];
  kinds: NotifyKindInfo[];
  pollSeconds: number;
  channels: NotifyChannel[];
  recipients: NotifyRecipient[];
  devices: NetworkDevice[];
  loading: boolean;
  onChanged: () => void;
};

const Rules: React.FC<Props> = ({
  rules, kinds, pollSeconds, channels, recipients, devices, loading, onChanged,
}) => {
  const [editing, setEditing] = useState<NotifyRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);

  const kindByName = useMemo(
    () => new Map(kinds.map((k) => [k.kind, k])),
    [kinds],
  );

  const toggle = async (r: NotifyRule) => {
    try {
      await UpdateNotifyRule(r.id, { enabled: !r.enabled });
      onChanged();
    } catch (e) {
      message.error(apiErrorDetail(e, "Could not change the rule"));
    }
  };

  const remove = async (r: NotifyRule) => {
    const ok = await confirm({
      title: `Delete "${r.name}"?`,
      content: "The history of what it already sent is kept. Only the rule and its live state go.",
      okText: "Delete rule",
    });
    if (!ok) return;
    try {
      await DeleteNotifyRule(r.id);
      message.success("Rule deleted");
      onChanged();
    } catch (e) {
      message.error(apiErrorDetail(e, "Could not delete the rule"));
    }
  };

  const test = async (r: NotifyRule) => {
    setTesting(r.id);
    try {
      const res = await TestNotifyRule(r.id);
      if (res.status === "sent") message.success(`Test sent to ${res.sent} recipient(s)`);
      else if (res.status === "partial") message.warning(`${res.sent} sent, ${res.failed} failed`);
      else message.error(res.error || "Nothing was delivered");
    } catch (e) {
      message.error(apiErrorDetail(e, "The test could not be sent"));
    } finally {
      setTesting(null);
    }
  };

  if (loading) {
    return <div className="state-block py-14"><p className="state-title m-0">Loading alert rules…</p></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="t-meta m-0">
          Every enabled rule is checked against each firewall once every {pollSeconds} seconds.
        </p>
        <button type="button" className="btn btn-accent btn-sm" onClick={() => setCreating(true)}>
          <FiPlus size={12} /> New alert rule
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="state-block py-14">
          <span className="state-icon"><FiZap size={18} /></span>
          <p className="state-title m-0">No alert rules yet</p>
          <p className="state-text m-0">
            Nothing is being watched. A good first pair is “Port Up / Down” on every device, and CPU
            over 85% held for two checks.
          </p>
          <button type="button" className="btn btn-soft btn-sm mt-1" onClick={() => setCreating(true)}>
            <FiPlus size={12} /> Add the first rule
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => {
            const kind = kindByName.get(r.kind);
            const mute = muteReason(r, channels);
            return (
              <div
                key={r.id}
                className="rounded-sm border hairline-2 surface-card p-3 shadow-sm"
                style={r.firing > 0 ? { borderColor: "rgba(239,68,68,0.45)" } : undefined}
              >
                <div className="flex flex-wrap items-start gap-2">
                  <span
                    className="medallion mt-0.5 h-7 w-7 shrink-0 text-[13px]"
                    style={
                      r.firing > 0
                        ? { background: "rgba(239,68,68,0.12)", color: "#ef4444" }
                        : { background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" }
                    }
                  >
                    {kind?.family === "resource" ? <FiCpu /> : <FiActivity />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[13px] font-bold ink">{r.name}</span>
                      <span className="chip">{kind?.title ?? r.kind}</span>
                      <span className={severityChip(r.severity)}>{r.severity}</span>
                      {!r.enabled && <span className="chip chip-warn">off</span>}
                      {r.firing > 0 && (
                        <span className="chip chip-solid chip-danger">
                          firing on {r.firing}
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-[11.5px] ink-3">
                      {scopeText(r)}
                      {kind?.has_threshold ? ` · ${thresholdText(r, kind)}` : ""}
                      {` · ${sustainText(r.sustained_polls, pollSeconds)}`}
                      {` · ${cooldownText(r.cooldown_minutes)}`}
                      {r.notify_on_resolve ? " · says when it recovers" : " · silent on recovery"}
                    </p>

                    <p className="mt-1 flex flex-wrap items-center gap-1 text-[11.5px] ink-3">
                      {r.recipients.length === 0 ? (
                        <span className="chip chip-danger">no recipient</span>
                      ) : (
                        r.recipients.map((rec) => (
                          <span key={rec.id} className={rec.enabled ? "chip" : "chip chip-warn"}>
                            {rec.name}
                            <span className="opacity-60"> · {rec.channel_type}</span>
                          </span>
                        ))
                      )}
                    </p>

                    {mute && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-amber-600 dark:text-amber-400">
                        <FiAlertTriangle size={12} className="shrink-0" /> {mute}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggle(r)}>
                      {r.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-soft btn-sm"
                      onClick={() => void test(r)}
                      disabled={testing === r.id || r.recipients.length === 0}
                      title={r.recipients.length === 0 ? "Attach a recipient first" : "Send this rule's own message as a test"}
                    >
                      <FiSend size={12} /> {testing === r.id ? "…" : "Test"}
                    </button>
                    <button type="button" className="btn-icon" onClick={() => setEditing(r)} title="Edit rule">
                      <FiEdit2 size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon btn-icon--danger"
                      onClick={() => void remove(r)}
                      title="Delete rule"
                    >
                      <FiTrash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <RuleForm
        open={creating || editing !== null}
        rule={editing}
        kinds={kinds}
        pollSeconds={pollSeconds}
        recipients={recipients}
        devices={devices}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { setCreating(false); setEditing(null); onChanged(); }}
      />
    </div>
  );
};

// ── the rule dialog ──────────────────────────────────────────────────────────

const RuleForm: React.FC<{
  open: boolean;
  rule: NotifyRule | null;
  kinds: NotifyKindInfo[];
  pollSeconds: number;
  recipients: NotifyRecipient[];
  devices: NetworkDevice[];
  onClose: () => void;
  onSaved: () => void;
}> = ({ open, rule, kinds, pollSeconds, recipients, devices, onClose, onSaved }) => {
  const [kind, setKind] = useState<NotifyKind>("interface-link");
  const [name, setName] = useState("");
  const [deviceId, setDeviceId] = useState(0);
  const [subjects, setSubjects] = useState("");
  const [threshold, setThreshold] = useState(0);
  const [sustained, setSustained] = useState(2);
  const [cooldown, setCooldown] = useState(30);
  const [onResolve, setOnResolve] = useState(true);
  const [severity, setSeverity] = useState<NotifySeverity>("warning");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const info = useMemo(() => kinds.find((k) => k.kind === kind), [kinds, kind]);

  useEffect(() => {
    if (!open) return;
    setError("");
    if (rule) {
      setKind(rule.kind);
      setName(rule.name);
      setDeviceId(rule.network_device_id);
      setSubjects(rule.subjects);
      setThreshold(rule.threshold);
      setSustained(rule.sustained_polls);
      setCooldown(rule.cooldown_minutes);
      setOnResolve(rule.notify_on_resolve);
      setSeverity(rule.severity);
      setPicked(new Set(rule.recipient_ids));
      return;
    }
    const first = kinds[0];
    setKind((first?.kind as NotifyKind) ?? "interface-link");
    setName("");
    setDeviceId(0);
    setSubjects("");
    setThreshold(first?.threshold_default ?? 0);
    setSustained(2);
    setCooldown(30);
    setOnResolve(true);
    setSeverity(first?.default_severity ?? "warning");
    // Every recipient is pre-ticked on a NEW rule. The common case is "tell the people who are
    // already listed", and a rule saved with nobody attached is the mute rule this page warns about.
    setPicked(new Set(recipients.filter((r) => r.enabled).map((r) => r.id)));
  }, [open, rule, kinds, recipients]);

  // Changing the kind changes what the threshold MEANS, so it has to move to that kind's default
  // rather than carrying 85 across from a CPU rule into a licence-expiry one (85 days).
  const chooseKind = (k: NotifyKindInfo) => {
    setKind(k.kind);
    setThreshold(k.threshold_default ?? 0);
    setSeverity(k.default_severity);
    if (!k.has_subjects) setSubjects("");
    if (!name.trim()) setName(k.title);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    const payload: NotifyRulePayload = {
      name: name.trim() || info?.title,
      enabled: rule?.enabled ?? true,
      network_device_id: deviceId,
      subjects: info?.has_subjects ? subjects : "",
      threshold: info?.has_threshold ? threshold : 0,
      sustained_polls: sustained,
      cooldown_minutes: cooldown,
      notify_on_resolve: onResolve,
      severity,
      recipient_ids: Array.from(picked),
    };
    try {
      if (rule) await UpdateNotifyRule(rule.id, payload);
      else await CreateNotifyRule({ ...payload, kind });
      message.success(rule ? "Rule updated" : "Rule created");
      onSaved();
    } catch (e) {
      setError(apiErrorDetail(e, "Could not save the rule"));
    } finally {
      setSaving(false);
    }
  };

  const togglePick = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal
      open={open}
      title={rule ? `Edit “${rule.name}”` : "New alert rule"}
      icon={<FiBell />}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <button type="button" className="btn btn-soft btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-accent btn-sm" onClick={() => void save()} disabled={saving}>
            <FiCheck size={12} /> {saving ? "Saving…" : rule ? "Save rule" : "Create rule"}
          </button>
        </>
      }
    >
      {error && (
        <div className="banner banner-danger mb-3">
          <FiAlertTriangle size={14} className="shrink-0" /><span>{error}</span>
        </div>
      )}

      {/* ── What to watch ── */}
      {rule ? (
        <div className="banner banner-accent mb-3">
          <FiActivity size={14} className="shrink-0" />
          <span>
            Watching <b>{info?.title ?? rule.kind}</b>. What a rule watches cannot be changed after
            it is created — its threshold and its stored state mean different things per check.
          </span>
        </div>
      ) : (
        <>
          <span className="field-label">What to watch</span>
          <div className="space-y-3">
            {groupKinds(kinds).map((group) => (
              <div key={group.title}>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.09em] ink-3">
                  {group.title} <span className="font-normal normal-case tracking-normal">· {group.hint}</span>
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {group.kinds.map((k) => {
                    const on = k.kind === kind;
                    return (
                      <button
                        key={k.kind}
                        type="button"
                        onClick={() => chooseKind(k)}
                        className="rounded-[4px] border p-2.5 text-left transition hairline surface-hover"
                        style={on ? { borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 8%, transparent)" } : undefined}
                      >
                        <p className="m-0 text-[12.5px] font-bold" style={on ? { color: "var(--accent)" } : undefined}>
                          {k.title}
                        </p>
                        <p className="m-0 mt-0.5 text-[11px] leading-relaxed ink-3">{k.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Scope ── */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="rule-name" className="field-label">Rule name</label>
          <input id="rule-name"
            className="shell-input h-9 w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={info?.title ?? "Alert"}
          />
        </div>
        <div>
          <label htmlFor="device" className="field-label">Device</label>
          <MinimalSelect id="device"
            ariaLabel="Device"
            className="w-full"
            value={String(deviceId)}
            onChange={(v) => setDeviceId(Number(v))}
            options={[
              { value: "0", label: "Every device (including ones added later)" },
              ...devices.map((d) => ({ value: String(d.id), label: `${d.name} (${d.mgmt_ip})` })),
            ]}
          />
        </div>
      </div>

      {info?.has_subjects && (
        <div className="mt-3">
          <label htmlFor="field" className="field-label">{info.subject_label ?? "Subjects"}</label>
          <input id="field"
            className="shell-input h-9 w-full font-mono text-[11.5px]"
            value={subjects}
            onChange={(e) => setSubjects(e.target.value)}
            placeholder="port1,port2 — blank means all"
          />
        </div>
      )}

      {/* ── Trigger ── */}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {info?.has_threshold && (
          <div>
            <label htmlFor="threshold" className="field-label">Threshold ({info.threshold_unit})</label>
            <input id="threshold"
              type="number"
              className="shell-input h-9 w-full"
              value={threshold}
              min={info.threshold_min}
              max={info.threshold_max}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </div>
        )}
        <div>
          <label htmlFor="hold-for" className="field-label">Hold for</label>
          <MinimalSelect id="hold-for"
            ariaLabel="Hold for"
            className="w-full"
            value={String(sustained)}
            onChange={(v) => setSustained(Number(v))}
            options={[1, 2, 3, 5, 10, 15, 30].map((n) => ({
              value: String(n), label: `${n} check${n === 1 ? "" : "s"} (${n * pollSeconds}s)`,
            }))}
          />
          <p className="field-hint">{sustainText(sustained, pollSeconds)}</p>
        </div>
        <div>
          <label htmlFor="repeat-at-most-every" className="field-label">Repeat at most every</label>
          <MinimalSelect id="repeat-at-most-every"
            ariaLabel="Repeat at most every"
            className="w-full"
            value={String(cooldown)}
            onChange={(v) => setCooldown(Number(v))}
            options={[0, 5, 15, 30, 60, 180, 360, 720, 1440].map((n) => ({
              value: String(n), label: n === 0 ? "every check" : `${n} min`,
            }))}
          />
          <p className="field-hint">Recovery messages are never held back.</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div role="group" aria-labelledby="severity-label">
          <span id="severity-label" className="field-label">Severity</span>
          <div className="flex gap-1.5">
            {(["info", "warning", "critical"] as NotifySeverity[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                className="rounded-[4px] border px-2.5 py-1 text-[11.5px] font-semibold capitalize transition hairline surface-hover"
                style={severity === s ? { borderColor: "var(--accent)", color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 8%, transparent)" } : undefined}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-[12px] ink-2">
          <input type="checkbox" checked={onResolve} onChange={(e) => setOnResolve(e.target.checked)} className="h-3.5 w-3.5" />
          Also send a message when it recovers
        </label>
      </div>

      {/* ── Who hears it ── */}
      <span className="field-label mt-4">Send to</span>
      {recipients.length === 0 ? (
        <div className="banner banner-warn">
          <FiAlertTriangle size={14} className="shrink-0" />
          <span>
            No recipient exists yet. Add one under the <b>Channels</b> tab, or this rule will fire
            into nothing.
          </span>
        </div>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {recipients.map((r) => {
            const on = picked.has(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => togglePick(r.id)}
                className="flex items-center gap-2 rounded-[4px] border p-2 text-left transition hairline surface-hover"
                style={on ? { borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 8%, transparent)" } : undefined}
              >
                <span
                  className="grid h-4 w-4 shrink-0 place-items-center rounded border"
                  style={on ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" } : { borderColor: "var(--shell-border)" }}
                >
                  {on && <FiCheck size={10} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold ink">{r.name}</span>
                  <span className="block truncate text-[10.5px] ink-3">
                    {r.channel_name} · {r.channel_type}
                    {!r.enabled && " · disabled"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
};

export default Rules;
