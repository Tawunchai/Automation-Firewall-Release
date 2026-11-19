import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  FiChevronDown, FiChevronLeft, FiChevronRight, FiEdit2, FiInfo, FiMail, FiMapPin, FiPhone,
  FiShield, FiTrash2, FiUser, FiX, FiAlertTriangle,
  FiPlus, FiUsers, FiCheck, FiHardDrive,
} from "react-icons/fi";
import { DeleteUserByID, ListUser, ListRoles, BulkDeleteUsers, BulkChangeRole, type UserResponse } from "../../api";
import { GetMyActivityLogSummary, type ActivitySummary } from "../../api/activitylog";
import { GetDeviceAccessSummary, describeDeviceAccess } from "../../api/deviceAccess";
import { useAuth } from "../../contexts/AuthContext.logic";
import { useStateContext } from "../../contexts/ProviderContext.logic";

import { message } from "../../components/ui/toast";
import SearchInput from "../../components/ui/SearchInput";
import MinimalSelect from "../../components/ui/MinimalSelect";
import UserFormModal from "../../components/ui/UserFormModal";
import StatCards from "./card";
import VirusMascot from "../../components/ui/VirusMascot";
import { apiErrorDetail, apiErrorText } from "../../api/errorText";

const SORT_KEYS = ["Oldest", "Newest", "Role: Admin First", "Role: User First", "Name A-Z"] as const;
type SortKey = (typeof SORT_KEYS)[number];
type UiUser = { id: number; email: string; first_name: string; last_name: string; profile: string; phone_number: string; location: string; position: string; role: "Admin" | "User" | string; };

const isBase64DataImage = (v: string) => /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,/i.test((v || "").trim());

/**
 * "Which firewalls may this person work on", as one READ-ONLY cell.
 *
 * It used to be a button that opened its own dialog. That gave one account two separate ways to be
 * changed, and made a cell that reads as a label behave as a control — so the grants are now edited
 * in the edit-user dialog, behind the pencil, like every other field on the row.
 *
 * The three states it distinguishes are the point of the column. An admin is not "0 of 3" — they
 * reach everything, and a count there would imply a restriction that does not exist. Zero grants is
 * not "no devices exist", it is "this person cannot open a single device page". Both are easy to
 * render wrongly, so the wording comes from describeDeviceAccess, which is unit-tested.
 */
const DeviceAccessCell: React.FC<{
  role: string;
  granted: number;
  total: number;
}> = ({ role, granted, total }) => {
  const { label, tone } = describeDeviceAccess(role, granted, total);
  const chipClass =
    tone === "admin" ? "chip chip-info"
      : tone === "none" ? "chip chip-warn"
        : tone === "all" ? "chip chip-ok"
          : "chip chip-accent";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-1"
      title={tone === "admin"
        ? "Administrators reach every device"
        : "Edit this user to change which devices they can work on"}
    >
      <FiHardDrive className="text-[11px] ink-3" />
      <span className={chipClass}>{label}</span>
    </span>
  );
};

