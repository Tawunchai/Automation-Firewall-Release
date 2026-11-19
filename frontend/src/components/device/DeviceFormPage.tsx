import React from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronLeft, FiSave } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import type { NetworkDevice } from "../../api/device";

/**
 * The chrome every create/edit page on a firewall object draws around its own fields.
 *
 * Thirty-one of them repeated the same four things: resolve `?deviceId`, say so when there is no
 * device, wrap the fields in a card, and put a Cancel/Save footer under it with the accent
 * gradient (72 copies of that gradient expression) and a hand-rolled spinner (59 copies of the
 * same bordered div). None of that is where the thinking on these pages is — the thinking is in
 * the fields and in what the payload has to look like for FortiOS to accept it.
 *
 * Two things it makes the default rather than something a page has to remember:
 *
 *  1. NO DEVICE, NO FORM. A page whose `?deviceId` names nothing renders the message and not the
 *     fields. Pages used to render the form anyway with a red banner above it, so the fields were
 *     fillable and Save was reachable with nowhere to send it.
 *  2. AN UNREADABLE OBJECT STOPS THE EDIT. `unreadable` is what ProfileLoadGuard taught the eight
 *     profile forms: an edit form that could not read what it is editing must not render its
 *     blank defaults with an enabled Save, because pressing it overwrites the live object with
 *     them. That is not an error state, it is destruction that looks like ordinary use.
 */
export const DeviceFormPage: React.FC<{
  /** The fields. Given the resolved device, because most forms need its id to save. */
  children: (device: NetworkDevice) => React.ReactNode;
  /** What this form creates or edits, lower case: "IP pool", "static route". */
  noun: string;
  /** Submit. The page keeps its own validation and payload building. */
  onSubmit: (device: NetworkDevice) => void | Promise<void>;
  /** True while the save is in flight — disables the footer and spins the button. */
  saving?: boolean;
  /** "Create" / "Save changes". Defaults to Create. */
  submitLabel?: string;
  /**
   * Render nothing but this instead of the form — for an edit page that could not read its
   * object (see ProfileUnreadable, which is what belongs here).
   */
  unreadable?: React.ReactNode;
  /** Still reading what the form needs. Shows the card's own spinner rather than empty fields. */
  loading?: boolean;
  /** The validation or device refusal to show above the footer. */
  error?: string | null;
  /** Where Cancel and Back go. Defaults to the previous history entry. */
  onCancel?: () => void;
  /** Extra controls in the footer, left of Cancel — "Save and add another", a CLI preview. */
  footerExtra?: React.ReactNode;
  /**
   * false when the page lays its own body out — Static Routes puts the fields beside a device
   * panel, so the card belongs around the fields and not around both.
   */
  card?: boolean;
}> = ({
  children, noun, onSubmit, saving = false, submitLabel = "Create",
  unreadable, loading = false, error, onCancel, footerExtra, card = true,
}) => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const { device, loading: loadingDevice } = useDeviceFromQuery();

  const back = onCancel ?? (() => navigate(-1));
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const BackButton = (
    <button
      type="button"
      onClick={back}
      className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition"
    >
      <FiChevronLeft size={14} /> Back
    </button>
  );

  if (unreadable) return <>{unreadable}</>;

  if (!loadingDevice && !device) {
    return (
      <div className="space-y-4">
        {BackButton}
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {`No device selected — go back and choose the firewall this ${noun} belongs on.`}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {BackButton}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (device) void onSubmit(device);
        }}
      >
        <div className={card ? "rounded-[4px] border hairline surface-card shadow-sm" : undefined}>
          {loading || !device ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[12px] ink-3">
              <Spinner /> {`Loading the ${noun}…`}
            </div>
          ) : (
            children(device)
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-[4px] border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {footerExtra}
          <button
            type="button"
            onClick={back}
            className="h-10 rounded-[4px] border hairline px-5 text-[13px] font-semibold ink-2 surface-hover transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !device || loading}
            className="flex h-10 items-center gap-2 rounded-[4px] px-6 text-[13px] font-semibold text-white transition disabled:opacity-50"
            style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}
          >
            {saving ? <><Spinner light /> Saving…</> : <><FiSave size={14} /> {submitLabel}</>}
          </button>
        </div>
      </form>
    </div>
  );
};

/** The one spinner, instead of 59 copies of the same bordered div. */
export const Spinner: React.FC<{ light?: boolean }> = ({ light }) => (
  <span
    className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-t-transparent ${
      light ? "border-white" : "border-current"
    }`}
    aria-hidden
  />
);

export default DeviceFormPage;
