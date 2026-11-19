import React, { useState } from "react";
import { FiHardDrive } from "react-icons/fi";
import Modal from "../../components/ui/Modal";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { message } from "../../components/ui/toast";
import {
  CreateTopologyDevice, UpdateTopologyDevice, CheckTopologyDevice,
  TOPOLOGY_DEVICE_KINDS, type TopologyDevice, type TopologyDeviceInput, type TopologyDeviceKind,
} from "../../api/topologyDevices";

// The Add / Edit form for a pinned Topology device.
//
// It collects only what the firewall needs to watch a device and what the scene needs to draw it: a
// name, the IP the firewall pings, the kind (which picks the 3D glyph), how often to check, and a
// short note. There are no credentials here — this console never logs in to these devices, it only
// pings them from a firewall.

const KIND_LABELS: Record<TopologyDeviceKind, string> = {
  switch: "Switch",
  router: "Router",
  endpoint: "Endpoint",
  "access-point": "Access Point",
  server: "Server",
  firewall: "Firewall",
  other: "Other",
};

// Ping cadence. The scheduler ticks once a minute, so sub-minute values are honoured at minute
// granularity — these presets stay at or above it to keep the label honest, and a firewall that locks
// an admin account after three failures is reason enough not to offer anything faster.
const INTERVAL_OPTIONS = [
  { value: "30", label: "Every 30 seconds" },
  { value: "60", label: "Every minute" },
  { value: "120", label: "Every 2 minutes" },
  { value: "300", label: "Every 5 minutes" },
  { value: "600", label: "Every 10 minutes" },
  { value: "1800", label: "Every 30 minutes" },
];

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+:[0-9a-fA-F:]*$/;

export type UserDeviceModalProps = {
  open: boolean;
  /** The firewall that will ping this device — the one selected in the navbar. */
  firewallId: number;
  /** Present when editing; absent for a new device. */
  editing?: TopologyDevice | null;
  onClose: () => void;
  onSaved: (device: TopologyDevice) => void;
};

// The caller remounts this (via a `key` that changes with the device being edited), so the fields
// initialise straight from props — no reset effect, and reopening on a different row can never show
// the previous one's data.
const UserDeviceModal: React.FC<UserDeviceModalProps> = ({
  open, firewallId, editing, onClose, onSaved,
}) => {
  const [name, setName] = useState(editing?.name ?? "");
  const [ip, setIp] = useState(editing?.ip_address ?? "");
  const [kind, setKind] = useState<TopologyDeviceKind>(editing?.kind ?? "switch");
  const [interval, setInterval] = useState(String(editing?.ping_interval_seconds ?? 60));
  const [description, setDescription] = useState(editing?.description ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedIp = ip.trim();
    if (!trimmedName) { message.error("Give the device a name"); return; }
    if (!IP_RE.test(trimmedIp)) { message.error("Enter a valid IP address"); return; }

    const payload: TopologyDeviceInput = {
      name: trimmedName,
      ip_address: trimmedIp,
      kind,
      ping_interval_seconds: Number(interval) || 60,
      description: description.trim(),
      // Always on — a pinned device exists to be watched, so there is no pause toggle. The firewall
      // pings it on its schedule, and the save below also pings it once immediately.
      enabled: true,
      device_id: firewallId || 1,
    };

    setSaving(true);
    try {
      const saved = editing
        ? await UpdateTopologyDevice(editing.id, payload)
        : await CreateTopologyDevice(payload);
      // Ping it NOW so the user sees up/down right away — "did it actually connect?" is the first
      // question after adding a device, and waiting for the next scheduled sweep to answer it reads
      // as the map being broken. A failed check never fails the save: the row is created either way
      // and the sweep (and the page's re-check on open) will catch up.
      let result = saved;
      try { result = await CheckTopologyDevice(saved.id); } catch { /* keep saved; sweep will update */ }
      message.success(editing ? "Device updated" : "Device added to the map");
      onSaved(result);
      onClose();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg ?? "Could not save the device");
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={editing ? "Edit device" : "Add device"}
      icon={<FiHardDrive />}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn btn-soft btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add device"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div>
          <label className="field-label" htmlFor="ud-name">Name</label>
          <input id="ud-name" className="shell-input" value={name} disabled={saving}
            placeholder="Core Switch" onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className="field-label" htmlFor="ud-ip">IP address</label>
          <input id="ud-ip" className="shell-input t-mono" value={ip} disabled={saving}
            placeholder="192.168.1.2" onChange={(e) => setIp(e.target.value)} />
          <p className="mt-1 text-[11px] ink-3">The firewall pings this address to tell whether the device is up.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="field-label block">Device type</span>
            <MinimalSelect ariaLabel="Device type" className="w-full" value={kind}
              onChange={(v) => setKind(v as TopologyDeviceKind)}
              options={TOPOLOGY_DEVICE_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
          </div>
          <div>
            <span className="field-label block">Ping check</span>
            <MinimalSelect ariaLabel="Ping check interval" className="w-full" value={interval}
              onChange={setInterval} options={INTERVAL_OPTIONS} />
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="ud-desc">Description</label>
          <input id="ud-desc" className="shell-input" value={description} disabled={saving}
            placeholder="Optional — where it is, what it does" onChange={(e) => setDescription(e.target.value)} />
        </div>

      </div>
    </Modal>
  );
};

export default UserDeviceModal;
