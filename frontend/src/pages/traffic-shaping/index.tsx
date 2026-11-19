import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiPlus, FiEdit2, FiTrash2, FiRefreshCw, FiInfo } from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { useAuth } from "../../contexts/AuthContext.logic";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import ConfirmDeleteModal from "../../components/ui/ConfirmDeleteModal";
import { ErrorState, LoadingState, NoDeviceState } from "../../components/ui/StateBlock";
import {
  DeviceListTrafficShapers, DeviceDeleteTrafficShaper,
  DeviceListShapingPolicies, DeviceDeleteShapingPolicy,
  type TrafficShaper, type ShapingPolicy,
} from "../../api/trafficShaper";
import { describeShaper } from "./model";

// Policy & Objects ▸ Traffic Shaping.
//
// Two objects that only work together, so they are one screen: a shaper is a LIMIT, a shaping
// policy is WHICH traffic gets it. Either is valid on its own and a shaper with no policy shapes
// nothing — the device shows you that silently, so the list carries a "used by" count and says
// plainly when it is zero.
//
// The per-policy field gets a sentence rather than a checkbox label. It is one enable/disable
// string whose meaning is a factor of however many policies share the shaper, and "a shaper that
// worked in testing and starves in production" is almost always this.

const EMPTY_SHAPERS: TrafficShaper[] = [];
const EMPTY_POLICIES: ShapingPolicy[] = [];

