import React, { useCallback, useMemo, useState } from "react";
import {
  FiAlertTriangle, FiArrowRight, FiCheckCircle, FiCornerUpLeft, FiCpu, FiLoader, FiPlay, FiXCircle,
} from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { confirm } from "../../components/ui/confirm";
import {
  DeviceAuditRemediationApply, DeviceAuditRemediationPreview, DeviceAuditRemediationUndo,
  type ApplyPlan, type ApplyResult, type RemediationAdvice, type RemediationPlan,
} from "../../api/auditRemediation";

// Audit / Review ▸ letting the console make the change.
//
// Everything else in this feature stops at "here is the command". This is the part that writes to a
// production firewall, so it is built around the three things that make that defensible:
//
//   ASK FIRST.    Half the useful fixes are shaped "restrict this to <the thing only you know>".
//                 Those become questions with the model's suggested values — drawn from this
//                 device's own interfaces and address objects, never invented — and nothing is
//                 written until they are answered. This is what the AI is FOR here: it used to
//                 return four paragraphs about the change under a button of its own, which nobody
//                 needed twice. Now it fills this form in, says what could break, and says what
//                 gets better, and asking it is the same action as opening the change.
//   CONFIRM WHAT. The confirmation lists the exact objects and attributes, old value → new value.
//                 Not "apply 2 fixes": a firewall is not a thing to change on a summary.
//   UNDO.         Every write is snapshotted into the change ledger first, so one button puts it
//                 back — newest first, which is the only order that restores the state you had.
//
// WHAT IT WILL NOT DO. It does not delete objects or reorder rules: those change what the firewall
// permits by intent rather than by omission, and they belong on the page that shows the surrounding
// rules. It does not write a command the device could not confirm unless that is acknowledged
// separately. And it never applies anything the operator has not just read.

const attrRow = (w: { path: string; mkey?: string; attrs: Record<string, string> }) =>
  // `?? {}` for the same reason the arrays are guarded: Object.entries(null) throws, and a throw
  // here used to take the whole console down rather than this one row.
  Object.entries(w.attrs ?? {}).map(([k, v]) => ({ key: `${w.path}|${w.mkey}|${k}`, attr: k, value: v }));

