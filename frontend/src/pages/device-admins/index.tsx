import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiUserCheck, FiPlus, FiEdit2, FiTrash2, FiRefreshCw,
} from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import ConfirmDeleteModal from "../../components/ui/ConfirmDeleteModal";
import { ErrorState, LoadingState, NoDeviceState } from "../../components/ui/StateBlock";
import {
  DeviceListAdminUsers, DeviceDeleteAdminUser,
  type AdminLists, type AdminUser,
} from "../../api/systemSettings";
import { describeProfile, describeReach, describeTwoFactor, isLastSuperAdmin } from "./model";

// System ▸ Administrators — the accounts that can log in to THE FIREWALL.
//
// Not this console's users. Those live in Postgres, under Security ▸ Users, and have nothing to do
// with these: an account on this page can log in to the device directly over HTTPS or SSH with no
// involvement from this application. The banner says so, because the two lists look alike and
// mixing them up means granting the wrong access to the wrong system.
//
// The whole page is admin-only, including the read — the list names who can administer the
// firewall, from where, and which of them have no second factor.
//
// Two changes can take the device away from the person making them, and each is handled at the
// point it happens:
//
//   · narrowing an account's trusted hosts — warned in the form, confirmed in a dialog, and
//     refused by the API without confirm_lockout
//   · removing or demoting the last super_admin — refused outright, here and on the server, because
//     there is no situation where it is what somebody meant

const EMPTY: AdminLists = { admins: [], profiles: [], profiles_readable: true };

const DeviceAdminsPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const { device } = useSelectedDevice();
  const navigate = useNavigate();

  const [lists, setLists] = useState<AdminLists>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (deviceId: number) => {
    setLoading(true);
    setError(null);
    try {
      setLists(await DeviceListAdminUsers(deviceId));
    } catch (e: unknown) {
      setLists(EMPTY);
      setError(apiErrorText(e, "the administrator accounts could not be read"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!device) return;
    void load(device.id);
  }, [device, load]);

  const doDelete = async () => {
    if (!device || !deleting) return;
    setBusy(true);
    try {
      await DeviceDeleteAdminUser(device.id, deleting.name);
      message.success(`${deleting.name} deleted from ${device.name}`);
      setDeleting(null);
      await load(device.id);
    } catch (e: unknown) {
      message.error(apiErrorText(e, `${deleting.name} could not be deleted`));
    } finally {
      setBusy(false);
    }
  };

  if (!device) return <NoDeviceState />;

  const profileOf = (name: string) => lists.profiles.find((p) => p.name === name);
  const openCreate = () => navigate(`/admin/device-admins/create?deviceId=${device.id}`);
  const openEdit = (a: AdminUser) => navigate(`/admin/device-admins/edit?deviceId=${device.id}&name=${encodeURIComponent(a.name)}`);

  const refreshAction = (
    <button className="btn btn-soft btn-sm" onClick={() => void load(device.id)} disabled={loading}>
      <FiRefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
    </button>
  );
  const createAction = (
    <button className="btn btn-accent btn-sm" onClick={openCreate}>
      <FiPlus size={13} /> Create new
    </button>
  );

  return (
    <div className="space-y-4">
      {(loading || error) && (
        <PageHeader icon={<FiUserCheck />} title="Administrators" accent={currentColor} actions={refreshAction} />
      )}

      {loading ? (
        <div className="panel"><LoadingState what="administrator" from={device.name} /></div>
      ) : error ? (
        <div className="panel">
          <ErrorState
            title={`Could not read the administrators from ${device.name}`}
            detail={error}
            note="Accounts certainly exist — this is 'unreadable', not 'none'"
            onRetry={() => void load(device.id)}
          />
        </div>
      ) : (
        <>
          {/* ── Administrators ── */}
          <div className="panel p-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b hairline-2 px-4 py-3">
              <div className="min-w-0">
                <h2 className="m-0 text-[14px] font-semibold ink">Administrators</h2>
                <p className="t-meta m-0 mt-0.5">
                  Log in to the device itself, over HTTPS or SSH — not this console's own users (Security ▸ Users).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {refreshAction}
                {createAction}
              </div>
            </div>
            {lists.admins.length === 0 ? (
              <p className="ink-3 m-0 px-4 py-8 text-center text-[12.5px]">No administrator accounts on this device.</p>
            ) : lists.admins.map((a, i) => {
              const isExposed = !a.restricted_to_hosts && (!a.two_factor || a.two_factor === "disable");
              const last = isLastSuperAdmin(lists.admins, a.name);
              return (
                <div
                  key={a.name}
                  className={`surface-hover flex items-center gap-3 px-4 py-2.5 transition-colors${i < lists.admins.length - 1 ? " border-b hairline-2" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="m-0 flex flex-wrap items-center gap-1.5 text-[13px] font-semibold ink">
                      {a.name}
                      {a.is_super_admin && <span className="chip chip-warn">full control</span>}
                      {a.remote_auth && <span className="chip chip-info">remote auth</span>}
                      {isExposed && <span className="chip chip-danger" title="Reachable from any address with no second factor">exposed</span>}
                      {last && <span className="chip">only full admin</span>}
                    </p>
                    <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 t-meta">
                      <span>{a.accprofile} — {describeProfile(profileOf(a.accprofile))}</span>
                      <span>{describeReach(a)}</span>
                      <span>{describeTwoFactor(a)}</span>
                      {a.ssh_public_key_set && <span>SSH key set</span>}
                      {a.comments && <span className="italic">{a.comments}</span>}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button className="btn-icon" aria-label={`Edit ${a.name}`} onClick={() => openEdit(a)}>
                      <FiEdit2 size={13} />
                    </button>
                    <button
                      className="btn-icon btn-icon--danger"
                      aria-label={`Delete ${a.name}`}
                      disabled={last}
                      title={last ? "This is the only account that can fully administer the firewall" : undefined}
                      onClick={() => setDeleting(a)}
                    >
                      <FiTrash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Access profiles ── */}
          <div className="panel p-0 overflow-hidden">
            <div className="border-b hairline-2 px-4 py-3">
              <h2 className="m-0 text-[14px] font-semibold ink">Access profiles</h2>
              <p className="t-meta m-0 mt-0.5">What each profile allows. Edited on the device.</p>
            </div>
            {lists.profiles.map((p, i) => (
              <div
                key={p.name}
                className={`surface-hover flex items-center gap-3 px-4 py-2.5 transition-colors${i < lists.profiles.length - 1 ? " border-b hairline-2" : ""}`}
              >
                <span className={`chip ${p.is_super_admin ? "chip-warn" : (p.write_groups?.length ? "chip-accent" : "")}`}>
                  {p.is_super_admin ? "super" : (p.write_groups?.length ? "read/write" : "read-only")}
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-[13px] font-semibold ink">{p.name}</p>
                  <p className="m-0 t-meta">{describeProfile(p)}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {deleting && (
        <ConfirmDeleteModal
          eyebrow="DELETE ADMINISTRATOR"
          title="Delete from device?"
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={doDelete}
        >
          {`${deleting.name} will no longer be able to log in to ${device.name}. FortiOS refuses to delete an account that is logged in right now — if that is the case you will be told to wait for the session to time out.`}
        </ConfirmDeleteModal>
      )}
    </div>
  );
};

export default DeviceAdminsPage;
