import React, { useCallback, useEffect, useState } from "react";
import { FiActivity, FiEdit2, FiPlus, FiRefreshCw, FiSave, FiTrash2 } from "react-icons/fi";
import { message } from "../../components/ui/toast";
import MascotDeleteModal from "../../components/ui/MascotDeleteModal";
import { SnmpMascot } from "../../components/ui/systemMascots";
import { DeviceStates } from "../../components/ui/StateBlock";
import { useDeviceData } from "../../hooks/useDeviceData";
import { useAuth } from "../../contexts/AuthContext.logic";
import { apiErrorText } from "../../api/errorText";
import {
  DeviceDeleteSNMPCommunity, DeviceDeleteSNMPUser,
  DeviceGetSNMPSysInfo, DeviceListSNMPCommunities, DeviceListSNMPUsers,
  DeviceUpdateSNMPSysInfo,
  type SNMPCommunity, type SNMPSysInfo, type SNMPUser,
} from "../../api/snmp";
import CommunityFormDialog from "./community-form";
import UserFormDialog from "./user-form";
import { hostSummary, onOff } from "./model";
import { Field, Switch } from "./parts";

// System ▸ SNMP.
//
// One page over three CMDB tables, laid out the way FortiGate lays out its own: the agent's own
// settings at the top, then the v1/v2c communities, then the v3 users. The two lists are the
// console's standard list card (the devices page's shape) rather than FortiGate's select-a-row-
// then-press-Edit toolbar, so they behave like every other table here.
//
// Reads are strict — `{ strict: true }` and `useDeviceData` — for the reason this console applies
// everywhere but which bites hardest on this page: "no SNMP communities" and "we could not ask
// this firewall" are the same screen if a failed read returns an empty list, and the first is a
// claim about who can query this device that must never be invented.

const EMPTY_COMMUNITIES: SNMPCommunity[] = [];
const EMPTY_USERS: SNMPUser[] = [];

