import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiPlus, FiEdit2, FiTrash2, FiRefreshCw,
} from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { useAuth } from "../../contexts/AuthContext.logic";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import MascotDeleteModal from "../../components/ui/MascotDeleteModal";
import { DhcpMascot } from "../../components/ui/networkMascots";
import { ErrorState, LoadingState, NoDeviceState } from "../../components/ui/StateBlock";
import { DeviceDeleteDHCPServer, DeviceListDHCPServers, type DHCPServer } from "../../api/dhcp";
import { describeDNS, describeServer, isBeyondThisForm } from "./model";

// Network ▸ DHCP Servers — which segments this firewall hands addresses out on.
//
// Create and Edit are their own pages (./create.tsx, ./edit.tsx) rather than a modal on this one —
// a DHCP server is one object with nested tables inside it (ranges, exclusions, MAC reservations),
// and that form earns more room than a dialog gives it.
//
// Two facts from the device get said out loud rather than shown as a field:
//
//   · A server whose ip_mode is `usrgrp`, or whose server_type is `ipsec`, takes its addresses
//     from somewhere the form does not edit. It is listed, marked, and not offered for editing —
//     an edit there would rewrite it into a plain range server.
//   · The domain cannot be CLEARED over the API on 7.2.10. The edit page says so at the moment the
//     box is emptied, and the backend refuses the write rather than reporting a success that is not one.

const EMPTY: DHCPServer[] = [];

// ── The page ─────────────────────────────────────────────────────────────────

const DHCPServersPage: React.FC = () => {
  const { isAdmin } = useAuth();
  const { device } = useSelectedDevice();
  const navigate = useNavigate();

  const [servers, setServers] = useState<DHCPServer[]>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<DHCPServer | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (deviceId: number) => {
    setLoading(true);
    setError(null);
    try {
      // strict: a firewall we could not read must never render as "no DHCP servers".
      const list = await DeviceListDHCPServers(deviceId, { strict: true });
      setServers(list);
    } catch (e: unknown) {
      setServers(EMPTY);
      setError(apiErrorText(e, "the DHCP configuration could not be read"));
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
      await DeviceDeleteDHCPServer(device.id, deleting.id);
      message.success(`DHCP server on ${deleting.interface} deleted from ${device.name}`);
      setDeleting(null);
      await load(device.id);
    } catch (e: unknown) {
      message.error(apiErrorText(e, "the DHCP server could not be deleted"));
    } finally {
      setBusy(false);
    }
  };

  if (!device) return <NoDeviceState />;

  return (
    <div className="space-y-4">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass. The server count it used to badge is not lost, just not repeated here —
          the table's own row count already shows it. */}
      <div className="flex items-center justify-end gap-2">
        <button className="btn btn-soft btn-sm" onClick={() => void load(device.id)} disabled={loading}>
          <FiRefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
        {isAdmin && !loading && !error && (
          <button
            className="btn btn-accent btn-sm"
            onClick={() => navigate(`/admin/dhcp-servers/create?deviceId=${device.id}`)}
          >
            <FiPlus size={13} /> Create new
          </button>
        )}
      </div>

      {loading ? (
        <div className="panel"><LoadingState what="DHCP server" from={device.name} /></div>
      ) : error ? (
        <div className="panel">
          <ErrorState
            title={`Could not read DHCP servers from ${device.name}`}
            detail={error}
            note="Servers may well be configured — this is 'unreadable', not 'none'"
            onRetry={() => void load(device.id)}
          />
        </div>
      ) : servers.length === 0 ? (
        <div className="panel">
          <p className="t-meta m-0 px-4 py-8 text-center">
            {device.name} is not handing out addresses on any interface
          </p>
        </div>
      ) : (
        <div className="panel p-0">
          {servers.map((s, i) => (
            <div
              key={s.id}
              className={`flex flex-wrap items-center gap-3 px-4 py-3${i < servers.length - 1 ? " border-b hairline-2" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <p className="m-0 flex items-center gap-2 text-[13px] font-semibold ink">
                  {s.interface || `server ${s.id}`}
                  {!s.status && <span className="chip">disabled</span>}
                  {isBeyondThisForm(s) && (
                    <span className="chip chip-warn">
                      {s.server_type === "ipsec" ? "dial-up VPN" : "addresses from a user group"}
                    </span>
                  )}
                </p>
                <p className="m-0 t-meta font-mono">{describeServer(s)}</p>
                <p className="m-0 t-meta">
                  DNS: {describeDNS(s)}
                  {s.reservations.length > 0 && ` · ${s.reservations.length} MAC reservation${s.reservations.length === 1 ? "" : "s"}`}
                  {s.exclude_ranges.length > 0 && ` · ${s.exclude_ranges.length} excluded range${s.exclude_ranges.length === 1 ? "" : "s"}`}
                  {s.domain && ` · domain ${s.domain}`}
                </p>
              </div>
              {isAdmin && (
                <div className="flex gap-1">
                  <button
                    className="btn-icon"
                    aria-label={`Edit the DHCP server on ${s.interface}`}
                    disabled={isBeyondThisForm(s)}
                    title={isBeyondThisForm(s)
                      ? "This server takes its addresses from somewhere this form does not edit"
                      : undefined}
                    onClick={() => navigate(`/admin/dhcp-servers/edit?deviceId=${device.id}&id=${s.id}`)}
                  >
                    <FiEdit2 size={13} />
                  </button>
                  <button
                    className="btn-icon btn-icon--danger"
                    aria-label={`Delete the DHCP server on ${s.interface}`}
                    onClick={() => setDeleting(s)}
                  >
                    <FiTrash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {deleting && (
        <MascotDeleteModal
          mascot={<DhcpMascot className="h-24 w-24" title="Delete DHCP server" />}
          name={deleting.interface}
          description={<>The DHCP server on this interface will be removed from {device.name}. Clients on that segment stop getting addresses as their leases expire.</>}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
};

export default DHCPServersPage;
