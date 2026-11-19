import type React from "react";
import type { focusRing } from "../../components/ui/form-controls.logic";
import type { NetworkDevice } from "../../api/device";
import type { SystemInterface, VPNWizardMetadata } from "../../api/policyObject";
import type { CustomState, RAClientType, RADeviceKind, RANativeType, VPNWizardState } from "./ipsec-wizard-rules";

/**
 * Everything a step panel of the VPN wizard reads or writes.
 *
 * The wizard used to be one 1,637-line component, so each step panel simply closed over the
 * shell's state. Splitting the panels into their own files means naming that closure, and naming
 * it ONCE: a panel takes this whole object rather than its own prop list, so moving a field
 * between panels stays a one-line change and no panel can quietly grow a second source of truth
 * for the form.
 *
 * It is deliberately the shell's state as it already was — same names, same types, no derived
 * copies — so a panel's body reads identically to the block it was lifted from.
 */
export type WizardCtx = {
  /** The accent colour of the signed-in user, and the focus ring built from it. */
  currentColor: string;
  ring: ReturnType<typeof focusRing>;

  /** The console-wide device selection, and what the wizard has read off it. */
  device: NetworkDevice | null;
  meta: VPNWizardMetadata;
  /** Existing address-object names, for the split-tunnel pickers. */
  addresses: string[];
  /** Interfaces that may parent a tunnel, and the WAN-ish subset offered as the outgoing one. */
  parentIfaces: SystemInterface[];
  wanIfaces: SystemInterface[];
  /** `alias (name)` when the interface has an alias, the bare name otherwise. */
  ifaceLabel: (name: string) => string;

  /** ?edit=<name> loaded a tunnel: Create becomes Save, and the name is no longer a collision. */
  editing: boolean;
  /** A tunnel of this name already exists on the device — FortiGate would refuse Create with -5. */
  nameCollision: boolean;

  /** Where the user is, and the index of the Review step for the flow they picked. */
  step: number;
  lastStep: number;

  /** The form, its field errors, and the setters the panels use. */
  f: VPNWizardState;
  setF: React.Dispatch<React.SetStateAction<VPNWizardState>>;
  errors: Record<string, string>;
  set: <K extends keyof VPNWizardState>(k: K, v: VPNWizardState[K]) => void;
  /** Custom lives in a nested object; `c` is `f.custom` and `setC` writes one of its fields. */
  c: CustomState;
  setC: <K extends keyof CustomState>(k: K, v: CustomState[K]) => void;

  /** Setters that change more than one field at once, and so cannot be `set`. */
  setCustomIKE: (v: "1" | "2") => void;
  setHubLocalInterface: (name: string) => void;
  setRAClient: (v: RAClientType) => void;
  setRANative: (v: RANativeType) => void;
  setRADeviceKind: (v: RADeviceKind) => void;

  /** The pre-shared key reveal, shared by every panel that shows one. */
  showPSK: boolean;
  setShowPSK: React.Dispatch<React.SetStateAction<boolean>>;

  /** The live routing lookup behind the auto-filled outgoing interface. */
  lookingUp: boolean;
  lookupNote: string;
  /** False once the user picks an interface by hand, so a later lookup cannot overwrite it. */
  autoFilledRef: React.RefObject<boolean>;
};
