import React, { useState } from "react";
import { FiClock, FiUserCheck, FiX } from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { DeviceAcceptFinding, type AuditFinding } from "../../api/policyObject";
import { formatDate } from "../../lib/datetime";

// Accepting a finding — the thing an assessor asks for and most audit tools do not have.
//
// It is not a mute button, and the UI is built so it cannot be mistaken for one:
//
//   · a reason is required, and a short one is refused by the server;
//   · an expiry is required and cannot exceed the cap, so "temporary" cannot silently become
//     permanent;
//   · the accepted finding STAYS on the page afterwards, carrying the name of whoever accepted it.
//
// The dialog is deliberately a little heavy. Signing off on a risk should not feel like dismissing
// a notification.

const PRESETS = [30, 60, 90, 180];

export const AcceptDialog: React.FC<{
  deviceId: number;
  finding: AuditFinding;
  maxDays: number;
  onClose: () => void;
  onDone: () => void;
}> = ({ deviceId, finding, maxDays, onClose, onDone }) => {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);

  const tooShort = reason.trim().length < 10;
  const expiresOn = formatDate(new Date(Date.now() + days * 86400_000));

  const submit = async () => {
    if (tooShort || busy) return;
    setBusy(true);
    try {
      await DeviceAcceptFinding(deviceId, {
        check: finding.check, subject: finding.subject, reason: reason.trim(), days,
      });
      message.success("Risk accepted — the finding stays on the report with your name on it");
      onDone();
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      message.error(err.response?.data?.error ?? err.message ?? "Could not record the acceptance");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      role="dialog" aria-modal="true" aria-label="Accept this risk">
      <div className="w-full max-w-lg overflow-hidden rounded-sm border hairline-2 surface-card shadow-xl">
        <div className="flex items-start gap-3 border-b hairline-2 px-4 py-3">
          <FiUserCheck className="mt-0.5 shrink-0 text-violet-500" size={16} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold ink">Accept this risk</p>
            <p className="mt-0.5 truncate font-mono text-[11px] ink-3">{finding.subject}</p>
          </div>
          <button type="button" onClick={onClose} className="ink-3 transition hover:opacity-70" aria-label="Close">
            <FiX size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-4 py-4">
          <p className="rounded-[4px] border hairline-2 surface-sunken px-3 py-2 text-[11.5px] leading-relaxed ink-2">
            The finding is <strong>not removed</strong>. It stays on the report and in the evidence pack, marked as
            accepted and carrying your name, your reason and the expiry date below.
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide ink-2">
              Why is this acceptable? An assessor will read this
            </span>
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="e.g. legacy payment terminal needs this path until the Q4 migration; compensating control is the IPS profile on the upstream rule"
              className="rounded-[4px] border hairline surface-sunken px-3 py-2 text-[12px] ink outline-none focus:border-violet-400"
            />
            {tooShort && reason.length > 0 && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                Give at least 10 characters — "n/a" is not a justification anyone can use
              </span>
            )}
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide ink-2">
              How long, at most {maxDays} days
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESETS.filter((d) => d <= maxDays).map((d) => (
                <button key={d} type="button" onClick={() => setDays(d)}
                  className="rounded-[4px] px-2.5 py-1 text-[11.5px] font-semibold transition"
                  style={days === d
                    ? { background: "#7c3aed", color: "white" }
                    : { background: "#94a3b81a", color: "#64748b" }}>
                  {d} days
                </button>
              ))}
              <span className="ml-1 flex items-center gap-1 text-[11.5px] ink-3">
                <FiClock size={11} /> expires {expiresOn}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t hairline-2 px-4 py-3">
          <button type="button" onClick={onClose}
            className="rounded-[4px] border hairline px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={tooShort || busy}
            className="rounded-[4px] px-3 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-40"
            style={{ background: "#7c3aed" }}>
            {busy ? "Recording…" : "Accept and sign"}
          </button>
        </div>
      </div>
    </div>
  );
};

/** The banner shown on a finding that already carries an acceptance. */
export const AcceptedBanner: React.FC<{ accepted: NonNullable<AuditFinding["accepted"]> }> = ({ accepted }) => (
  <div className="mt-2.5 rounded-[4px] border border-violet-300/50 bg-violet-500/10 px-3 py-2">
    <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-violet-700 dark:text-violet-300">
      <FiUserCheck size={12} /> Risk accepted by {accepted.approved_by}
      <span className="font-normal opacity-80">· expires {formatDate(accepted.expires_at)}</span>
    </p>
    <p className="mt-1 text-[11.5px] leading-relaxed text-violet-900/80 dark:text-violet-200/80">{accepted.reason}</p>
  </div>
);