/** The questions, with whatever the model suggested for each. */
const Questions: React.FC<{
  preview: ApplyPlan;
  advice: RemediationAdvice | null;
  answers: Record<string, string>;
  onChange: (id: string, value: string) => void;
}> = ({ preview, advice, answers, onChange }) => {
  const suggested = useMemo(() => {
    const m = new Map<string, NonNullable<RemediationAdvice["answers"]>[number]>();
    for (const a of advice?.answers ?? []) m.set(a.question_id, a);
    return m;
  }, [advice]);

  return (
    <div className="flex flex-col gap-2.5">
      {(preview.questions ?? []).map((q) => {
        const s = suggested.get(q.id);
        return (
          <div key={q.id} className="rounded-[4px] border hairline-2 surface-sunken p-2.5">
            <p className="text-[11.5px] font-semibold ink">{s?.prompt ?? q.prompt}</p>
            <p className="mt-0.5 font-mono text-[10px] ink-3">
              {q.attr} on {q.path}{q.mkey ? ` ${q.mkey}` : ""} — replaces {q.placeholder}
            </p>

            {(s?.options?.length ?? 0) > 0 && (
              <div className="mt-1.5 flex flex-col gap-1">
                {s!.options!.map((o) => (
                  <button key={o.value} type="button" onClick={() => onChange(q.id, o.value)}
                    className="flex flex-col items-start rounded-[4px] border px-2 py-1.5 text-left transition hover:opacity-80"
                    style={answers[q.id] === o.value
                      ? { borderColor: "#7c3aed", background: "#8b5cf612" }
                      : { borderColor: "var(--shell-border)" }}>
                    <span className="font-mono text-[10.5px] font-semibold ink">{o.value}</span>
                    <span className="text-[10px] ink-3">{o.label}{o.note ? ` — ${o.note}` : ""}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Always a free-text field beside the suggestions. The model proposes; the operator
                decides, and the value they type is the one that gets written. */}
            <input type="text" value={answers[q.id] ?? ""} onChange={(e) => onChange(q.id, e.target.value)}
              placeholder={q.placeholder}
              className="mt-1.5 w-full rounded-[4px] border hairline surface-card px-2 py-1 font-mono text-[11px] ink" />
          </div>
        );
      })}
    </div>
  );
};

export type ApplyFlowProps = {
  deviceId: number;
  plan: RemediationPlan;
  /** The model's help, once it has arrived: suggested values, what could break, what gets better. */
  advice: RemediationAdvice | null;
  /** True while that request is in flight. */
  asking: boolean;
  /** Fetches the advice. Called when the flow is opened, so asking and opening are one action. */
  onOpen: () => void;
  /** Called after a successful apply or undo, so the panel can re-read the control's state. */
  onChanged: () => void;
};

const ApplyFlow: React.FC<ApplyFlowProps> = ({ deviceId, plan, advice, asking, onOpen, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ApplyPlan | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<"preview" | "apply" | "undo" | null>(null);
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((next: Record<string, string>) => {
    setBusy("preview");
    setError(null);
    DeviceAuditRemediationPreview(deviceId, plan.control_id, next)
      .then((r) => setPreview(r.preview))
      .catch((e: unknown) => setError(errorText(e, "Could not work out what this would change")))
      .finally(() => setBusy(null));
  }, [deviceId, plan.control_id]);


  const setAnswer = (id: string, value: string) => {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    // Re-previewing on every answer keeps "what would be written" honest while the form is filled
    // in — the reader watches the confirmation build itself rather than trusting a final screen.
    load(next);
  };

  const writes = preview?.writes ?? [];
  const questions = preview?.questions ?? [];
  const unverified = writes.filter(
    (w) => w.verified === "attribute-unknown" || w.verified === "value-unlisted" || w.verified === "unreadable");

  const apply = async () => {
    // A modal, not just a button that writes. The panel already lists what would be sent, but the
    // last thing between a reader and a production firewall should be a deliberate second action —
    // and it should restate the blast radius rather than assume the list above was read. The same
    // confirm() every other destructive device write in this console goes through.
    const ok = await confirm({
      // A whole sentence per number, not change${s}: a plural glued in as its own hole has no Thai
      // or Chinese rendering — the translated sentence would carry a stray English "s".
      title: writes.length === 1 ? "Write 1 change to this firewall?" : `Write ${writes.length} changes to this firewall?`,
      content: (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] leading-relaxed ink-2">
            This takes effect immediately on the live device. Each change is recorded with what it
            replaced, so it can be put back from here or from the Change Ledger.
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 rounded-[4px] surface-sunken p-2.5">
            {writes.map((w) => (
              <li key={`${w.path}-${w.mkey}`} className="font-mono text-[11px] ink-2">
                <span className="ink">{w.path.replace(/[./]/g, " ")}{w.mkey ? ` ${w.mkey}` : ""}</span>
                {Object.entries(w.attrs ?? {}).map(([k, v]) => (
                  <span key={k} className="block pl-3 ink-3">{k} → {v}</span>
                ))}
              </li>
            ))}
          </ul>
          {advice?.risk && (
            <p className="text-[11.5px] leading-relaxed" style={{ color: "#b45309" }}>{advice.risk}</p>
          )}
        </div>
      ),
      okText: "Write it",
    });
    if (!ok) return;

    setBusy("apply");
    setError(null);
    DeviceAuditRemediationApply(deviceId, plan.control_id, answers, ack)
      .then((r) => {
        setResults(r.results);
        if (r.error) setError(r.error);
        else message.success(`Applied ${r.results.filter((x) => x.ok).length} change(s)`);
        onChanged();
      })
      .catch((e: unknown) => setError(errorText(e, "The change could not be applied")))
      .finally(() => setBusy(null));
  };

  const undo = async () => {
    const ids = (results ?? []).filter((r) => r.ok && r.change_id).map((r) => r.change_id!);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: ids.length === 1 ? "Put 1 change back?" : `Put ${ids.length} changes back?`,
      content: "Each object is restored to the snapshot taken just before it was written, newest "
        + "first. This is itself a change to the live firewall and is recorded as one.",
      okText: "Restore it",
    });
    if (!ok) return;
    setBusy("undo");
    DeviceAuditRemediationUndo(deviceId, ids)
      .then((r) => {
        const bad = r.results.filter((x) => !x.ok);
        if (bad.length) message.error(`${bad.length} change(s) could not be put back`);
        else { message.success("Put back"); setResults(null); }
        onChanged();
      })
      .catch((e: unknown) => message.error(errorText(e, "Could not put the change back")))
      .finally(() => setBusy(null));
  };

  // ── After the write ──
  if (results) {
    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    return (
      <section className="rounded-[5px] border px-3 py-2.5"
        style={failed.length
          ? { borderColor: "#ef444440", background: "#ef444410" }
          : { borderColor: "#10b98140", background: "#10b98110" }}>
        <p className="flex items-center gap-1.5 text-[12px] font-bold"
          style={{ color: failed.length ? "#b91c1c" : "#047857" }}>
          {failed.length ? <FiXCircle size={13} /> : <FiCheckCircle size={13} />}
          {ok} change{ok === 1 ? "" : "s"} written{failed.length ? `, ${failed.length} failed` : ""}
        </p>
        {failed.map((f) => (
          <p key={f.check} className="mt-1 text-[11px] leading-relaxed ink-2">{f.check}: {f.error}</p>
        ))}
        <p className="mt-1 text-[10.5px] ink-3">
          Every one is in the Change Ledger with what it replaced. Rescan to see the control move.
        </p>
        {ok > 0 && (
          <button type="button" onClick={undo} disabled={busy !== null}
            className="mt-2 flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-2.5 py-1.5 text-[11.5px] font-semibold ink-2 transition surface-hover disabled:opacity-50">
            {busy === "undo" ? <FiLoader size={12} className="animate-spin" /> : <FiCornerUpLeft size={12} />}
            Put it back
          </button>
        )}
      </section>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => { setOpen(true); load({}); onOpen(); }}
        className="flex items-center justify-center gap-2 rounded-[5px] border px-3 py-2.5 text-[12px] font-semibold transition hover:opacity-80"
        style={{ borderColor: "#0ea5e940", background: "#0ea5e912", color: "#0369a1" }}>
        <FiCpu size={12} /> Fix this with AI help
      </button>
    );
  }

  return (
    <section className="rounded-[5px] border hairline-2 surface-card p-3">
      <p className="text-[10px] font-extrabold uppercase tracking-wider ink-3">Before it writes anything</p>

      {busy === "preview" && !preview ? (
        <p className="flex items-center gap-2 py-4 text-[11.5px] ink-3">
          <FiLoader size={12} className="animate-spin" /> Reading the firewall…
        </p>
      ) : !preview ? null : (
        <div className="mt-1.5 flex flex-col gap-2.5">
          {questions.length > 0 && (
            <>
              <p className="text-[11.5px] leading-relaxed ink-2">
                {questions.length} value{questions.length === 1 ? "" : "s"} cannot be
                chosen for you — a wrong one here changes who can reach this firewall.
              </p>
              <Questions preview={preview} advice={advice} answers={answers} onChange={setAnswer} />
            </>
          )}

          {writes.length > 0 && (
            <div className="overflow-hidden rounded-[4px] border hairline-2">
              <p className="border-b hairline-2 surface-sunken px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-wider ink-3">
                Exactly what would be written
              </p>
              {writes.map((w) => (
                <div key={`${w.path}-${w.mkey}`} className="border-t hairline-2 px-2.5 py-1.5 first:border-t-0">
                  <p className="font-mono text-[10.5px] font-semibold ink">
                    {w.path.replace(/[./]/g, " ")}{w.mkey ? ` ${w.mkey}` : ""}
                  </p>
                  {attrRow(w).map((a) => (
                    <p key={a.key} className="flex items-center gap-1.5 font-mono text-[10.5px] ink-2">
                      {a.attr} <FiArrowRight size={10} className="ink-3" /> {a.value || "—"}
                    </p>
                  ))}
                  {(w.unanswered?.length ?? 0) > 0 && (
                    <p className="text-[10px] font-semibold" style={{ color: "#b45309" }}>
                      waiting on: {w.unanswered!.join(", ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {(preview.skipped?.length ?? 0) > 0 && (
            <div className="rounded-[4px] border border-dashed hairline px-2.5 py-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wider ink-3">Not done from here</p>
              {preview.skipped!.map((s) => (
                <p key={s.check} className="mt-0.5 text-[10.5px] leading-relaxed ink-3">
                  <span className="font-mono ink-2">{s.check}</span> — {s.reason}
                </p>
              ))}
            </div>
          )}

          {unverified.length > 0 && (
            <label className="flex items-start gap-2 rounded-[4px] border px-2.5 py-2 text-[11px] leading-relaxed"
              style={{ borderColor: "#ef444440", background: "#ef444410" }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
              <span className="ink-2">
                This device did not confirm the command for {unverified.map((w) => w.check).join(", ")}.
                Apply it anyway.
              </span>
            </label>
          )}

          {asking && !advice && (
            <p className="flex items-center gap-2 text-[11px] ink-3">
              <FiLoader size={12} className="animate-spin" /> Asking the AI what this changes…
            </p>
          )}
          {advice?.benefit && (
            <p className="rounded-[4px] border px-2.5 py-2 text-[11px] leading-relaxed ink-2"
              style={{ borderColor: "#10b98140", background: "#10b98110" }}>
              <b style={{ color: "#047857" }}>Once done — </b>{advice.benefit}
              <span className="ml-1 opacity-60">(AI)</span>
            </p>
          )}
          {advice?.risk && (
            <p className="flex items-start gap-1.5 rounded-[4px] border px-2.5 py-2 text-[11px] leading-relaxed ink-2"
              style={{ borderColor: "#f59e0b45", background: "#f59e0b12" }}>
              <FiAlertTriangle size={12} className="mt-0.5 shrink-0" style={{ color: "#b45309" }} />
              <span>{advice.risk}<span className="ml-1 opacity-60">(AI)</span></span>
            </p>
          )}

          {error && (
            <p className="rounded-[4px] border border-red-300 bg-red-50 px-2.5 py-2 text-[11px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button type="button" onClick={apply}
              disabled={!preview.ready || busy !== null || (unverified.length > 0 && !ack)}
              className="flex items-center gap-1.5 rounded-[5px] px-3 py-2 text-[12px] font-semibold text-white transition disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#ef4444,#f43f5e)" }}>
              {busy === "apply" ? <FiLoader size={12} className="animate-spin" /> : <FiPlay size={12} />}
              Confirm and write to {plan.control_id === "" ? "the firewall" : "this firewall"}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy !== null}
              className="rounded-[5px] border hairline px-3 py-2 text-[12px] font-semibold ink-2 transition surface-hover">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

const errorText = (e: unknown, fallback: string): string => {
  const err = e as { code?: string; response?: { data?: { error?: unknown } } };
  const detail = err?.response?.data?.error;
  if (typeof detail === "string" && detail.trim() !== "") return detail;
  if (err?.code === "ECONNABORTED") return "The firewall took too long to answer — try again.";
  return fallback;
};

export default ApplyFlow;
