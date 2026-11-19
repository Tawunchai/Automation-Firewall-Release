import React, { useState } from "react";
import {
  FiAlertTriangle, FiCheckCircle, FiClock, FiHardDrive, FiMessageSquare, FiShield, FiXCircle,
} from "react-icons/fi";
import Modal from "../../components/ui/Modal";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import {
  ReviewChangeRequest, WithdrawChangeRequest,
  type ChangeRequest, type ReviewResult,
} from "../../api/changeRequests";
import { formatDateTime } from "../../lib/datetime";
import ActionSummary from "./action";
import {
  OUTCOME_LABELS, REVIEW_BLOCK_LABELS, STATUS_LABELS,
  formatBody, outcomeTone, reviewability, statusTone, withdrawability, type Viewer,
} from "./model";

// One request, opened.
//
// ── The order of this dialog is the whole argument ───────────────────────────
//
// WHAT IT DOES comes first, derived from the stored HTTP request, with the device it lands on, the
// route, and the exact payload that will be written. Only then the requester's own words, under a
// heading that says whose they are. An approver who reads a sentence and presses Approve has
// approved a sentence; the request is the method, the path and the body.
//
// ── Where each piece of text comes from ─────────────────────────────────────
//
// `title` is NOT the requester's any more. services.PrepareChangeRequest derives it from the
// method and the target, in the Change Ledger's vocabulary, and moves whatever the requester typed
// into `reason` prefixed with "Requester's own title". So the title belongs in the first section,
// as the system's own record of the write, and `reason` is the only field in the second.
//
// It is shown rather than relied upon, because a row raised before that change still holds a
// requester-typed title — and the derived summary beside it is then visibly a different sentence,
// which is exactly the discrepancy an approver should see.
//
// ── Why the dialog stays open after a decision ───────────────────────────────
//
// Because two of the five answers are "the approval is recorded and the change is NOT on the
// firewall" (HTTP 207 and 502), and a dialog that closes on a toast is a dialog whose message was
// missed. The outcome is rendered in place, with the device's own refusal, and the reviewer closes
// it themselves.

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  hint?: string;
  tone?: "plain" | "quote";
  children: React.ReactNode;
}> = ({ icon, title, hint, tone = "plain", children }) => (
  <section
    className={`rounded-[6px] border hairline p-3 ${tone === "quote" ? "surface-sunken" : "surface-card"}`}
  >
    <h3 className="t-label m-0 mb-2 flex items-center gap-1.5">
      {icon}
      {title}
    </h3>
    {hint && <p className="t-meta m-0 mb-2">{hint}</p>}
    {children}
  </section>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-0.5">
    <span className="t-label shrink-0" style={{ minWidth: "7.5rem" }}>{label}</span>
    <span className="min-w-0 text-[12px] ink-2">{children}</span>
  </div>
);