/** The agent card. Its own component so the page below stays a page and not a form. */
const AgentCard: React.FC<{
  deviceId: number | undefined;
  canWrite: boolean;
}> = ({ deviceId, canWrite }) => {
  const [info, setInfo] = useState<SNMPSysInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (id: number) => {
    try {
      setError(null);
      setInfo(await DeviceGetSNMPSysInfo(id));
    } catch (e: unknown) {
      // Strict, like the two lists: a failed read must not render as "the agent is off".
      setInfo(null);
      setError(apiErrorText(e, "Could not read the SNMP agent settings"));
    }
  }, []);

  useEffect(() => {
    if (deviceId === undefined) {
      setInfo(null);
      return;
    }
    void load(deviceId);
  }, [deviceId, load]);

  const save = async () => {
    if (!info || deviceId === undefined) return;
    try {
      setSaving(true);
      await DeviceUpdateSNMPSysInfo(deviceId, info);
      message.success("SNMP agent updated");
      await load(deviceId);
    } catch (e: unknown) {
      message.error(apiErrorText(e, "Could not update the SNMP agent"));
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof SNMPSysInfo>(k: K, v: SNMPSysInfo[K]) =>
    setInfo((s) => (s ? { ...s, [k]: v } : s));

  return (
    <div className="shell-card p-0! overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
        style={{ borderBottom: "1px solid var(--shell-border)" }}>
        <h2 className="m-0 text-[16px] font-semibold ink">System Information</h2>
        {canWrite && info && (
          <button type="button" className="btn btn-accent btn-sm" onClick={() => void save()} disabled={saving}>
            <FiSave size={13} /> {saving ? "Saving…" : "Apply"}
          </button>
        )}
      </div>

      <div className="px-4 py-3">
        {deviceId === undefined ? (
          <p className="m-0 py-6 text-center text-[13px] ink-3">Select a device to read its SNMP agent.</p>
        ) : error ? (
          <div className="py-6 text-center">
            <p className="m-0 text-[13px] text-red-600 dark:text-red-300">{error}</p>
            <p className="m-0 mt-1 text-[11.5px] ink-3">
              The agent may well be running — this is "unreadable", not "off".
            </p>
            <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => void load(deviceId)}>
              <FiRefreshCw size={12} /> Retry
            </button>
          </div>
        ) : !info ? (
          <p className="m-0 py-6 text-center text-[13px] ink-3">Reading the SNMP agent…</p>
        ) : (
          <>
            <Field label="SNMP Agent">
              <Switch checked={info.status} onChange={(v) => set("status", v)}
                disabled={!canWrite} label="SNMP agent" />
            </Field>
            <Field label="Description" htmlFor="snmp-desc">
              <input id="snmp-desc" className="shell-input shell-input--sm" disabled={!canWrite}
                value={info.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Field label="Location" htmlFor="snmp-loc">
              <input id="snmp-loc" className="shell-input shell-input--sm" disabled={!canWrite}
                value={info.location} onChange={(e) => set("location", e.target.value)} />
            </Field>
            <Field label="Contact Info" htmlFor="snmp-contact">
              <input id="snmp-contact" className="shell-input shell-input--sm" disabled={!canWrite}
                value={info.contact_info} onChange={(e) => set("contact_info", e.target.value)} />
            </Field>

            {/* Not on FortiGate's own SNMP page — it keeps these in the CLI — but two of the 42
                events ("CPU usage too high", "Available memory is low") mean nothing without them,
                so a page that offers those subscriptions should say what they fire at. */}
            <div className="mt-3 border-t hairline-2 pt-3">
              <p className="m-0 mb-1.5 text-[11.5px] ink-3">
                Thresholds the CPU, memory and log-space traps fire at (percent).
              </p>
              <div className="flex flex-wrap gap-4">
                {([
                  ["CPU", "trap_high_cpu_threshold"],
                  ["Memory", "trap_low_memory_threshold"],
                  ["Log space", "trap_log_full_threshold"],
                ] as const).map(([label, key]) => (
                  <label key={key} className="flex items-center gap-2 text-[12.5px] ink-2">
                    {label}
                    <input
                      inputMode="numeric"
                      aria-label={`${label} trap threshold`}
                      className="shell-input shell-input--sm w-20"
                      disabled={!canWrite}
                      value={String(info[key] ?? "")}
                      onChange={(e) => set(key, Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
                    />
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const SNMPPage: React.FC = () => {
  // isAdmin comes from the context, which trims and lower-cases the role first — a role stored as
  // "Admin" made the router serve the admin page while every hand-rolled check hid the buttons.
  const { isAdmin } = useAuth();

  const loadCommunities = useCallback(
    (deviceId: number) => DeviceListSNMPCommunities(deviceId, { strict: true }), []);
  const loadUsers = useCallback(
    (deviceId: number) => DeviceListSNMPUsers(deviceId, { strict: true }), []);

  const communities = useDeviceData<SNMPCommunity[]>(loadCommunities, EMPTY_COMMUNITIES);
  const users = useDeviceData<SNMPUser[]>(loadUsers, EMPTY_USERS);

  const device = communities.device;
  const canWrite = isAdmin && !!device;

  // `editing: undefined` is closed, `null` is create, an object is edit — one piece of state per
  // dialog rather than a boolean plus a target that can disagree with it.
  const [communityDialog, setCommunityDialog] = useState<SNMPCommunity | null | undefined>(undefined);
  const [userDialog, setUserDialog] = useState<SNMPUser | null | undefined>(undefined);
  const [deleteCommunity, setDeleteCommunity] = useState<SNMPCommunity | null>(null);
  const [deleteUser, setDeleteUser] = useState<SNMPUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const removeCommunity = async () => {
    if (!deleteCommunity || !device) return;
    try {
      setDeleting(true);
      await DeviceDeleteSNMPCommunity(device.id, deleteCommunity.id);
      message.success("SNMP community deleted");
      setDeleteCommunity(null);
      void communities.reload();
    } catch (e: unknown) {
      message.error(apiErrorText(e, "Could not delete the SNMP community"));
    } finally {
      setDeleting(false);
    }
  };

  const removeUser = async () => {
    if (!deleteUser || !device) return;
    try {
      setDeleting(true);
      await DeviceDeleteSNMPUser(device.id, deleteUser.name);
      message.success("SNMP user deleted");
      setDeleteUser(null);
      void users.reload();
    } catch (e: unknown) {
      message.error(apiErrorText(e, "Could not delete the SNMP user"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <AgentCard deviceId={device?.id} canWrite={canWrite} />

      {/* ── SNMP v1/v2c ─────────────────────────────────────────────────── */}
      <div className="shell-card p-0! overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
          style={{ borderBottom: "1px solid var(--shell-border)" }}>
          <h2 className="m-0 text-[16px] font-semibold ink">SNMP v1/v2c</h2>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void communities.reload()}>
              <FiRefreshCw size={13} className={communities.loading ? "animate-spin" : ""} /> Refresh
            </button>
            {canWrite && (
              <button type="button" className="btn btn-accent btn-sm" onClick={() => setCommunityDialog(null)}>
                <FiPlus size={13} /> Create New
              </button>
            )}
          </div>
        </div>

        <DeviceStates
          state={communities.viewState(communities.data.length)}
          from={device?.name}
          noun="SNMP community"
          icon={<FiActivity />}
          error={communities.error}
          onRetry={() => void communities.reload()}
          emptyAction={canWrite ? (
            <button type="button" className="btn btn-accent btn-sm mt-1" onClick={() => setCommunityDialog(null)}>
              <FiPlus size={13} /> Create the first SNMP community
            </button>
          ) : undefined}
        >
          <div className="overflow-x-auto shell-scroll-thin">
            <table className="shell-table w-full min-w-190">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Queries</th>
                  <th scope="col">Traps</th>
                  <th scope="col">Hosts</th>
                  <th scope="col">Events</th>
                  <th scope="col">Status</th>
                  <th className="text-right" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {communities.data.map((c) => (
                  <tr key={c.id}>
                    <td className="td-key"><span className="font-semibold">{c.name}</span></td>
                    <td>
                      <span className={`chip ${c.query_v1_status || c.query_v2c_status ? "chip-ok" : ""}`}>
                        {onOff(c.query_v1_status || c.query_v2c_status)}
                      </span>
                    </td>
                    <td>
                      <span className={`chip ${c.trap_v1_status || c.trap_v2c_status ? "chip-ok" : ""}`}>
                        {onOff(c.trap_v1_status || c.trap_v2c_status)}
                      </span>
                    </td>
                    <td><span className="block truncate ink-3">{hostSummary(c.hosts.map((h) => h.ip))}</span></td>
                    <td className="td-num">{c.events.length}</td>
                    <td>
                      <span className={`chip ${c.status ? "chip-ok" : "chip-warn"}`}>{onOff(c.status)}</span>
                    </td>
                    <td className="text-right">
                      {canWrite && (
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" className="btn-icon" title="Edit this community"
                            onClick={() => setCommunityDialog(c)}>
                            <FiEdit2 size={13} />
                          </button>
                          <button type="button" className="btn-icon btn-icon--danger" title="Delete this community"
                            onClick={() => setDeleteCommunity(c)}>
                            <FiTrash2 size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DeviceStates>
      </div>

      {/* ── SNMP v3 ─────────────────────────────────────────────────────── */}
      <div className="shell-card p-0! overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
          style={{ borderBottom: "1px solid var(--shell-border)" }}>
          <h2 className="m-0 text-[16px] font-semibold ink">SNMP v3</h2>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void users.reload()}>
              <FiRefreshCw size={13} className={users.loading ? "animate-spin" : ""} /> Refresh
            </button>
            {canWrite && (
              <button type="button" className="btn btn-accent btn-sm" onClick={() => setUserDialog(null)}>
                <FiPlus size={13} /> Create New
              </button>
            )}
          </div>
        </div>

        <DeviceStates
          state={users.viewState(users.data.length)}
          from={device?.name}
          noun="SNMP user"
          icon={<FiActivity />}
          error={users.error}
          onRetry={() => void users.reload()}
          emptyAction={canWrite ? (
            <button type="button" className="btn btn-accent btn-sm mt-1" onClick={() => setUserDialog(null)}>
              <FiPlus size={13} /> Create the first SNMP user
            </button>
          ) : undefined}
        >
          <div className="overflow-x-auto shell-scroll-thin">
            <table className="shell-table w-full min-w-200">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Security Level</th>
                  <th scope="col">Queries</th>
                  <th scope="col">Traps</th>
                  <th scope="col">Hosts</th>
                  <th scope="col">Events</th>
                  <th scope="col">Status</th>
                  <th className="text-right" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.name}>
                    <td className="td-key"><span className="font-semibold">{u.name}</span></td>
                    <td>
                      {/* The device's own words, which is what an operator comparing this against
                          FortiGate's page will be reading there. */}
                      <span className="block truncate ink-3">
                        {u.security_level === "auth-priv" ? "Authentication Private"
                          : u.security_level === "auth-no-priv" ? "Authentication"
                            : "No Authentication"}
                      </span>
                    </td>
                    <td><span className={`chip ${u.queries ? "chip-ok" : ""}`}>{onOff(u.queries)}</span></td>
                    <td><span className={`chip ${u.trap_status ? "chip-ok" : ""}`}>{onOff(u.trap_status)}</span></td>
                    <td><span className="block truncate ink-3">{hostSummary(u.notify_hosts)}</span></td>
                    <td className="td-num">{u.events.length}</td>
                    <td><span className={`chip ${u.status ? "chip-ok" : "chip-warn"}`}>{onOff(u.status)}</span></td>
                    <td className="text-right">
                      {canWrite && (
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" className="btn-icon" title="Edit this user"
                            onClick={() => setUserDialog(u)}>
                            <FiEdit2 size={13} />
                          </button>
                          <button type="button" className="btn-icon btn-icon--danger" title="Delete this user"
                            onClick={() => setDeleteUser(u)}>
                            <FiTrash2 size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DeviceStates>
      </div>

      {/* The `key` remounts the dialog per target, so each one seeds its form from the row it was
          opened on instead of syncing props into state with an effect. */}
      {communityDialog !== undefined && device && (
        <CommunityFormDialog
          key={communityDialog ? `c-${communityDialog.id}` : "c-new"}
          open
          deviceId={device.id}
          editing={communityDialog}
          onClose={() => setCommunityDialog(undefined)}
          onSaved={() => { setCommunityDialog(undefined); void communities.reload(); }}
        />
      )}
      {userDialog !== undefined && device && (
        <UserFormDialog
          key={userDialog ? `u-${userDialog.name}` : "u-new"}
          open
          deviceId={device.id}
          editing={userDialog}
          onClose={() => setUserDialog(undefined)}
          onSaved={() => { setUserDialog(undefined); void users.reload(); }}
        />
      )}

      {deleteCommunity && (
        <MascotDeleteModal
          mascot={<SnmpMascot className="h-24 w-24" title="Delete SNMP community" />}
          name={deleteCommunity.name}
          description={<>This SNMP community will be permanently removed from {device?.name}. Any manager polling with that community string stops being answered.</>}
          busy={deleting}
          onCancel={() => setDeleteCommunity(null)}
          onConfirm={removeCommunity}
        />
      )}
      {deleteUser && (
        <MascotDeleteModal
          mascot={<SnmpMascot className="h-24 w-24" title="Delete SNMP user" />}
          name={deleteUser.name}
          description={<>This SNMP user will be permanently removed from {device?.name}, along with its stored credentials.</>}
          busy={deleting}
          onCancel={() => setDeleteUser(null)}
          onConfirm={removeUser}
        />
      )}
    </div>
  );
};

export default SNMPPage;
