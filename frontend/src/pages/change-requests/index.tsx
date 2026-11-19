import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiInbox, FiRefreshCw, FiUser, FiUsers } from "react-icons/fi";
import PageHeader from "../../components/ui/PageHeader";
import SearchInput from "../../components/ui/SearchInput";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/StateBlock";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import { apiErrorText } from "../../api/errorText";
import { ListChangeRequests, type ChangeRequest, type ChangeRequestStatus } from "../../api/changeRequests";
import { formatDateTime } from "../../lib/datetime";
import ActionSummary from "./action";
import RequestDetail from "./detail";
import {
  STATUS_FILTERS, STATUS_LABELS, countByStatus, describeAction, isExpired, statusTone,
} from "./model";

// Change Requests — the queue of firewall writes that have NOT happened yet.
//
// middleware.RequireApproval turns a non-admin's write to a firewall policy, a virtual IP or a
// security profile into a row here and answers 202 instead of touching the device. The backend for
// that has existed and worked for some time; this page is what makes it reachable. Without it the
// queue could only ever grow — which is why no non-admin account could usefully exist.
//
// ── What the list leads with, and why ────────────────────────────────────────
//
// The derived action (`method` + `path`, summarised through `resource_type` / `resource_key`) and
// the device — not prose. entity.ChangeRequest's own comment used to say the title was "the only
// part of a request a reviewer reads before deciding whether to open it", and that is exactly the
// confused deputy this queue is supposed to prevent: an admin can be talked into approving "small
// firewall tweak" far more easily than into approving `Delete firewall policy 3`.
//
// The server now derives that title itself and files whatever the requester typed under the reason
// (services.PrepareChangeRequest). This page does the same derivation again rather than printing
// the stored string, for two reasons: it can be read in Thai and Chinese, and it can name the
// sub-route verbs the stored resource key drops — a `…/12/move` is a reorder of a first-match
// table, not an "update". The stored title is shown in the detail dialog, beside the derived
// summary, where a row raised before the server fix will visibly disagree with it.
//
// ── Reading the queue ───────────────────────────────────────────────────────
//
// This reads the console's own database, not a firewall, so there is no device selection and no
// useDeviceData: a queue of proposed changes has to be readable when the device is unreachable,
// which is one of the times somebody most wants to look at it. What does carry over from the device
// pages is the rule that matters — a read that FAILED renders as an error, never as an empty
// queue. "Nothing is waiting for review" and "we cannot see what is waiting for review" are
// different answers, and one of them is dangerous.

const EMPTY: ChangeRequest[] = [];

/** The server's own ceiling on one page of the queue (controller/changerequest List). */
const SERVER_LIMIT = 500;

const COLS = "minmax(0,2.3fr) minmax(0,1fr) minmax(0,1.3fr) 150px 170px 64px";

type Bucket = ChangeRequestStatus | "all";

const ChangeRequestsPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const { user, isAdmin } = useAuth();
  const viewer = useMemo(() => ({ id: user?.id ?? 0, isAdmin }), [user?.id, isAdmin]);

  const [rows, setRows] = useState<ChangeRequest[]>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A requester opens this page to see their own queue; a reviewer opens it to see everybody's.
  const [mine, setMine] = useState(!isAdmin);
  const [bucket, setBucket] = useState<Bucket>("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  // Only the newest read may paint: toggling "mine" twice quickly must not let the first answer
  // land last and show the other scope.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mineRun = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await ListChangeRequests({ mine });
      if (mineRun === seq.current) setRows(data);
    } catch (e: unknown) {
      if (mineRun === seq.current) {
        setError(apiErrorText(e, "The change request queue could not be read"));
        setRows(EMPTY);
      }
    } finally {
      if (mineRun === seq.current) setLoading(false);
    }
  }, [mine]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => countByStatus(rows), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (bucket !== "all" && r.status !== bucket) return false;
      if (q === "") return true;
      const action = describeAction(r);
      return [
        action.verb, action.noun, action.key,
        r.title, r.reason, r.requested_by, r.resource_type, r.resource_key, r.path, r.method,
        r.network_device?.name ?? "", STATUS_LABELS[r.status] ?? r.status,
      ].some((s) => s.toLowerCase().includes(q));
    });
  }, [rows, bucket, search]);

  const open = openId === null ? null : rows.find((r) => r.id === openId) ?? null;
  const waiting = counts.pending ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<FiInbox />}
        title="Change Requests"
        accent={currentColor}
        subtitle="Firewall writes proposed by somebody who may not apply them, waiting for a second pair of eyes"
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search the queue…" width="w-56" />
            <div className="seg" role="radiogroup" aria-label="Whose requests">
              <button type="button" role="radio" aria-checked={!mine} onClick={() => setMine(false)}
                className={`seg-item flex items-center gap-1.5${!mine ? " seg-item--on" : ""}`}
                style={!mine ? { color: currentColor } : undefined}>
                <FiUsers size={12} /> Everyone
              </button>
              <button type="button" role="radio" aria-checked={mine} onClick={() => setMine(true)}
                className={`seg-item flex items-center gap-1.5${mine ? " seg-item--on" : ""}`}
                style={mine ? { color: currentColor } : undefined}>
                <FiUser size={12} /> Mine
              </button>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition disabled:opacity-50">
              <FiRefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </>
        }
      />

      <p className="banner m-0 text-[11.5px] leading-5">
        Nothing on this list is in force. A write to a firewall policy, a virtual IP or a security
        profile by an account that may not apply changes is held here instead of reaching the
        device. Read what each request does — the action and the device it lands on — before the
        words the requester chose for it.
      </p>

      {isAdmin && waiting > 0 && (
        <p className="banner banner-warn m-0 text-[11.5px] font-semibold">
          Waiting for your review: {waiting}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {(["all", ...STATUS_FILTERS] as Bucket[]).map((b) => {
          const on = bucket === b;
          const n = b === "all" ? rows.length : counts[b] ?? 0;
          return (
            <button
              key={b}
              type="button"
              onClick={() => setBucket(b)}
              className="rounded-[5px] px-2.5 py-1 text-[11px] font-bold transition"
              style={{
                background: on ? currentColor : "transparent",
                color: on ? "#fff" : "#64748b",
                border: `1px solid ${on ? "transparent" : "#cbd5e155"}`,
              }}
            >
              {b === "all" ? "All" : STATUS_LABELS[b]}
              {` · ${n}`}
            </button>
          );
        })}
      </div>

      {loading && rows.length === 0 ? (
        <LoadingState what="change request queue" />
      ) : error ? (
        <ErrorState
          title="The change request queue could not be read"
          detail={error}
          note="Requests may well be waiting for review — this list is “unreadable”, not “empty”"
          onRetry={() => void load()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FiInbox size={18} />}
          title={
            search !== "" || bucket !== "all"
              ? "No change request matches this filter"
              : mine
                ? "You have not raised a change request"
                : "Nothing has been proposed yet"
          }
          hint="A write to a firewall policy, a virtual IP or a security profile by an account that cannot apply changes appears here."
        />
      ) : (
        <div className="shell-card overflow-hidden p-0!">
          <div className="overflow-x-auto">
            <div className="min-w-220">
              <div className="grid border-b hairline-2 px-4 py-2" style={{ gridTemplateColumns: COLS }}>
                <span className="t-label">What it does</span>
                <span className="t-label">Device</span>
                <span className="t-label">Raised by</span>
                <span className="t-label">Raised</span>
                <span className="t-label">Status</span>
                <span className="t-label" />
              </div>
              {filtered.map((r) => {
                const tone = statusTone(r.status);
                const stale = isExpired(r, new Date());
                return (
                  <div key={r.id} className="grid items-center border-b hairline-2 px-4 py-2.5 last:border-0 surface-hover"
                    style={{ gridTemplateColumns: COLS }}>
                    <span className="min-w-0 pr-3">
                      <ActionSummary request={r} />
                      {/* The exact route, quietly, under the summary. Not the requester's wording
                          and not the stored title: the route is the only line that is true for
                          every row whatever derived or typed it, and it carries the sub-route the
                          stored resource key drops (…/12/move, …/bulk/delete). */}
                      <code className="t-mono mt-0.5 block truncate text-[10.5px] ink-3">
                        {`${r.method} ${r.path}`}
                      </code>
                    </span>
                    <span className="truncate pr-3 text-[12px] ink-2" title={r.network_device?.name ?? ""}>
                      {r.network_device?.name ?? "—"}
                    </span>
                    <span className="truncate pr-3 text-[11.5px] ink-2" title={r.requested_by}>
                      {r.requested_by}
                    </span>
                    <span className="pr-3 text-[11.5px] ink-3">{formatDateTime(r.requested_at)}</span>
                    <span className="pr-3">
                      <span className={`chip ${tone.chip} text-[10px]`}>{STATUS_LABELS[r.status]}</span>
                      {stale && <span className="t-meta mt-0.5 block">Past its expiry</span>}
                    </span>
                    <span className="text-right">
                      <button type="button" onClick={() => setOpenId(r.id)}
                        className="rounded-[4px] border hairline px-2.5 py-1 text-[11px] font-semibold ink-2 surface-hover transition"
                        aria-label={`Open change request ${r.id}`}>
                        Open
                      </button>
                    </span>
                  </div>
                );
              })}
              {rows.length >= SERVER_LIMIT && (
                <p className="t-meta m-0 px-4 py-2">
                  {`Showing the newest ${rows.length} requests — older ones are not listed`}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {open && (
        <RequestDetail
          request={open}
          viewer={viewer}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
};

export default ChangeRequestsPage;