const TrafficShapingPage: React.FC = () => {
  const { isAdmin } = useAuth();
  const { device } = useSelectedDevice();
  const navigate = useNavigate();

  const [shapers, setShapers] = useState<TrafficShaper[]>(EMPTY_SHAPERS);
  const [policies, setPolicies] = useState<ShapingPolicy[]>(EMPTY_POLICIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deleteShaper, setDeleteShaper] = useState<TrafficShaper | null>(null);
  const [deletePolicy, setDeletePolicy] = useState<ShapingPolicy | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (deviceId: number) => {
    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.all([
        DeviceListTrafficShapers(deviceId, { strict: true }),
        DeviceListShapingPolicies(deviceId, { strict: true }),
      ]);
      setShapers(s);
      setPolicies(p);
    } catch (e: unknown) {
      setShapers(EMPTY_SHAPERS);
      setPolicies(EMPTY_POLICIES);
      setError(apiErrorText(e, "the traffic shaping configuration could not be read"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!device) return;
    void load(device.id);
  }, [device, load]);

  const doDeleteShaper = async () => {
    if (!device || !deleteShaper) return;
    setBusy(true);
    try {
      await DeviceDeleteTrafficShaper(device.id, deleteShaper.name);
      message.success(`Shaper "${deleteShaper.name}" deleted from ${device.name}`);
      setDeleteShaper(null);
      await load(device.id);
    } catch (e: unknown) {
      message.error(apiErrorText(e, `"${deleteShaper.name}" could not be deleted`));
    } finally {
      setBusy(false);
    }
  };

  const doDeletePolicy = async () => {
    if (!device || !deletePolicy) return;
    setBusy(true);
    try {
      await DeviceDeleteShapingPolicy(device.id, deletePolicy.id);
      message.success("Shaping policy deleted from device");
      setDeletePolicy(null);
      await load(device.id);
    } catch (e: unknown) {
      message.error(apiErrorText(e, "the shaping policy could not be deleted"));
    } finally {
      setBusy(false);
    }
  };

  if (!device) return <NoDeviceState />;

  return (
    <div className="space-y-4">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass — this row keeps only what the old hero's `actions` slot carried: the
          manual refresh. The shaper/policy counts it used to badge are not lost, just relocated
          onto the "Shapers" and "Shaping policies" section headers below. */}
      <div className="flex items-center justify-end">
        <button className="btn btn-soft btn-sm" onClick={() => void load(device.id)} disabled={loading}>
          <FiRefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="banner banner-accent">
        <FiInfo size={14} className="shrink-0" />
        <span>
          A shaper is a limit. A shaping policy is which traffic gets it. Either is valid on its
          own, and a shaper with no policy shapes nothing — which is what the &quot;used by&quot;
          column is for.
        </span>
      </div>

      {loading ? (
        <div className="panel"><LoadingState what="traffic shaper" from={device.name} /></div>
      ) : error ? (
        <div className="panel">
          <ErrorState
            title={`Could not read traffic shaping from ${device.name}`}
            detail={error}
            note="Shapers may well be configured — this is 'unreadable', not 'none'"
            onRetry={() => void load(device.id)}
          />
        </div>
      ) : (
        <>
          <div className="panel p-0">
            <div className="flex items-center justify-between border-b hairline-2 px-4 py-2.5">
              <span className="flex items-center gap-2">
                <span className="t-label m-0">Shapers</span>
                <span className="rounded-full surface-sunken px-1.5 text-[10px] font-bold ink-2">{shapers.length}</span>
              </span>
              {isAdmin && (
                <button className="btn btn-accent btn-sm" onClick={() => navigate("/admin/traffic-shaping/shapers/create")}>
                  <FiPlus size={13} /> Create new
                </button>
              )}
            </div>
            {shapers.length === 0 ? (
              <p className="t-meta m-0 px-4 py-6 text-center">This device has no traffic shaper yet</p>
            ) : shapers.map((s, i) => (
              <div key={s.name}
                   className={`flex flex-wrap items-center gap-3 px-4 py-3${i < shapers.length - 1 ? " border-b hairline-2" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[13px] font-semibold ink">{s.name}</p>
                  <p className="m-0 t-meta">{describeShaper(s)}</p>
                </div>
                <span className={`chip ${s.used_by === 0 ? "chip-warn" : s.used_by < 0 ? "" : "chip-ok"}`}>
                  {s.used_by < 0 ? "usage unknown" : s.used_by === 0 ? "used by nothing" : `used by ${s.used_by}`}
                </span>
                {isAdmin && (
                  <div className="flex gap-1">
                    <button className="btn-icon" aria-label={`Edit ${s.name}`}
                            onClick={() => navigate(`/admin/traffic-shaping/shapers/edit?name=${encodeURIComponent(s.name)}`)}>
                      <FiEdit2 size={13} />
                    </button>
                    <button className="btn-icon btn-icon--danger" aria-label={`Delete ${s.name}`}
                            onClick={() => setDeleteShaper(s)}>
                      <FiTrash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="panel p-0">
            <div className="flex items-center justify-between border-b hairline-2 px-4 py-2.5">
              <span className="flex items-center gap-2">
                <span className="t-label m-0">Shaping policies</span>
                <span className="rounded-full surface-sunken px-1.5 text-[10px] font-bold ink-2">{policies.length}</span>
              </span>
              {isAdmin && shapers.length > 0 && (
                <button className="btn btn-accent btn-sm" onClick={() => navigate("/admin/traffic-shaping/policies/create")}>
                  <FiPlus size={13} /> Create new
                </button>
              )}
            </div>
            {policies.length === 0 ? (
              <p className="t-meta m-0 px-4 py-6 text-center">
                No shaping policy, so none of the shapers above are applied to anything
              </p>
            ) : policies.map((p, i) => (
              <div key={p.id}
                   className={`flex flex-wrap items-center gap-3 px-4 py-3${i < policies.length - 1 ? " border-b hairline-2" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[13px] font-semibold ink">{p.name || `policy ${p.id}`}</p>
                  <p className="m-0 t-meta">
                    {`${p.srcintf.join(",") || "any"} → ${p.dstintf.join(",") || "any"} · ${p.service.join(", ")}`}
                  </p>
                  <p className="m-0 t-meta">
                    {`forward: ${p.traffic_shaper || "—"} · reverse: ${p.traffic_shaper_reverse || "—"}`}
                  </p>
                </div>
                {!p.status && <span className="chip">disabled</span>}
                {isAdmin && (
                  <button className="btn-icon btn-icon--danger" aria-label={`Delete policy ${p.id}`}
                          onClick={() => setDeletePolicy(p)}>
                    <FiTrash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {deleteShaper && (
        <ConfirmDeleteModal
          eyebrow="DELETE SHAPER" title="Delete from device?" busy={busy}
          onCancel={() => setDeleteShaper(null)} onConfirm={() => void doDeleteShaper()}
        >
          {deleteShaper.used_by > 0
            ? `"${deleteShaper.name}" is used by ${deleteShaper.used_by} shaping ${deleteShaper.used_by === 1 ? "policy" : "policies"}. The device refuses the delete while that is true.`
            : `Shaper "${deleteShaper.name}" will be removed from ${device.name}.`}
        </ConfirmDeleteModal>
      )}

      {deletePolicy && (
        <ConfirmDeleteModal
          eyebrow="DELETE SHAPING POLICY" title="Delete from device?" busy={busy}
          onCancel={() => setDeletePolicy(null)} onConfirm={() => void doDeletePolicy()}
        >
          {`This policy will stop shaping the traffic it matches. The shapers it names stay.`}
        </ConfirmDeleteModal>
      )}
    </div>
  );
};

export default TrafficShapingPage;
