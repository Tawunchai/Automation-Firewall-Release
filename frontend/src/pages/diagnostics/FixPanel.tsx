import React, { useState } from "react";
import {
  FiAlertTriangle, FiArrowRight, FiCheckCircle, FiCode, FiCopy, FiRotateCcw, FiShield, FiX, FiXCircle, FiZap,
} from "react-icons/fi";
import type { FixApplyResult, FixPreview, FixScope } from "../../api/troubleshoot";
import PacketFlow from "./PacketFlow";
import { fixTitle, planCli, stepSentence, whatIfSentence } from "./trace-model";

// Troubleshooting ▸ fix it — the two panels around a plan.
//
//   FixPreviewPanel   the what-if: the verdict before and after, the packet walking the SIMULATED
//                     table, every write in order with its CLI, and what the policy that ends up
//                     carrying this connection will accept — broad ones say so before anyone applies
//                     them. Apply is an administrator's button; everyone else can still copy the CLI.
//   FixAppliedPanel   what actually landed, step by step, and the one button that puts it all back.
//
// Nothing here decides what is written. The panel shows the server's plan, and applying sends back
// only its id and fingerprint — the server re-plans from a fresh read and refuses a stale preview.

const OK = "var(--flow-allow)";
const DENY = "var(--flow-deny)";
const WARN = "var(--flow-warn)";

/**
 * One row of the scope table: a label and the object names, as chips.
 *
 * The names are in <code>, which the render-time translator passes through verbatim. They are
 * FortiOS object names, not words: in a <span> the address object literally called "all" rendered as
 * "ทั้งหมด" in Thai — a name the operator would then look for on the firewall and not find.
 */
const ScopeRow: React.FC<{ label: string; names: string[] }> = ({ label, names }) => (
  <div className="flex items-start gap-3 border-b hairline-2 py-1.5 last:border-b-0">
    <span className="t-label w-28 shrink-0 pt-0.5">{label}</span>
    <span className="flex min-w-0 flex-wrap gap-1">
      {names.length === 0
        ? <span className="t-meta">—</span>
        : names.map((n) => (
          // The chip is the span; the name inside is <code> for the translator, sized by the chip —
          // the global `code { font-size: .875em }` is unlayered and would beat .chip's own size.
          <span key={n} className="chip font-mono"><code style={{ fontSize: "inherit" }}>{n}</code></span>
        ))}
    </span>
  </div>
);

const Scope: React.FC<{ scope: FixScope }> = ({ scope }) => (
  <div>
    <p className="m-0 mb-1.5 text-[12.5px] font-semibold ink">
      {scope.policy_id ? `Policy #${scope.policy_id} ${scope.policy_name}` : `New policy ${scope.policy_name}`}
    </p>
    <ScopeRow label="Incoming" names={scope.src_intf} />
    <ScopeRow label="Outgoing" names={scope.dst_intf} />
    <ScopeRow label="Source" names={scope.src_addr} />
    <ScopeRow label="Destination" names={scope.dst_addr} />
    <ScopeRow label="Service" names={scope.service} />
    {scope.broad ? (
      <div className="banner banner-warn mt-2 flex items-start gap-2">
        <FiAlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span className="text-[11.5px]">
          This policy accepts much more than this one connection — every source, destination and service it lists above,
          not only this trace. Prefer the new-policy fix unless opening all of that is intended.
        </span>
      </div>
    ) : (
      <p className="t-meta m-0 mt-2 flex items-center gap-1.5" style={{ color: OK }}>
        <FiShield size={12} /> <span>Only this connection is opened — nothing else.</span>
      </p>
    )}
  </div>
);

const copyText = async (text: string, onDone: (ok: boolean) => void) => {
  try {
    await navigator.clipboard.writeText(text);
    onDone(true);
  } catch {
    onDone(false);
  }
};

