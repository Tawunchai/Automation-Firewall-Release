import React, { useEffect, useState } from "react";
import { FiSave, FiHardDrive, FiX } from "react-icons/fi";
import Modal from "../../components/ui/Modal";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { CreateDevice, UpdateDevice, type NetworkDevice } from "../../api/device";
import { DeviceFields } from "./device-form";
import { buildDevicePayload, validateDeviceForm, deviceToForm, BLANK_DEVICE_FORM, type DeviceFormState } from "./device-form.logic";

// Add / Edit Device as a right-side drawer — the shape FortiGate opens its own create/edit panels
// in, and the shape the SNMP page already mirrors. Replaces the full-page create.tsx / edit.tsx:
// the inventory list stays on screen behind it and refreshes the moment the drawer saves.

const DeviceFormDrawer: React.FC<{
  open: boolean;
  /** null = create a new device; a device = edit that device. */
  device: NetworkDevice | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ open, device, onClose, onSaved }) => {
  const { currentColor } = useStateContext();
  const [form, setForm] = useState<DeviceFormState>(BLANK_DEVICE_FORM);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof DeviceFormState>(k: K, v: DeviceFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  // Re-seed the form every time the drawer opens — the edited device's values, or a blank form for
  // a new one — so a drawer reopened on a different row never shows the previous one's fields.
  useEffect(() => {
    if (!open) return;
    setForm(device ? deviceToForm(device) : BLANK_DEVICE_FORM);
    setErrors({});
  }, [open, device]);

  const submit = async () => {
    const bad = validateDeviceForm(form);
    if (Object.keys(bad).length) { setErrors(bad); return; }
    try {
      setSaving(true);
      if (device) await UpdateDevice(device.id, buildDevicePayload(form));
      else await CreateDevice(buildDevicePayload(form));
      message.success(device ? "Device updated" : "Device added");
      onSaved();
      onClose();
    } catch (e: unknown) {
      message.error(apiErrorText(e, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      side="right"
      width="w-full max-w-lg"
      bodyClassName="p-0 shell-scroll-thin"
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-accent btn-sm" onClick={() => void submit()} disabled={saving}>
            {saving
              ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              : <FiSave size={13} />}
            {saving ? "Saving…" : device ? "Save Changes" : "Add Device"}
          </button>
        </>
      }
    >
      {/* A clean header with a soft accent badge + corner glow, sticky to the top of the scroll —
          the same treatment as the account dialogs, kept on the right-side drawer shape. */}
      <div className="sticky top-0 z-10 flex items-center gap-3 overflow-hidden border-b border-slate-100 px-5 py-4 dark:border-white/8"
        style={{ background: "var(--shell-card)" }}>
        <span className="pointer-events-none absolute -right-8 -top-12 h-28 w-28 rounded-full"
          style={{ background: `color-mix(in srgb, ${currentColor} 9%, transparent)` }} />
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px]"
          style={{ color: currentColor, background: `color-mix(in srgb, ${currentColor} 12%, transparent)` }}>
          <FiHardDrive className="text-[16px]" />
        </span>
        <div className="relative min-w-0 flex-1">
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: currentColor }}>
            {device ? "Edit device" : "New device"}
          </p>
          <h3 className="m-0 truncate text-[14px] font-bold ink">{device ? device.name : "Add a firewall"}</h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="btn-icon relative shrink-0">
          <FiX className="text-[15px]" />
        </button>
      </div>
      <div className="p-5">
        <DeviceFields form={form} set={set} errors={errors} editing={device} />
      </div>
    </Modal>
  );
};

export default DeviceFormDrawer;
