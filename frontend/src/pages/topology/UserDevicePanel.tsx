import React, { useState } from "react";
import { FiPlus, FiEdit2, FiTrash2, FiRadio, FiWifi } from "react-icons/fi";
import UserDeviceModal from "./UserDeviceModal";
import ConfirmDeleteModal from "../../components/ui/ConfirmDeleteModal";
import { message } from "../../components/ui/toast";
import {
  CheckTopologyDevice, DeleteTopologyDevice,
  type TopologyDevice, type TopologyDeviceStatus,
} from "../../api/topologyDevices";

// The manage strip beside the 3D map: add a device, see what the firewall last found, re-check or
// remove one. The map draws these same devices; this panel is where they are created and read as a
// list, which is the half a screen reader and a keyboard can use.

const STATUS_STYLE: Record<TopologyDeviceStatus, { dot: string; label: string }> = {
  up: { dot: "var(--flow-allow)", label: "up" },
  down: { dot: "#ef4444", label: "down" },
  unknown: { dot: "var(--shell-ink-3)", label: "unknown" },
};

const KIND_ICON: Record<string, React.ReactNode> = {
  "access-point": <FiWifi size={12} />,
  default: <FiRadio size={12} />,
};

const lastCheckedText = (d: TopologyDevice): string => {
  if (!d.enabled) return "checks paused";
  if (!d.last_checked_at) return "not checked yet";
  const secs = Math.max(0, Math.round((Date.now() - new Date(d.last_checked_at).getTime()) / 1000));
  if (secs < 60) return `checked ${secs}s ago`;
  if (secs < 3600) return `checked ${Math.round(secs / 60)}m ago`;
  return `checked ${Math.round(secs / 3600)}h ago`;
};

export type UserDevicePanelProps = {
  devices: TopologyDevice[];
  firewallId: number;
  firewallName: string;
  /** True while the firewall is re-pinging every device after the page opened — shown as a hint so
   *  the user knows a stale status is being confirmed rather than left as-is. */
  rechecking?: boolean;
  /** Re-fetch after any change so the list and the 3D map stay in step. */
  onChanged: () => void;
  /** A device id a click in the 3D scene asked to edit; null when nothing is pending. */
  editRequestId?: number | null;
  /** Called once the edit request has been opened, so the parent can clear it. */
  onEditRequestHandled?: () => void;
};

const UserDevicePanel: React.FC<UserDevicePanelProps> = ({
  devices, firewallId, firewallName, rechecking, onChanged,
  editRequestId, onEditRequestHandled,
}) => {
  const [modal, setModal] = useState<{ open: boolean; editing: TopologyDevice | null }>({ open: false, editing: null });

  // A click on a device in the 3D scene asks to edit it. Derived, not stored: the modal is open when
  // the user opened it here OR when a scene click is pending, so no effect writes state in response
  // to a prop — the pending request is cleared when the dialog closes.
  const externalEditing = editRequestId != null
    ? devices.find((x) => x.id === editRequestId) ?? null
    : null;
  const modalOpen = modal.open || externalEditing != null;
  const modalEditing = modal.open ? modal.editing : externalEditing;
  const closeModal = () => {
    setModal({ open: false, editing: null });
    onEditRequestHandled?.();
  };
  const [toDelete, setToDelete] = useState<TopologyDevice | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [checkingId, setCheckingId] = useState<number | null>(null);

  const check = async (d: TopologyDevice) => {
    setCheckingId(d.id);
    try {
      const fresh = await CheckTopologyDevice(d.id);
      message.success(`${d.name} is ${fresh.last_status}`);
      onChanged();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg ?? "Could not reach the firewall to run the check");
    } finally {
      setCheckingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await DeleteTopologyDevice(toDelete.id);
      message.success("Device removed");
      setToDelete(null);
      onChanged();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg ?? "Could not remove the device");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="panel">
      <div className="flex items-center justify-between gap-2 border-b hairline-2 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="t-label m-0">My devices</h2>
          {rechecking ? (
            <p className="t-meta m-0 mt-0.5 flex items-center gap-1.5 truncate text-[var(--flow-allow)]">
              <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Confirming live status…
            </p>
          ) : (
            <p className="t-meta m-0 mt-0.5 truncate" title={firewallName}>Pinged from this firewall, drawn on the map</p>
          )}
        </div>
        <button type="button" className="btn btn-primary btn-sm shrink-0"
          onClick={() => setModal({ open: true, editing: null })}>
          <FiPlus size={14} /> Add device
        </button>
      </div>

      {devices.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-[12.5px] font-semibold ink-2">No pinned devices yet</p>
          <p className="mx-auto mt-1 max-w-sm text-[11.5px] ink-3">
            Add a switch, access point or server by its IP, and the firewall will ping it on the
            schedule you set — its status then shows on the 3D map.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--shell-border-2)]">
          {devices.map((d) => {
            const st = STATUS_STYLE[d.enabled ? d.last_status : "unknown"];
            return (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="relative flex h-2.5 w-2.5 shrink-0" title={st.label}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.dot }} />
                </span>
                <span className="shrink-0 ink-3">{KIND_ICON[d.kind] ?? KIND_ICON.default}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold ink">{d.name}</p>
                  <p className="truncate text-[11px] ink-3">
                    <span className="t-mono">{d.ip_address}</span> · {st.label}
                    {d.last_status === "up" && d.last_latency_ms != null && ` · ${Math.round(d.last_latency_ms)} ms`}
                    {" · "}{lastCheckedText(d)}
                  </p>
                  {d.last_error && (
                    <p className="truncate text-[10.5px] text-amber-600 dark:text-amber-400">{d.last_error}</p>
                  )}
                </div>
                {/* The action cluster. "Check now" is set apart from the edit/delete icons by a thin
                    divider and real spacing — crowded together they were easy to mis-tap. */}
                <div className="flex shrink-0 items-center gap-2.5">
                  <button type="button" className="btn btn-ghost btn-xs"
                    onClick={() => void check(d)} disabled={checkingId === d.id}>
                    {checkingId === d.id ? "Checking…" : "Check now"}
                  </button>
                  <span className="h-4 w-px shrink-0 bg-[var(--shell-border-2)]" aria-hidden />
                  <div className="flex items-center gap-1.5">
                    <button type="button" className="icon-btn" aria-label={`Edit ${d.name}`}
                      onClick={() => setModal({ open: true, editing: d })}>
                      <FiEdit2 size={13} />
                    </button>
                    <button type="button" className="icon-btn text-rose-500" aria-label={`Delete ${d.name}`}
                      onClick={() => setToDelete(d)}>
                      <FiTrash2 size={13} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}


      {/* Keyed so it remounts per device — the form then initialises straight from props with no
          reset effect. "closed" keeps one stable key while hidden. */}
      <UserDeviceModal
        key={modalOpen ? `ud-${modalEditing?.id ?? "new"}` : "closed"}
        open={modalOpen}
        firewallId={firewallId}
        editing={modalEditing}
        onClose={closeModal}
        onSaved={() => onChanged()}
      />

      {toDelete && (
        <ConfirmDeleteModal
          eyebrow="REMOVE FROM MAP"
          title={`Remove ${toDelete.name}?`}
          busy={deleting}
          onCancel={() => setToDelete(null)}
          onConfirm={() => void confirmDelete()}
          confirmLabel="Remove"
        >
          This only removes the pin from your map and stops the firewall pinging it. The device itself
          is not touched.
        </ConfirmDeleteModal>
      )}
    </div>
  );
};

export default UserDevicePanel;
