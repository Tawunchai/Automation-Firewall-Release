import React, { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { message } from "../../components/ui/toast";
import { FiChevronLeft, FiChevronRight, FiEdit2, FiPlus, FiTrash2, FiX } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import SearchInput from "../../components/ui/SearchInput";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { DeviceStates } from "../../components/ui/StateBlock";
import { useDeviceData } from "../../hooks/useDeviceData";
import { categoryChipStyle, categoryHue, type CategoryHue } from "../../lib/categoryColor";
import type { DeviceReadOpts } from "../../api/policyObject";
import type { Column } from "../ui/filter-table";
import type { NetworkDevice } from "../../api/device";
import { colWidths } from "../ui/colWidths";
import { apiErrorDetail } from "../../api/errorText";

export type { Column };

/** What a cell can reach besides its own row — see DeviceListColumn. */
export type DeviceListRowContext = {
  device: NetworkDevice;
  /** Re-read the list from the device. For a cell that writes (a status chip that flips). */
  reload: () => void;
  canWrite: boolean;
};

/**
 * A column whose cell may also act, not just render.
 *
 * Web Rating Overrides flips `status` from the table — one PUT with one field changed — and a
 * cell that writes needs to re-read the list afterwards. A plain `Column<T>` (row only) is still
 * accepted: TypeScript lets a function that ignores the second argument stand in for one that
 * takes it, so none of the existing call sites move.
 */
export type DeviceListColumn<T> = Omit<Column<T>, "render"> & {
  render: (row: T, ctx: DeviceListRowContext) => React.ReactNode;
};

/**
 * A quick fact in the card header — "12 memberships", "3 disabled".
 *
 * It lived in PageHero, which was the full-width tinted banner every page used to open with. The
 * banners were removed app-wide in the Dastone pass (82df8d3) and the component went unrendered
 * for months while this one type kept it alive; the chips themselves survived the move into the
 * card header, so the type moves here and PageHero.tsx is gone.
 */
export type PageHeroChip = {
  icon: React.ReactNode;
  label: React.ReactNode;
};

/** Stable empty list — a `[]` literal would be a new identity on every render. */
const EMPTY: never[] = [];

// Wiring for the writes. Required: every page in this section can create, edit and delete, and a
// list that silently could not would be indistinguishable from one that may not.
export type DeviceListCrud<T> = {
  onCreate: (device: NetworkDevice) => void;
  onEdit: (device: NetworkDevice, row: T) => void;
  onDelete: (device: NetworkDevice, row: T) => Promise<void>;
  describe: (row: T) => string;   // shown in the delete confirmation
  deleteLabel: string;            // e.g. "DELETE USER GROUP"
  /** The delete-dialog mascot for this page — one per topic (see authMascots). */
  mascot?: React.ComponentType<{ className?: string; title?: string }>;
  /**
   * A dialog of this page's own, instead of the standard one.
   *
   * The escape hatch for the few pages whose confirmation does real work: IP Pools and Addresses
   * ask the device what still USES the object and list it, which is worth more than a mascot. A
   * page that has nothing extra to say must not take this — three schools of delete dialog is
   * what this component exists to end.
   */
  dialog?: (args: {
    row: T;
    device: NetworkDevice;
    busy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  }) => React.ReactNode;
  /**
   * What else the person should know before they press Delete — "referenced by 3 policies, the
   * device will refuse", "this is the last member of its zone". Rendered under the standard
   * sentence, so a page that has something to warn about no longer needs its own dialog.
   */
  warn?: (row: T) => React.ReactNode;
};

/**
 * Shared list page for the "User & Authentication" section (User Definition, User Groups, LDAP
 * Servers, RADIUS Servers). Data is read live from the selected FortiGate.
 *
 * It renders its own table rather than reusing `FilterTable`. That component is built for the
 * small tables EMBEDDED IN A FORM — the URL filter list inside a Web Filter profile, the override
 * list inside an Application Sensor — where FortiGate's own GUI uses a select-a-row-then-press-
 * Edit toolbar, and matching the device's interaction is the point. On a full page that model is
 * the odd one out: every other list in this console (Firewall Policy, Addresses, Services,
 * Security Profiles…) puts Create in the page header and edit/delete icons on the row itself, so
 * these four pages did too much clicking for the same result and looked like a different app.
 *
 * The column contract (`Column<T>` + `gridCols`) is unchanged, so the four callers did not move.
 */
export function DeviceListPage<T>({
  // `title` is the card's own heading, exactly as the devices page keeps an <h2>Devices</h2>
  // inside its card even though the navbar breadcrumb says it too. `subtitle` is not rendered
  // anywhere any more (the hero that carried it is gone); it stays in the type so the four call
  // sites remain self-documenting, aliased so the unused binding doesn't trip `noUnusedLocals`.
  title, icon, noun, subtitle: _subtitle, hue, heroChips, fetcher, columns, gridCols, matches,
  crud, headerActions, rowKey,
}: {
  title: string;                                  // the page heading, and ONLY that — see below
  icon: React.ReactNode;
  /**
   * The singular thing this page lists ("user group"), used everywhere a sentence is built.
   *
   * `title` must not be used for that, even though it reads better in English. Translation happens
   * as the element is created (src/i18n/jsx-runtime.ts), and `title` is on the display-attribute
   * list — so by the time this function runs, `title` is already Thai or Chinese. Building
   * `Search ${title}…` out of it produced "Search 用户组…": half the sentence translated, and the
   * English half unreachable, because the assembled string looks already-translated to the
   * dictionary and is passed straight through. `noun` is deliberately NOT on that list and arrives
   * as English, so the sentence matches a pattern and comes out whole.
   */
  noun: string;
  /** One line under the title in the hero, naming what this page is for. */
  subtitle?: string;
  /** This page's own identity colour — see lib/categoryColor.ts. Drives the hero's tint and every
      row's icon medallion, so the four User & Authentication pages are never mistaken for one
      another even with the title scrolled out of view. */
  hue: CategoryHue;
  /** Page-specific quick facts for the hero's chip row, computed from the loaded rows. */
  heroChips?: (rows: T[]) => PageHeroChip[];
  /**
   * The device read. It MUST accept `DeviceReadOpts` and honour `{ strict: true }` — see the
   * call site below for what a lenient read does to this page.
   */
  fetcher: (deviceId: number, opts?: DeviceReadOpts) => Promise<T[]>;
  columns: DeviceListColumn<T>[];
  gridCols: string;
  matches: (row: T, q: string) => boolean;
  /**
   * How this page writes. OMITTED means the list is read-only — Network ▸ Interfaces is, on
   * purpose (see the fortios-interface-schema memory), and a read-only page must not grow a
   * Create button just because it moved onto the shared list.
   */
  crud?: DeviceListCrud<T>;
  /** Extra controls beside Create — a refresh, an export, a second kind of create. */
  headerActions?: React.ReactNode;
  /**
   * A stable key per row. The default is the row's position, which is fine while a list only
   * ever renders, and wrong the moment rows can be reordered: React would keep the open delete
   * dialog pointed at whatever now sits in that slot.
   */
  rowKey?: (row: T, index: number) => string;
}) {
  const { currentMode } = useStateContext();
  // isAdmin from the context, not a hand-rolled `role === "admin"`: the context trims and
  // lower-cases first, and a role stored as "Admin" made the router serve the admin page while
  // every hand-rolled check on it hid the buttons.
  const { isAdmin } = useAuth();

  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);
  const [deleting, setDeleting] = useState(false);

  // strict: a firewall we could not read must NOT render as "this device has no user groups".
  //
  // This page used to call the fetcher with no options at all, which is the LENIENT mode — every
  // failure, from a deleted device to an unreachable firewall to an expired session, came back as
  // `[]` and was drawn as an empty list. On a page whose whole job is to show who can authenticate
  // through a firewall, that is the screen stating the opposite of the truth. The rest of the
  // console had already been moved onto this hook for exactly this reason; these four pages were
  // the ones it never reached. See hooks/useDeviceData.ts.
  const load = useCallback(
    (deviceId: number) => fetcher(deviceId, { strict: true }),
    [fetcher],
  );
  const {
    data: rows, error, reload: fetchAll, device: selectedDevice, viewState,
  } = useDeviceData<T[]>(load, EMPTY);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => matches(r, q)) : rows;
  }, [rows, search, matches]);

  const state = viewState(filtered.length);

  // Writes are admin-only (the device-proxy enforces this too — this just avoids offering a
  // button that would come back 403).
  const canWrite = isAdmin && !!selectedDevice && !!crud;

  const handleDelete = async () => {
    if (!deleteTarget || !selectedDevice || !crud) return;
    try {
      setDeleting(true);
      await crud.onDelete(selectedDevice, deleteTarget);
      message.success(`${noun.charAt(0).toUpperCase()}${noun.slice(1)} deleted`);
      setDeleteTarget(null);
      void fetchAll();
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to delete ${noun}`));
    } finally {
      setDeleting(false);
    }
  };

  // Paged like the devices list. The page is CLAMPED rather than reset from an effect: filtering
  // down to two pages while sitting on page four has to not show a blank table, and deriving the
  // safe page does that without a second render pass. Typing in the search box still takes you
  // back to page one — that happens in the handler, where the cause actually is.
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const tone = categoryHue(hue, currentMode);

  return (
    <>
      {/* ── The devices page's list card, part for part ───────────────────────
          One continuous bordered surface: title + this page's own quick facts + Create on the
          first row, entries-per-page + search on the second, then `.shell-table` itself, with
          the pager outside the card. This replaced a CSS-grid stand-in — a header strip of
          `t-label` spans over a stack of `<div>` rows sharing one `gridTemplateColumns` — which
          looked close enough on these four pages but was not a table: it had no `<th>` for a
          screen reader to announce a cell against, and it could not pick up the hover rail,
          group bands or numeric alignment `.shell-table` gives every other list in the console.

          The `gridCols` tracks each caller tuned are NOT thrown away for table auto-layout: an
          LDAP distinguished name and a 2-character status want very different shares of the row.
          They are converted to `<colgroup>` percentages below, so the four callers keep both
          their proportions and their existing prop. ── */}
      <div className="shell-card p-0! overflow-hidden">
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
          style={{ borderBottom: "1px solid var(--shell-border)" }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[16px] font-semibold ink">{title}</h2>
            {heroChips?.(rows).map((c, i) => (
              <span key={i} className="chip">
                <span className="inline-flex" style={{ fontSize: 11 }}>{c.icon}</span>
                {c.label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {headerActions}
            {canWrite && (
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={() => crud!.onCreate(selectedDevice!)}
              >
                <FiPlus size={13} /> Create new
              </button>
            )}
          </div>
        </div>

        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid var(--shell-border)" }}
        >
          <span className="flex items-center gap-1.5 text-[12px] ink-2">
            <MinimalSelect
              ariaLabel="Entries per page"
              size="sm"
              className="w-[70px]"
              value={String(pageSize)}
              onChange={(v) => { setPageSize(Number(v)); setPage(1); }}
              options={[10, 25, 50].map((n) => ({ value: String(n), label: String(n) }))}
            />
            entries per page
          </span>
          <SearchInput
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            placeholder={`Search ${noun}…`}
            width="w-60"
          />
        </div>

        <DeviceStates
          state={state}
          from={selectedDevice?.name}
          noun={noun}
          icon={icon}
          error={error}
          onRetry={() => void fetchAll()}
          filtered={!!search}
          emptyAction={canWrite ? (
            <button type="button" className="btn btn-accent btn-sm mt-1"
              onClick={() => crud!.onCreate(selectedDevice!)}>
              <FiPlus size={13} /> Create the first {noun}
            </button>
          ) : undefined}
        >
          <div className="overflow-x-auto shell-scroll-thin">
            <table className="shell-table w-full" style={{ minWidth: 60 * (columns.length + 2) }}>
              <colgroup>
                <col style={{ width: 44 }} />
                {colWidths(gridCols, columns.length).map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
                <col style={{ width: 84 }} />
              </colgroup>
              <thead>
                <tr>
                  <th aria-hidden />
                  {columns.map((c) => (
                    <th key={c.key} scope="col">{c.header}</th>
                  ))}
                  <th className="text-right" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row, idx) => (
                  <tr
                    key={rowKey ? rowKey(row, idx) : idx}
                    onDoubleClick={() => (canWrite ? crud!.onEdit(selectedDevice!, row) : undefined)}
                  >
                    <td>
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-[4px] text-[13px] text-white"
                        style={categoryChipStyle(tone)}
                        aria-hidden
                      >
                        {icon}
                      </span>
                    </td>
                    {columns.map((c, ci) => (
                      <td key={c.key} className={ci === 0 ? "td-key" : undefined}>
                        <div className="min-w-0 truncate">
                          {c.render(row, {
                            device: selectedDevice!,
                            reload: () => void fetchAll(),
                            canWrite,
                          })}
                        </div>
                      </td>
                    ))}
                    <td className="text-right">
                      {canWrite && (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title={`Edit ${noun}`}
                            className="btn-icon"
                            onClick={() => crud!.onEdit(selectedDevice!, row)}
                          >
                            <FiEdit2 size={13} />
                          </button>
                          <button
                            type="button"
                            title={`Delete ${noun}`}
                            className="btn-icon btn-icon--danger"
                            onClick={() => setDeleteTarget(row)}
                          >
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

      {state === "rows" && (
        <div className="mt-3 flex items-center justify-between">
          <p className="m-0 text-[11px] ink-3">
            Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)}
            {" "}of {filtered.length} {noun}{filtered.length !== 1 ? "s" : ""}
            {search && ` (filtered from ${rows.length})`}
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1}
                aria-label="Previous page"
                className="flex h-7 w-7 items-center justify-center rounded-[4px] border hairline surface-card ink-2 surface-hover disabled:opacity-40 transition">
                <FiChevronLeft size={13} />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button key={p} onClick={() => setPage(p)}
                  className={`flex h-7 w-7 items-center justify-center rounded-[4px] border text-[12px] font-semibold transition ${
                    p === safePage ? "" : "surface-card ink-2 hairline"
                  }`}
                  style={p === safePage
                    ? { background: tone, color: "white", borderColor: tone }
                    : undefined}>
                  {p}
                </button>
              ))}
              <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages}
                aria-label="Next page"
                className="flex h-7 w-7 items-center justify-center rounded-[4px] border hairline surface-card ink-2 surface-hover disabled:opacity-40 transition">
                <FiChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {deleteTarget && selectedDevice && crud?.dialog
        ? crud.dialog({
          row: deleteTarget,
          device: selectedDevice,
          busy: deleting,
          onCancel: () => setDeleteTarget(null),
          onConfirm: () => void handleDelete(),
        })
        : null}

      {deleteTarget && !crud?.dialog && createPortal(
        (() => {
          const Mascot = crud!.mascot;
          return (
            <div className="fixed inset-0 z-9999 flex items-center justify-center p-3 sm:p-4">
              {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
              <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => !deleting && setDeleteTarget(null)} />
              <div className="relative z-10 w-full max-w-[380px] overflow-hidden rounded-[6px] surface-card ring-1 ring-black/5 dark:ring-white/10">
                <button type="button" onClick={() => !deleting && setDeleteTarget(null)} disabled={deleting} aria-label="Cancel"
                  className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-[4px] ink-3 surface-hover transition-colors focus:outline-none disabled:opacity-60">
                  <FiX className="text-[16px]" />
                </button>
                <div className="px-6 pb-6 pt-7 text-center">
                  {Mascot && <Mascot className="mx-auto mb-3 h-24 w-24" title={crud!.describe(deleteTarget)} />}
                  <h3 className="truncate text-[17px] font-bold leading-tight ink">{crud!.describe(deleteTarget)}</h3>
                  <p className="mx-auto mt-1.5 max-w-[17rem] text-[12px] leading-5 ink-3">
                    {/* One string, not JSX children — see the same change in security-profiles/index.tsx. */}
                    {`This ${noun} will be permanently removed from ${selectedDevice?.name ?? ""}.`}
                  </p>
                  {crud!.warn?.(deleteTarget) && (
                    <p className="mx-auto mt-1.5 max-w-[17rem] text-[12px] leading-5 text-amber-600 dark:text-amber-400">
                      {crud!.warn!(deleteTarget)}
                    </p>
                  )}

                  <button type="button" onClick={handleDelete} disabled={deleting}
                    className={["mt-5 flex w-full items-center justify-center gap-2 rounded-[4px] py-2.5 text-[12.5px] font-semibold text-white transition",
                      deleting ? "cursor-not-allowed bg-red-300 dark:bg-red-900/50" : "bg-linear-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400",
                    ].join(" ")}>
                    {deleting
                      ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                      : <FiTrash2 className="text-[13px]" />}
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                  <button type="button" onClick={() => !deleting && setDeleteTarget(null)} disabled={deleting}
                    className="mt-2 w-full rounded-[4px] py-2 text-[12px] font-medium ink-3 transition surface-hover disabled:opacity-60">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}
    </>
  );
}
