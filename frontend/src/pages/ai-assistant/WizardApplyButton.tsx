import React, { useState } from "react";
import { FiCheck } from "react-icons/fi";
import ApplyConfirmModal from "./ApplyConfirmModal";
import type { ApplyImpact } from "./applyImpact";

// The Apply button in every AI wizard footer — and the confirmation that now stands in front of it.
//
// WHY IT IS ONE COMPONENT
// Nine wizard footers rendered a byte-identical red Apply button and called their own handleApply
// straight through to the device. Adding a confirmation to each of them would have meant nine copies
// of the same dialog state, and the tenth wizard someone writes next year would quietly ship without
// one. Here the button and its dialog are the same component, so a wizard cannot render the button
// without also getting the confirmation — `buildImpact` is required, not optional.
//
// `buildImpact` is a FUNCTION, called on click rather than on every render: the wizard's form is
// still changing right up to the moment the button is pressed, and the dialog must describe the
// values the user is actually about to send — not the ones that existed when the footer last
// re-rendered. It also keeps the (cheap, but pointless) summary work off the typing path.

interface WizardApplyButtonProps {
  /** Overwriting an existing object rather than creating one — changes the label and the dialog. */
  isEdit: boolean;
  saving: boolean;
  disabled?: boolean;
  /** Tooltip, normally the reason Apply is unavailable. */
  title?: string;
  /** Which firewall this lands on. */
  deviceName?: string;
  /** Built at click time from the CURRENT form. */
  buildImpact: () => ApplyImpact;
  onApply: () => void;
}

const WizardApplyButton: React.FC<WizardApplyButtonProps> = ({
  isEdit, saving, disabled = false, title, deviceName, buildImpact, onApply,
}) => {
  const [impact, setImpact] = useState<ApplyImpact | null>(null);

  return (
    <>
      <button type="button" onClick={() => setImpact(buildImpact())} disabled={saving || disabled}
        title={title}
        className="flex items-center gap-1.5 rounded-[4px] px-4 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50"
        style={{ background: "linear-gradient(135deg,#ef4444,#f43f5e)" }}>
        {saving
          ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
          : <FiCheck size={13} />}
        {isEdit ? "Apply Changes" : "Apply"}
      </button>

      <ApplyConfirmModal
        open={!!impact}
        impact={impact}
        deviceName={deviceName}
        busy={saving}
        onCancel={() => setImpact(null)}
        // Close first, then write: the wizard's own footer button carries the spinner from here on,
        // exactly as it did before the dialog existed.
        onConfirm={() => { setImpact(null); onApply(); }}
      />
    </>
  );
};

export default WizardApplyButton;