export const FixPreviewPanel: React.FC<{
  preview: FixPreview;
  isAdmin: boolean;
  applying: boolean;
  accent: string;
  onApply: () => void;
  onClose: () => void;
  onCopied: (ok: boolean) => void;
}> = ({ preview, isAdmin, applying, accent, onApply, onClose, onCopied }) => {
  const { plan, after } = preview;
  const [showCli, setShowCli] = useState(false);
  const allowed = after.verdict === "allowed";
  const writes = plan.steps.length;

  return (
    <section className="shell-card overflow-hidden" style={{ borderColor: `${accent}55` }}>
      <header className="card-head">
        <h2 className="card-title t-card">
          <span className="medallion h-6 w-6 text-[12px]" style={{ color: accent, background: `${accent}1f` }}><FiZap /></span>
          <span>What if</span>
          <span className="ink-2 font-medium">— {fixTitle(plan)}</span>
        </h2>
        <div className="flex items-center gap-2">
          <span className="chip chip-info">Simulated — nothing written yet</span>
          <button type="button" onClick={onClose} className="btn-icon" aria-label="Close the preview" title="Close the preview">
            <FiX size={13} />
          </button>
        </div>
      </header>

      {/* Before → after, in one line */}
      <div className="flex flex-wrap items-center gap-2 border-b hairline-2 px-4 py-2.5">
        <span className="chip chip-danger">Blocked now</span>
        <FiArrowRight size={13} className="ink-3" />
        <span className={`chip ${allowed ? "chip-ok" : "chip-danger"}`}>{allowed ? "Allowed after the fix" : "Still blocked"}</span>
        <span className="t-body ink ml-1">{whatIfSentence(after)}</span>
      </div>

      {/* The packet, walking the table as it would be */}
      <div className="px-3 py-2">
        <PacketFlow key={`${plan.id}-${plan.fingerprint}`} trace={after} />
      </div>

      <div className="grid gap-4 border-t hairline-2 px-4 py-3 xl:grid-cols-2">
        {/* What would be written */}
        <div>
          {/* The count as its own chip, not "N change{s}": a plural glued into the sentence has no
              translation that reads right in Thai or Chinese. */}
          <p className="t-label m-0 mb-2 flex items-center gap-1.5">
            <span>What will be written</span>
            <span className="chip">{writes}</span>
          </p>
          <ol className="m-0 list-none space-y-1.5 p-0">
            {plan.steps.map((s, i) => (
              <li key={`${s.op}-${s.name}-${s.field ?? ""}-${i}`} className="flex items-start gap-2.5">
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-white"
                  style={{ background: accent }}>
                  {i + 1}
                </span>
                <span className="t-body ink">{stepSentence(s)}</span>
              </li>
            ))}
          </ol>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setShowCli((v) => !v)} className="btn btn-ghost btn-sm hairline gap-1.5 border">
              <FiCode size={12} /> <span>{showCli ? "Hide the CLI" : "Show the CLI"}</span>
            </button>
            <button type="button" onClick={() => void copyText(planCli(plan), onCopied)} className="btn btn-ghost btn-sm hairline gap-1.5 border">
              <FiCopy size={12} /> <span>Copy the CLI</span>
            </button>
          </div>
          {showCli && (
            <pre className="code-surface m-0 mt-2 max-h-72 overflow-auto rounded-[4px] px-3 py-2 text-[11px]">{planCli(plan)}</pre>
          )}
        </div>

        {/* What it opens */}
        <div>
          <p className="t-label m-0 mb-2">What the policy will accept</p>
          <Scope scope={plan.scope} />
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t hairline-2 px-4 py-3">
        {isAdmin ? (
          <>
            <button type="button" onClick={onApply} disabled={applying || !allowed} className="btn btn-accent gap-1.5 disabled:opacity-50">
              {applying
                ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                : <FiZap size={13} />}
              <span>Apply to the firewall</span>
            </button>
            <p className="t-meta m-0">
              Written to the live rule base and recorded in Change history — one click undoes it.
            </p>
          </>
        ) : (
          <p className="t-meta m-0">Only an administrator can apply a fix. The CLI above can be handed to one.</p>
        )}
      </footer>
    </section>
  );
};

export const FixAppliedPanel: React.FC<{
  result: FixApplyResult;
  undoing: boolean;
  isAdmin: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}> = ({ result, undoing, isAdmin, onUndo, onDismiss }) => {
  const failed = !!result.error;
  const tone = failed ? WARN : OK;
  const canUndo = isAdmin && result.change_ids.length > 0;
  return (
    <section className="shell-card overflow-hidden" style={{ borderColor: `color-mix(in srgb, ${tone} 45%, transparent)` }}>
      <div className="flex flex-wrap items-start gap-3 px-4 py-3" style={{ background: `color-mix(in srgb, ${tone} 9%, transparent)` }}>
        <span className="mt-0.5" style={{ color: tone }}>
          {failed ? <FiAlertTriangle size={18} /> : <FiCheckCircle size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[14px] font-bold" style={{ color: tone }}>
            {failed ? "The fix stopped part-way" : "The fix is on the firewall"}
          </p>
          <p className="t-body m-0 ink">
            {failed
              ? "A step failed, so nothing after it was written. What landed before it is listed — undo it, or finish by hand."
              : "The trace below was read back from the firewall after the change, not simulated."}
          </p>
          <ul className="m-0 mt-2 list-none space-y-1 p-0">
            {result.results.map((r, i) => (
              <li key={`${r.step.op}-${r.step.name}-${i}`} className="flex items-start gap-2 text-[12px]">
                <span className="mt-0.5 shrink-0" style={{ color: r.ok ? OK : DENY }}>
                  {r.ok ? <FiCheckCircle size={12} /> : <FiXCircle size={12} />}
                </span>
                <span className="min-w-0">
                  <span className="ink">{stepSentence(r.step)}</span>
                  {r.reused && <span className="ink-3"> · <span>already there, left as it was</span></span>}
                  {r.error && <span className="block" style={{ color: DENY }}>{r.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-2">
          {canUndo && (
            <button type="button" onClick={onUndo} disabled={undoing} className="btn btn-ghost btn-sm hairline gap-1.5 border disabled:opacity-50">
              {undoing
                ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                : <FiRotateCcw size={12} />}
              <span>Undo this fix</span>
            </button>
          )}
          <button type="button" onClick={onDismiss} className="btn-icon" aria-label="Dismiss" title="Dismiss">
            <FiX size={13} />
          </button>
        </div>
      </div>
    </section>
  );
};
