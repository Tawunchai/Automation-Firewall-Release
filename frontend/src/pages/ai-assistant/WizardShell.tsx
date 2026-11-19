import React from "react";
import { FiCheck, FiChevronLeft, FiChevronRight, FiHardDrive, FiX } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import WizardApplyButton from "./WizardApplyButton";
import type { ApplyImpact } from "./applyImpact";

// The chrome every AI object wizard shares: header (+ CREATE NEW / EDIT EXISTING badge), the step
// pills, a scrolling body and the Back/Next/Apply footer. Extracted from AntivirusWizard so the
// File Filter / User Group / User Definition wizards don't each re-implement 200 identical lines.
//
// The shell owns no form state — each wizard keeps its own and passes the current step's fields in
// as children.
export type WizardShellProps = {
  title: string;
  icon: React.ReactNode;
  device: NetworkDevice;
  hostname: string;
  currentColor: string;

  stepLabels: string[];
  step: number;
  onStep: (i: number) => void;

  isEdit: boolean;
  checking: boolean;
  checkingLabel?: string;
  readOnly?: boolean;
  saving: boolean;
  canApply: boolean;
  applyDisabledReason?: string;

  onApply: () => void;
  /**
   * What Apply is about to write, built at click time (see WizardApplyButton). REQUIRED, not
   * optional: this is what puts the confirmation dialog in front of a live-firewall write, and an
   * optional prop is one a future wizard forgets to pass while TypeScript stays silent.
   */
  buildImpact: () => ApplyImpact;
  onCancel: () => void;
  children: React.ReactNode;
};

export const WizardShell: React.FC<WizardShellProps> = ({
  title, icon, device, hostname, currentColor,
  stepLabels, step, onStep,
  isEdit, checking, checkingLabel = "Checking device for an existing object…",
  readOnly = false, saving, canApply, applyDisabledReason,
  onApply, buildImpact, onCancel, children,
}) => {
  const isLastStep = step === stepLabels.length - 1;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b hairline-2 px-4 py-2.5 shrink-0">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: currentColor }}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold ink">
            {title}
            {!checking && (
              <span className="ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                style={{ background: isEdit ? "#f59e0b20" : `${currentColor}20`, color: isEdit ? "#b45309" : currentColor }}>
                {isEdit ? "EDIT EXISTING" : "CREATE NEW"}
              </span>
            )}
          </p>
          <p className="flex items-center gap-1 truncate text-[10px] ink-3">
            <FiHardDrive size={9} /> {hostname || device.name}
          </p>
        </div>
        <button type="button" onClick={onCancel}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] ink-3 surface-hover hover-ink transition">
          <FiX size={13} />
        </button>
      </div>

      {/* Step indicator — a single-step wizard has nothing to show */}
      {stepLabels.length > 1 && (
        <div className="flex items-center gap-1 overflow-x-auto border-b hairline-2 px-4 py-2.5 shrink-0">
          {stepLabels.map((label, i) => (
            <React.Fragment key={label}>
              {i > 0 && <div className="h-px w-3 shrink-0" style={{ background: i <= step ? currentColor : "#e2e8f0" }} />}
              <button type="button" onClick={() => i < step && onStep(i)} disabled={i > step}
                className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold transition disabled:cursor-default"
                style={{
                  background: i === step ? currentColor : i < step ? `${currentColor}15` : "transparent",
                  color: i === step ? "white" : i < step ? currentColor : "#94a3b8",
                }}>
                <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                  style={{
                    background: i === step ? "rgba(255,255,255,.25)" : i < step ? `${currentColor}22` : "#e2e8f0",
                    color: i === step ? "white" : i < step ? currentColor : "#94a3b8",
                  }}>
                  {i + 1}
                </span>
                {i === step && <span className="pr-0.5">{label}</span>}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {readOnly && (
          <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
            <FiCheck size={12} /> Already applied — review only (read-only)
          </div>
        )}
        {checking ? (
          <div className="flex items-center gap-2 px-6 py-8 text-[12px] ink-3">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 hairline border-t-transparent" />
            {checkingLabel}
          </div>
        ) : (
          <div style={readOnly ? { pointerEvents: "none", opacity: 0.7 } : undefined}>{children}</div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t hairline-2 px-4 py-3 shrink-0">
        <button type="button" onClick={() => (step === 0 ? onCancel() : onStep(step - 1))}
          className="flex items-center gap-1.5 rounded-[4px] border hairline px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
          <FiChevronLeft size={13} /> {step === 0 ? (readOnly ? "Close" : "Cancel") : "Back"}
        </button>

        {stepLabels.length > 1
          ? <span className="text-[10px] ink-3">Step {step + 1} of {stepLabels.length}</span>
          : <span />}

        {isLastStep ? (
          readOnly ? (
            <button type="button" disabled
              className="flex cursor-default items-center gap-1.5 rounded-[4px] px-4 py-1.5 text-[12px] font-semibold text-white"
              style={{ background: "#16a34a" }}>
              <FiCheck size={13} /> Applied
            </button>
          ) : (
            <WizardApplyButton
              isEdit={isEdit}
              saving={saving}
              disabled={checking || !canApply}
              title={applyDisabledReason}
              deviceName={hostname || device.name}
              buildImpact={buildImpact}
              onApply={onApply}
            />
          )
        ) : (
          <button type="button" onClick={() => onStep(step + 1)} disabled={checking}
            className="flex items-center gap-1.5 rounded-[4px] px-4 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50"
            style={{ background: currentColor }}>
            Next <FiChevronRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
};

export default WizardShell;