const Index: React.FC = () => {
  const { t } = useTranslation();
  const { user: authUser, isLoading: authLoading } = useAuth();
  const { currentColor } = useStateContext();

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("Oldest");
  const [rows, setRows] = useState<UiUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<UiUser | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");
  const [openEditModal, setOpenEditModal] = useState(false);
  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UiUser | null>(null);
  // An aggregate count, not a page of raw rows: /activity-logs is paginated, and the tile used to
  // divide up its default 50-row page and call the result "all time". Only `total` is read now —
  // the per-day and per-action breakdowns fed the three charts that used to sit above the table.
  const [activity, setActivity] = useState<ActivitySummary>({ total: 0, actions: [], days: [], window_days: 14 });
  const [activityLoading, setActivityLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [roles, setRoles] = useState<{ id: number; role: string }[]>([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [bulkRoleChanging, setBulkRoleChanging] = useState(false);
  // Which firewalls each person may work on. One aggregate call for the whole table rather than a
  // query per row — this is the page where an N+1 would be felt first.
  const [accessCounts, setAccessCounts] = useState<Record<string, number>>({});
  const [deviceTotal, setDeviceTotal] = useState(0);
  const hasFetchedRef = useRef(false);

  const currentUserId = authUser?.id ?? null;

  const getSortLabel = (key: SortKey): string => ({
    "Oldest": t("user.oldest"), "Newest": t("user.newest"), "Role: Admin First": t("user.roleAdminFirst"),
    "Role: User First": t("user.roleUserFirst"), "Name A-Z": t("user.nameAZ"),
  })[key] ?? key;

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true); setError("");
      const data = await ListUser();
      if (!data) { setRows([]); setError(t("user.loadFailed")); return; }
      setRows((data as UserResponse[]).map((u) => ({
        id: u.id, email: u.email ?? "", first_name: u.first_name ?? "", last_name: u.last_name ?? "",
        profile: u.profile ?? "", phone_number: u.phone_number ?? "", location: u.location ?? "",
        position: u.position ?? "", role: u.role ?? "User",
      })));
    } catch { setRows([]); setError(t("user.loadFailed")); }
    finally { setLoading(false); }
  }, [t]);

  const fetchAccess = useCallback(async () => {
    try {
      const s = await GetDeviceAccessSummary();
      setAccessCounts(s.counts ?? {});
      setDeviceTotal(s.device_total ?? 0);
    } catch {
      // Non-fatal: the column falls back to "—" rather than taking the whole page down over a
      // secondary read.
      setAccessCounts({});
    }
  }, []);

  useEffect(() => {
    if (authLoading || hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    Promise.all([
      fetchUsers(),
      fetchAccess(),
      GetMyActivityLogSummary().then(setActivity).finally(() => setActivityLoading(false)),
      ListRoles().then((data) => { if (data) setRoles(data); }),
    ]);
  }, [authLoading, fetchUsers, fetchAccess]);

  const users = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((u) => [u.first_name, u.last_name, u.email, u.phone_number, u.location, u.role, u.position].join(" ").toLowerCase().includes(q));
    return [...filtered].sort((a, b) => {
      if (sortBy === "Oldest") return a.id - b.id;
      if (sortBy === "Newest") return b.id - a.id;
      if (sortBy === "Role: Admin First") return a.role === b.role ? `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`) : a.role === "Admin" ? -1 : 1;
      if (sortBy === "Role: User First")  return a.role === b.role ? `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`) : a.role === "User"  ? -1 : 1;
      return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
    });
  }, [rows, search, sortBy]);

  // Paged like the devices list. Any change that can shorten the result set sends you back to
  // page 1 — otherwise filtering down to three rows while on page 4 shows an empty table.
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, sortBy, pageSize]);
  const totalPages = Math.ceil(users.length / pageSize);
  const pagedUsers = users.slice((page - 1) * pageSize, page * pageSize);

  const renderAvatar = (u: UiUser) => {
    const src = (u.profile || "").trim();
    if (isBase64DataImage(src) || src.startsWith("http://") || src.startsWith("https://")) {
      return <img src={src} alt={`${u.first_name} ${u.last_name}`} className="h-8 w-8 rounded-[4px] object-cover ring-1 ring-white/20" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />;
    }
    return (
      <div className="grid h-8 w-8 place-items-center rounded-[4px] ring-1 ring-white/10"
        style={{ backgroundColor: `${currentColor}18`, color: currentColor }}>
        {u.role === "Admin" ? <FiShield className="text-[13px]" /> : <FiUser className="text-[13px]" />}
      </div>
    );
  };

  const toggleSelect = (id: number) => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const handleBulkDelete = async () => {
    try {
      setBulkDeleting(true);
      const ids = Array.from(selectedIds);
      await BulkDeleteUsers(ids);
      setRows((prev) => prev.filter((u) => !selectedIds.has(u.id)));
      setSelectedIds(new Set()); setShowBulkDeleteModal(false);
      message.success(t("user.bulkDeleteSuccess", { count: ids.length }));
    } catch (err) { message.error(apiErrorDetail(err, t("user.bulkDeleteFailed"))); }
    finally { setBulkDeleting(false); }
  };

  const handleBulkRoleChange = async (roleId: number, roleName: string) => {
    try {
      setBulkRoleChanging(true);
      const ids = Array.from(selectedIds);
      await BulkChangeRole(ids, roleId);
      setRows((prev) => prev.map((u) => selectedIds.has(u.id) ? { ...u, role: roleName } : u));
      setSelectedIds(new Set()); setShowRoleMenu(false);
      message.success(t("user.roleChangedSuccess", { role: roleName, count: ids.length }));
    } catch (err) { message.error(apiErrorDetail(err, t("user.roleChangeFailed"))); }
    finally { setBulkRoleChanging(false); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (currentUserId !== null && deleteTarget.id === currentUserId) { setDeleteError(t("user.cannotDeleteSelf")); return; }
    try {
      setDeleting(true); setDeleteError("");
      const res = await DeleteUserByID(deleteTarget.id);
      if (!res) { setDeleteError(t("user.deleteFailed")); return; }
      setRows((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(deleteTarget.id); return n; });
      setDeleteTarget(null); message.success(t("user.deleteSuccess"));
    } catch (err) { setDeleteError(apiErrorText(err, t("user.deleteFailed"))); }
    finally { setDeleting(false); }
  };

  return (
    <>
      <div className="mb-2.5">
        <StatCards users={rows} loading={loading} activityCount={activity.total} activityLoading={activityLoading} />
      </div>

      {/* ── Users card ───────────────────────────────────────────────────────
          The devices page's list shape, part for part: one continuous bordered surface holding
          a title+actions row, an entries-per-page / filters / search row, and `.shell-table`
          itself — with the pager outside the card. It was three stacked surfaces before (a
          medallion header, a padded body with its own rounded sub-card, and a second table
          glued under the first to fake a sticky header), and the inner table was hand-styled
          with per-cell `border-b` and percentage widths that `.shell-table` already handles.

          The sort control went from a hand-rolled popup to a plain `.shell-select`, which is
          what the devices page's own filters are — that also retired the document-level click
          listener the popup needed to close itself. ── */}
      <div className="shell-card p-0! overflow-hidden">
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
          style={{ borderBottom: "1px solid var(--shell-border)" }}
        >
          <h2 className="m-0 text-[16px] font-semibold ink">{t("user.monitoring")}</h2>
          <button
            type="button"
            onClick={() => { setSelectedUser(null); setOpenCreateModal(true); }}
            className="btn btn-accent btn-sm"
            aria-label={t("user.createUser")}
          >
            <FiPlus size={13} />
            {t("user.createUser")}
          </button>
        </div>

        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid var(--shell-border)" }}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5 text-[12px] ink-2">
              <MinimalSelect
                ariaLabel="Entries per page"
                size="sm"
                className="w-[70px]"
                value={String(pageSize)}
                onChange={(v) => setPageSize(Number(v))}
                options={[10, 25, 50].map((n) => ({ value: String(n), label: String(n) }))}
              />
              entries per page
            </span>
            <MinimalSelect
              ariaLabel="Sort by"
              size="sm"
              className="w-44"
              value={sortBy}
              onChange={(v) => setSortBy(v as SortKey)}
              options={SORT_KEYS.map((k) => ({ value: k, label: getSortLabel(k) }))}
            />
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder={t("user.search")} width="w-60" />
        </div>

        {/* Bulk action toolbar — only once something is ticked, so it never takes a row of the
            card for nothing. */}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5"
            style={{ borderBottom: "1px solid var(--shell-border)", backgroundColor: `${currentColor}0a` }}>
            <div className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: currentColor }}>
              <FiUsers className="text-[12px]" />{t("user.selected", { count: selectedIds.size })}
            </div>
            <button type="button" onClick={() => setSelectedIds(new Set())}
              className="rounded-[4px] px-2 py-1 text-[11px] ink-2 surface-hover">
              {t("user.clearSelection")}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <div role="presentation" className="relative" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => setShowRoleMenu((s) => !s)} disabled={bulkRoleChanging}
                  className="btn btn-ghost btn-sm">
                  <FiCheck size={12} />{t("user.changeRole")}
                  <FiChevronDown size={11} className={showRoleMenu ? "rotate-180 transition" : "transition"} />
                </button>
                {showRoleMenu && (
                  <div className="absolute right-0 z-20 mt-1.5 w-36 overflow-hidden rounded-[5px] border hairline surface-card shadow-lg">
                    {roles.map((r) => (
                      <button key={r.id} type="button" onClick={() => void handleBulkRoleChange(r.id, r.role)}
                        className="w-full px-3 py-2 text-left text-[12px] capitalize ink transition surface-hover">
                        {r.role}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => setShowBulkDeleteModal(true)}
                className="btn btn-danger btn-sm">
                <FiTrash2 size={12} />{t("user.delete")} ({selectedIds.size})
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-14 text-center text-[13px] ink-3">{t("user.loading")}</div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-14">
            <FiAlertTriangle size={26} className="text-red-500 opacity-60" />
            <p className="text-[13px] text-red-600 dark:text-red-300">{error}</p>
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 ink-3">
            <FiUsers size={28} className="opacity-30" />
            <p className="text-[13px]">{t("user.noData")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto shell-scroll-thin">
            <table className="shell-table w-full min-w-230">
              <thead>
                <tr>
                  {/* Select-all removed on purpose — users are picked one at a time. */}
                  <th style={{ width: 44 }} aria-hidden="true" />
                  <th scope="col">{t("user.name")}</th>
                  <th scope="col">{t("user.contact")}</th>
                  <th scope="col">{t("user.location")}</th>
                  <th scope="col">Device access</th>
                  <th className="text-right" scope="col">{t("user.action")}</th>
                </tr>
              </thead>
              <tbody>
                {pagedUsers.map((user) => {
                  const isMe = currentUserId !== null && user.id === currentUserId;
                  const rowStyle = selectedIds.has(user.id) ? { backgroundColor: `${currentColor}0a` } : undefined;
                  return (
                    <tr key={user.id} style={rowStyle}>
                      <td>
                        {!isMe && <input type="checkbox" checked={selectedIds.has(user.id)} onChange={() => toggleSelect(user.id)}
                          className="h-3.5 w-3.5 cursor-pointer" style={{ accentColor: currentColor }}
                          aria-label={`Select ${user.first_name} ${user.last_name}`} />}
                      </td>
                      <td className="td-key">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="shrink-0">{renderAvatar(user)}</div>
                          <div className="min-w-0">
                            <p className="m-0 truncate text-[13px] font-semibold ink">{user.first_name} {user.last_name}</p>
                            <p className="m-0 truncate text-[11.5px] ink-3">{user.role || "-"} · {user.position || "-"}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2 text-[12.5px] ink">
                          <FiMail className="shrink-0 text-[11px] ink-3" /><span className="truncate">{user.email}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11.5px] ink-3">
                          <FiPhone className="shrink-0 text-[11px]" /><span>{user.phone_number || "-"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2 text-[12.5px] ink">
                          <FiMapPin className="shrink-0 text-[11px] ink-3" /><span className="truncate">{user.location || "-"}</span>
                        </div>
                      </td>
                      <td>
                        <DeviceAccessCell
                          role={user.role}
                          granted={accessCounts[String(user.id)] ?? 0}
                          total={deviceTotal}
                        />
                      </td>
                      <td className="text-right">
                        <button type="button" onClick={() => { setSelectedUser(user); setOpenEditModal(true); }}
                          className="btn-icon" title={t("user.editUser")} aria-label={t("user.editUser")}>
                          <FiEdit2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleteError && !deleteTarget && (
        <p className="mt-2 text-[12px] text-red-600 dark:text-red-300">{deleteError}</p>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[11px] ink-3">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, users.length)} of {users.length} users
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              aria-label="Previous page"
              className="flex h-7 w-7 items-center justify-center rounded-[4px] border hairline surface-card ink-2 surface-hover disabled:opacity-40 transition">
              <FiChevronLeft size={13} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button key={p} onClick={() => setPage(p)}
                className={`flex h-7 w-7 items-center justify-center rounded-[4px] border text-[12px] font-semibold transition ${
                  p === page ? "" : "surface-card ink-2 hairline"
                }`}
                style={p === page
                  ? { background: currentColor, color: "white", borderColor: currentColor }
                  : undefined}>
                {p}
              </button>
            ))}
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              aria-label="Next page"
              className="flex h-7 w-7 items-center justify-center rounded-[4px] border hairline surface-card ink-2 surface-hover disabled:opacity-40 transition">
              <FiChevronRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal — same centred mascot card as the single delete, for N users at once. */}
      {showBulkDeleteModal && createPortal(
        <div className="fixed inset-0 z-9999 flex items-center justify-center p-3 sm:p-4">
          <div role="presentation" className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => !bulkDeleting && setShowBulkDeleteModal(false)} />
          <div className="relative z-10 w-full max-w-[380px] overflow-hidden rounded-[6px] surface-card ring-1 ring-black/5 dark:ring-white/10">
            <button type="button" onClick={() => setShowBulkDeleteModal(false)} disabled={bulkDeleting}
              aria-label={t("common.cancel")}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-[4px] ink-3 surface-hover transition-colors focus:outline-none disabled:opacity-60">
              <FiX className="text-[16px]" />
            </button>
            <div className="px-6 pb-6 pt-7 text-center">
              <VirusMascot className="mx-auto mb-3 h-24 w-24" title={t("user.bulkDelete")} />
              <h3 className="text-[17px] font-bold leading-tight ink">{(() => {
                const sel = rows.filter((u) => selectedIds.has(u.id));
                return sel.length === 1
                  ? (`${sel[0].first_name} ${sel[0].last_name}`.trim() || sel[0].email || "—")
                  : t("user.bulkDeleteConfirm", { count: selectedIds.size });
              })()}</h3>
              <p className="mx-auto mt-1.5 max-w-[17rem] text-[12px] leading-5 ink-3">{t("user.bulkDeleteDesc", { count: selectedIds.size })}</p>

              <button type="button" onClick={() => void handleBulkDelete()} disabled={bulkDeleting}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-[4px] py-2.5 text-[12.5px] font-semibold text-white transition bg-linear-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400 disabled:cursor-not-allowed disabled:opacity-70">
                {bulkDeleting
                  ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                  : <FiTrash2 className="text-[13px]" />}
                {bulkDeleting ? t("user.deleting") : t("common.delete")}
              </button>
              <button type="button" onClick={() => setShowBulkDeleteModal(false)} disabled={bulkDeleting}
                className="mt-2 w-full rounded-[4px] py-2 text-[12px] font-medium ink-3 transition surface-hover disabled:opacity-60">
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Single Delete Modal — a centred card the virus mascot heads, so the danger has a face. */}
      {deleteTarget && createPortal(
        <div className="fixed inset-0 z-9999 flex items-center justify-center p-3 sm:p-4">
          <div role="presentation" className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => !deleting && setDeleteTarget(null)} />
          <div className="relative z-10 w-full max-w-[380px] overflow-hidden rounded-[6px] surface-card ring-1 ring-black/5 dark:ring-white/10">
            <button type="button" onClick={() => !deleting && setDeleteTarget(null)} disabled={deleting}
              aria-label={t("common.cancel")}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-[4px] ink-3 surface-hover transition-colors focus:outline-none disabled:opacity-60">
              <FiX className="text-[16px]" />
            </button>
            <div className="px-6 pb-6 pt-7 text-center">
              <VirusMascot className="mx-auto mb-3 h-24 w-24" title={t("user.deleteConfirm")} />
              <h3 className="text-[17px] font-bold leading-tight ink">{t("user.deleteConfirm")}</h3>
              <p className="mx-auto mt-1.5 max-w-[17rem] text-[12px] leading-5 ink-3">{t("user.deleteWarning")}</p>

              <div className="mt-4 flex items-center gap-3 rounded-[4px] border hairline surface-sunken p-3 text-left">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] surface-card ring-1 ring-slate-200/80 dark:ring-white/10">
                  <FiUser className="text-[13px] ink-2" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold ink">{deleteTarget.first_name} {deleteTarget.last_name}</p>
                  <p className="truncate text-[10.5px] ink-3">{deleteTarget.email || "—"}</p>
                </div>
              </div>

              <div className="mt-3 flex items-start gap-2 rounded-[4px] border border-amber-200/80 bg-amber-50/80 px-3 py-2.5 text-left dark:border-amber-400/20 dark:bg-amber-500/8">
                <FiInfo className="mt-0.5 shrink-0 text-[11px] text-amber-600 dark:text-amber-300" />
                <p className="text-[10.5px] leading-5 text-amber-700 dark:text-amber-200">{t("user.confirmBeforeDelete")}</p>
              </div>

              {deleteError && <div className="mt-3 rounded-[4px] border border-red-200 bg-red-50 px-3 py-2 text-left text-[10.5px] text-red-600 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300">{deleteError}</div>}

              <button type="button" onClick={confirmDelete} disabled={deleting}
                className={["mt-5 flex w-full items-center justify-center gap-2 rounded-[4px] py-2.5 text-[12.5px] font-semibold text-white transition",
                  deleting ? "cursor-not-allowed bg-red-300 dark:bg-red-900/50" : "bg-linear-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400",
                ].join(" ")}>
                {deleting
                  ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                  : <FiTrash2 className="text-[13px]" />}
                {deleting ? t("user.deleting") : t("common.delete")}
              </button>
              <button type="button" onClick={() => !deleting && setDeleteTarget(null)} disabled={deleting}
                className="mt-2 w-full rounded-[4px] py-2 text-[12px] font-medium ink-3 transition surface-hover disabled:opacity-60">
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <UserFormModal open={openCreateModal} user={null} onClose={() => setOpenCreateModal(false)} onUpdated={async () => { setOpenCreateModal(false); await Promise.all([fetchUsers(), fetchAccess()]); }} />
      <UserFormModal open={openEditModal} user={selectedUser} onClose={() => { setOpenEditModal(false); setSelectedUser(null); }} onUpdated={async () => { setOpenEditModal(false); setSelectedUser(null); await Promise.all([fetchUsers(), fetchAccess()]); }} />
    </>
  );
};

export default Index;
