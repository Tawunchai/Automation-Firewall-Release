import React from "react";
import { FiChevronLeft } from "react-icons/fi";
import { ErrorState } from "../../components/ui/StateBlock";

/**
 * What an EDIT form shows when it could not read the profile it is supposed to be editing.
 *
 * The eight profile forms all loaded the same way: a getter that answers `null` for every failure,
 * and `if (existing) setForm(existing)` with no else. So a firewall that would not answer — an
 * unreachable device, an expired session, a profile someone deleted from the CLI a moment ago —
 * left the form sitting on its BLANK DEFAULTS, fully rendered, with the profile's name in the
 * heading and an enabled Save button.
 *
 * Pressing Save there does not fail. It issues the update the form is holding, which is a complete
 * profile made of defaults, and the live profile is overwritten with it. That is the same mistake
 * as a list page drawing an unreadable device as "no objects", except this one does not merely
 * misinform — it destroys the thing it could not read, and it looks like ordinary use while doing
 * it.
 *
 * So a failed read stops the form from rendering at all. "Could not read" and "no longer there"
 * are deliberately not separated: the getters collapse both into `null`, and the right action is
 * the same either way — go back and look, rather than save something over it.
 */
export const ProfileUnreadable: React.FC<{
  /** What the form edits, lower case: "AntiVirus profile", "IPS sensor". */
  noun: string;
  /**
   * The profile's key, as the URL asked for it. Nullable because it comes straight off the query
   * string: `isEdit` is derived from it, so it is non-null wherever this renders, but typing it as
   * `string` would only move that reasoning into a `!` at seven call sites.
   */
  name: string | null;
  /** The device it was being read from, if we got far enough to know its name. */
  deviceName?: string;
  onBack: () => void;
  onRetry?: () => void;
}> = ({ noun, name, deviceName, onBack, onRetry }) => (
  <div className="space-y-4">
    <div className="panel panel-flush">
      <ErrorState
        title={`Could not read the ${noun}${name ? ` "${name}"` : ""}${deviceName ? ` from ${deviceName}` : ""}`}
        detail={`It may be unreachable, or the ${noun} may no longer exist on the device.`}
        note={`Nothing was opened for editing — saving a form built from defaults would have replaced the ${noun} on the firewall.`}
        onRetry={onRetry}
      />
    </div>
    <div className="text-center">
      <button type="button" className="btn btn-soft btn-sm" onClick={onBack}>
        <FiChevronLeft size={14} /> Back
      </button>
    </div>
  </div>
);
