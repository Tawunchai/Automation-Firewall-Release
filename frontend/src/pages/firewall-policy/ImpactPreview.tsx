import React, { useState } from "react";
import { FiActivity, FiAlertTriangle, FiArrowRight, FiCheckCircle } from "react-icons/fi";
import Modal from "../../components/ui/Modal";
import { message } from "../../components/ui/toast";
import {
  DevicePreviewPolicyImpact, type ImpactPreviewOp, type ImpactPreviewRequest, type ImpactPreviewResult,
} from "../../api/impactPreview";
import type { PolicyPayload } from "../../api/policyObject";

// "What would this change actually have done" — one button on the create/edit form, beside Save,
// that replays the firewall's OWN recent real traffic through the current policy table and the one
// this form is about to write, before anything is written. See
// backend/services/fortigate_impact_preview.go for the engine and why real sessions, not a
// synthetic sweep.
//
// Kept as its own file rather than folded into create.tsx: that file already carries the whole
// policy form and sits close to this repo's layout-budget ceiling (see
// backend/test/layout-budget.json) — a self-contained button + its own dialog is a two-line import
// there, not another few hundred lines in the file already closest to the limit.

type Props = {
  deviceId: number;
  op: Extract<ImpactPreviewOp, "create" | "update">;
  /** Required when op is "update" — the policy being edited. */
  policyId?: number;
  policy: PolicyPayload;
  disabled?: boolean;
};

const verdictTone = (v: string): string =>
  v === "allowed" ? "text-emerald-600 dark:text-emerald-400"
    : v === "denied" ? "text-red-600 dark:text-red-400"
    : "text-amber-600 dark:text-amber-400";

const ImpactPreviewButton: React.FC<Props> = ({ deviceId, op, policyId, policy, disabled }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImpactPreviewResult | null>(null);

  const run = async () => {
    const body: ImpactPreviewRequest = { op, policy };
    if (op === "update") body.policy_id = policyId;
    setOpen(true);
    setLoading(true);
    setResult(null);
    try {
      const r = await DevicePreviewPolicyImpact(deviceId, body);
      setResult(r);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not preview the impact of this change");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-soft btn-sm"
        disabled={disabled}
        onClick={() => void run()}
        title="Replay recent real traffic through this change before saving it"
      >
        <FiActivity size={13} /> Preview Impact
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Impact Preview — recent real traffic, replayed"
        icon={<FiActivity />}
        width="max-w-2xl"
        bodyClassName="max-h-[70vh] overflow-y-auto"
        footer={<button className="btn btn-sm" onClick={() => setOpen(false)}>Close</button>}
      >
        {loading ? (
          <div className="flex items-center gap-2 t-meta py-6">
            <span className="shell-skeleton h-4 w-4 rounded-full" /> Replaying recent sessions against this change…
          </div>
        ) : !result ? null : (
          <div className="space-y-4">
            <p className="t-meta m-0">
              Replayed {result.total_sampled} real session{result.total_sampled === 1 ? "" : "s"} from this
              firewall's own recent traffic log against the policy table as it is now and as this change would
              leave it. Nothing was written to the device.
            </p>

            {result.warnings?.map((w) => (
              <div key={w} className="banner banner-warn">
                <FiAlertTriangle size={14} className="shrink-0" /> <span>{w}</span>
              </div>
            ))}

            <div className="grid grid-cols-3 gap-3">
              <div className="panel p-3 text-center">
                <p className="t-label m-0">Sessions affected</p>
                <p className="m-0 mt-1 text-[22px] font-semibold tabular-nums ink">{result.changed}</p>
              </div>
              <div className="panel p-3 text-center">
                <p className="t-label m-0">Newly allowed</p>
                <p className="m-0 mt-1 text-[22px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {result.newly_allowed}
                </p>
              </div>
              <div className="panel p-3 text-center">
                <p className="t-label m-0">Newly blocked</p>
                <p className="m-0 mt-1 text-[22px] font-semibold tabular-nums text-red-600 dark:text-red-400">
                  {result.newly_blocked}
                </p>
              </div>
            </div>

            {result.changed === 0 ? (
              <div className="flex items-center gap-2 t-meta py-2">
                <FiCheckCircle className="shrink-0 text-emerald-500" size={15} />
                None of the recently-seen traffic this firewall has handled would be affected by this change.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="t-label">
                      <th className="px-2 py-1 text-left">Session</th>
                      <th className="px-2 py-1 text-left">Before</th>
                      <th className="px-2 py-1 text-left" />
                      <th className="px-2 py-1 text-left">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.samples.map((s, i) => (
                      <tr key={i} className="border-t hairline-2">
                        <td className="px-2 py-1.5 font-mono">
                          {s.src_ip}{s.src_port ? `:${s.src_port}` : ""} <FiArrowRight className="inline" size={10} />{" "}
                          {s.dst_ip}{s.dst_port ? `:${s.dst_port}` : ""} <span className="t-meta">({s.protocol})</span>
                        </td>
                        <td className={`px-2 py-1.5 font-semibold ${verdictTone(s.before)}`}>{s.before}</td>
                        <td className="px-2 py-1.5"><FiArrowRight size={12} /></td>
                        <td className={`px-2 py-1.5 font-semibold ${verdictTone(s.after)}`}>{s.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.changed > result.samples.length && (
                  <p className="t-meta mt-2">
                    showing {result.samples.length} of {result.changed} affected sessions
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
};

export default ImpactPreviewButton;