const RequestDetail: React.FC<{
  request: ChangeRequest;
  viewer: Viewer;
  onClose: () => void;
  /** The row changed on the server — the list has to re-read rather than guess. */
  onChanged: () => void;
}> = ({ request, viewer, onClose, onChanged }) => {
  const [note, setNote] = useState("");
  const [applyAt, setApplyAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const now = new Date();
  const block = reviewability(request, viewer, now);
  const withdraw = withdrawability(request, viewer);
  const tone = statusTone(request.status);
  const body = formatBody(request.body);
  const deviceName = request.network_device?.name ?? "";

  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await ReviewChangeRequest(request.id, {
        approve,
        note,
        // A window is only meaningful on an approval, and the server ignores it on a rejection.
        scheduled_for: approve && applyAt !== "" ? new Date(applyAt).toISOString() : null,
      });
      setResult(res);
      const kind = outcomeTone(res.outcome).toast;
      message[kind](res.message);
      onChanged();
    } catch (e: unknown) {
      // A 409 (self-approval, already reviewed, expired) and a 403 land here. The server writes
      // these sentences for a person to read, so they are shown as they are.
      setError(apiErrorText(e, "The review could not be recorded"));
    } finally {
      setBusy(false);
    }
  };

  const doWithdraw = async () => {
    setBusy(true);
    setError(null);
    try {
      const msg = await WithdrawChangeRequest(request.id);
      message.success(msg);
      onChanged();
      onClose();
    } catch (e: unknown) {
      setError(apiErrorText(e, "The request could not be withdrawn"));
      setConfirmWithdraw(false);
    } finally {
      setBusy(false);
    }
  };

  const outcome = result ? outcomeTone(result.outcome) : null;

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      icon={<FiShield size={16} />}
      bodyClassName="max-h-[70vh] overflow-y-auto"
      title={
        <div className="min-w-0">
          <p className="t-label m-0">Change request</p>
          {/* No `truncate` here: ActionSummary wraps, and clipping the object's own key is the one
              thing this line must not do. */}
          <p className="m-0 text-[14px] font-semibold ink">
            <ActionSummary request={request} size="lg" />
          </p>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {withdraw === "ok" && !result && !confirmWithdraw && (
            <button type="button" className="btn btn-soft" disabled={busy}
              onClick={() => setConfirmWithdraw(true)}>
              Withdraw this request
            </button>
          )}
          {block === "ok" && !result && (
            <>
              <button type="button" className="btn btn-danger" disabled={busy}
                onClick={() => void decide(false)}>
                Reject
              </button>
              <button type="button" className="btn btn-accent" disabled={busy}
                onClick={() => void decide(true)}>
                {applyAt === "" ? "Approve and apply" : "Approve for the window"}
              </button>
            </>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* ── 1. What it does. The server's answer, not the requester's. ───────────────── */}
        <Section
          icon={<FiShield size={12} />}
          title="What this request does"
          hint="Derived from the stored request, not from what the requester called it."
        >
          <p className="m-0 mb-2">
            <ActionSummary request={request} size="lg" />
          </p>
          <Field label="On device">
            {deviceName !== "" ? (
              <span className="inline-flex items-center gap-1.5 font-semibold ink">
                <FiHardDrive size={12} />
                {deviceName}
              </span>
            ) : (
              // A sentence is never split around an interpolated value: the dictionary would hold
              // two half-sentences, and Thai and Chinese do not put the value where English does.
              <>
                <span className="ink-3">This device is no longer in the inventory</span>
                <code className="t-mono ml-1.5 text-[11px] ink-3">{String(request.network_device_id)}</code>
              </>
            )}
          </Field>
          <Field label="Request">
            <code className="t-mono break-all text-[11px]">{`${request.method} ${request.path}`}</code>
          </Field>
          <Field label="Resource">
            <code className="t-mono text-[11px]">
              {request.resource_key !== "" ? `${request.resource_type}/${request.resource_key}` : request.resource_type}
            </code>
          </Field>
          <Field label="Recorded as">
            {/* The server's own derived summary, verbatim and untranslated — it is what the
                database holds and what an audit of this queue would quote. */}
            <code className="t-mono text-[11px]">{request.title}</code>
          </Field>
          {body !== "" && (
            <div className="mt-2">
              <p className="t-label m-0 mb-1">Payload to be written</p>
              <pre className="max-h-64 overflow-auto rounded-[4px] surface-sunken p-2.5 font-mono text-[11px] leading-5 ink-2">
                {body}
              </pre>
            </div>
          )}
        </Section>

        {/* ── 2. The requester's words, labelled as such. ──────────────────────────────── */}
        <Section
          icon={<FiMessageSquare size={12} />}
          title="What the requester said"
          hint="The requester's own wording. It describes their intent, not what the request will do."
          tone="quote"
        >
          {request.reason !== "" ? (
            <p className="m-0 whitespace-pre-wrap text-[12px] leading-5 ink-2">{request.reason}</p>
          ) : (
            <p className="m-0 text-[12px] ink-3">The requester gave no reason.</p>
          )}
        </Section>

        {/* ── 3. Where it stands. ──────────────────────────────────────────────────────── */}
        <Section icon={<FiClock size={12} />} title="Where it stands">
          <Field label="Status">
            <span className={`chip ${tone.chip} text-[10.5px]`}>{STATUS_LABELS[request.status]}</span>
          </Field>
          <Field label="Raised by">
            <code className="t-mono text-[11px]">{request.requested_by}</code>
            {` · ${formatDateTime(request.requested_at)}`}
          </Field>
          {request.status === "pending" && (
            <Field label="Expires">{formatDateTime(request.expires_at)}</Field>
          )}
          {request.scheduled_for && (
            <Field label="Window">{formatDateTime(request.scheduled_for)}</Field>
          )}
          {request.reviewed_at && (
            <Field label="Reviewed by">
              <code className="t-mono text-[11px]">{request.reviewed_by ?? ""}</code>
              {` · ${formatDateTime(request.reviewed_at)}`}
            </Field>
          )}
          {request.review_note && <Field label="Review note">{request.review_note}</Field>}
          {request.self_approved && (
            <p className="banner banner-warn mt-2 text-[11.5px]">
              This request was approved by the person who raised it, because no other administrator
              account existed to review it. It was not a second pair of eyes.
            </p>
          )}
          {request.applied_at && (
            <Field label="Applied">{formatDateTime(request.applied_at)}</Field>
          )}
          {request.error_text && (
            <div className="mt-2">
              <p className="t-label m-0 mb-1">What the firewall said</p>
              <pre className="max-h-40 overflow-auto rounded-[4px] surface-sunken p-2.5 font-mono text-[11px] leading-5 ink-2">
                {request.error_text}
              </pre>
            </div>
          )}
        </Section>

        {/* ── 4. The decision. ─────────────────────────────────────────────────────────── */}
        {result ? (
          <div className={`banner ${outcome?.onDevice ? "banner-ok" : "banner-danger"}`}>
            <p className="m-0 flex items-center gap-1.5 text-[12.5px] font-bold">
              {outcome?.onDevice ? <FiCheckCircle size={13} /> : <FiAlertTriangle size={13} />}
              {OUTCOME_LABELS[result.outcome]}
            </p>
            <p className="m-0 mt-1 text-[12px] leading-5">{result.message}</p>
            {result.detail && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-[4px] surface-sunken p-2.5 font-mono text-[11px] leading-5 ink-2">
                {result.detail}
              </pre>
            )}
            {!outcome?.onDevice && result.outcome !== "rejected" && (
              <p className="m-0 mt-1.5 text-[11.5px] leading-5">
                The decision is recorded. The firewall does not carry this change — do not approve
                it again; it has already left the queue.
              </p>
            )}
          </div>
        ) : confirmWithdraw ? (
          <div className="banner banner-warn">
            <p className="m-0 text-[12.5px] font-bold">Withdraw this request?</p>
            <p className="m-0 mt-1 text-[12px] leading-5">
              It will not be reviewed and nothing will reach the firewall. This cannot be undone —
              you would have to raise the change again.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn btn-danger btn-sm" disabled={busy}
                onClick={() => void doWithdraw()}>
                Yes, withdraw it
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                onClick={() => setConfirmWithdraw(false)}>
                Keep it in the queue
              </button>
            </div>
          </div>
        ) : block === "ok" ? (
          <Section icon={<FiCheckCircle size={12} />} title="Your decision">
            <label className="field-label" htmlFor="cr-note">Note (kept with the request)</label>
            <textarea
              id="cr-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Why you approved or rejected this"
              className="shell-textarea"
            />
            <label className="field-label mt-2" htmlFor="cr-window">
              Apply in a maintenance window instead of now (optional)
            </label>
            <input
              id="cr-window"
              type="datetime-local"
              value={applyAt}
              onChange={(e) => setApplyAt(e.target.value)}
              className="shell-input"
            />
            <p className="field-hint">
              Leave this empty to apply the change as soon as you approve it.
            </p>
          </Section>
        ) : (
          <p className="banner text-[11.5px]">
            {REVIEW_BLOCK_LABELS[block]}
          </p>
        )}

        {error && (
          <p className="banner banner-danger m-0 flex items-start gap-1.5 text-[12px]">
            <FiXCircle size={13} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};

export default RequestDetail;
