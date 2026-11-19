import React, { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import {
  FiShield, FiGlobe, FiWifi, FiCpu, FiFile, FiLock,
  FiPlus, FiEdit2, FiTrash2, FiTarget, FiChevronLeft, FiChevronRight,
} from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import SearchInput from "../../components/ui/SearchInput";
import MinimalSelect from "../../components/ui/MinimalSelect";
import MascotDeleteModal from "../../components/ui/MascotDeleteModal";
import VirusMascot from "../../components/ui/VirusMascot";
import {
  IpsMascot, WebFilterMascot, DnsFilterMascot, AppControlMascot,
  FileFilterMascot, SslSshMascot,
} from "../../components/ui/securityMascots";
import { DeviceStates } from "../../components/ui/StateBlock";
import { useDeviceData } from "../../hooks/useDeviceData";
import { categoryChipStyle, categoryHue, type CategoryHue } from "../../lib/categoryColor";
import {
  DeviceListSecurityProfiles, DeviceDeleteSecurityProfile,
  type SecurityProfileCategory, type SecurityProfile,
} from "../../api/policyObject";
import { apiErrorDetail } from "../../api/errorText";

/** Stable empty list — a `[]` literal would be a new identity each render. */
const EMPTY: SecurityProfile[] = [];

// A categorical palette, not the app's own status colours (success/warning/danger/…) — those
// already mean something elsewhere in this console (danger = "something is wrong"), and borrowing
// one for "this row is IPS" would read as an alert that isn't there. Hues below are a validated
// 8-slot categorical set (dataviz skill, references/palette.md): adjacent-pair CVD Delta E >= 8 and
// normal-vision Delta E >= 15 in both modes, so no two of the seven categories can be mistaken for
// one another — the one thing asked for. Used in the palette's own documented order, which is the
// order the validation holds for.
const CATEGORY_HUES: Record<SecurityProfileCategory, CategoryHue> = {
  "ips":                 { light: "#2a78d6", dark: "#3987e5" }, // blue
  "antivirus":           { light: "#eb6834", dark: "#d95926" }, // orange
  "webfilter":           { light: "#1baf7a", dark: "#199e70" }, // aqua
  "dnsfilter":           { light: "#eda100", dark: "#c98500" }, // yellow
  "application-control": { light: "#e87ba4", dark: "#d55181" }, // magenta
  "file-filter":         { light: "#008300", dark: "#008300" }, // green
  "ssl-ssh-inspection":  { light: "#6250d6", dark: "#9085e9" }, // violet
};

// ─── Per-category presentation (title, icon, noun used in messages, hero subtitle) ────────────
const CATEGORY_META: Record<
  SecurityProfileCategory,
  { title: string; icon: React.ReactNode; noun: string; subtitle: string }
> = {
  "antivirus": {
    title: "AntiVirus", icon: <FiShield />, noun: "AntiVirus profile",
    subtitle: "Profiles that scan traffic for malware as it crosses the firewall.",
  },
  "webfilter": {
    title: "Web Filter", icon: <FiGlobe />, noun: "Web Filter profile",
    subtitle: "Profiles that allow, block or monitor web traffic by category and URL.",
  },
  "dnsfilter": {
    title: "DNS Filter", icon: <FiWifi />, noun: "DNS Filter profile",
    subtitle: "Profiles that block DNS lookups for botnet and category-based domains.",
  },
  "application-control": {
    title: "Application Control", icon: <FiCpu />, noun: "Application Control list",
    subtitle: "Sensors that identify and control traffic by the application generating it.",
  },
  "file-filter": {
    title: "File Filter", icon: <FiFile />, noun: "File Filter profile",
    subtitle: "Profiles that block or log files by type as they pass through the firewall.",
  },
  "ssl-ssh-inspection": {
    title: "SSL/SSH Inspection", icon: <FiLock />, noun: "SSL/SSH Inspection profile",
    subtitle: "Profiles that decide how deeply encrypted traffic is inspected.",
  },
  "ips": {
    title: "Intrusion Prevention", icon: <FiTarget />, noun: "IPS sensor",
    subtitle: "Sensors that match traffic against known exploit and attack signatures.",
  },
};

// ─── Per-category delete-dialog mascot ────────────────────────────────────────────────────────
// Each page's destructive confirm gets its own cartoon (same red worried-face drawing family), so
// the danger has a face that fits the topic. AntiVirus reuses the shared VirusMascot (it IS a virus).
const CATEGORY_MASCOT: Record<SecurityProfileCategory, React.FC<{ className?: string; title?: string }>> = {
  "antivirus":           VirusMascot,
  "webfilter":           WebFilterMascot,
  "dnsfilter":           DnsFilterMascot,
  "application-control": AppControlMascot,
  "file-filter":         FileFilterMascot,
  "ssl-ssh-inspection":  SslSshMascot,
  "ips":                 IpsMascot,
};

const isValidCategory = (v: string | undefined): v is SecurityProfileCategory =>
  !!v && Object.prototype.hasOwnProperty.call(CATEGORY_META, v);

// Categories with a real create/edit form wired up so far — everything else still
// shows a "coming soon" message until its form is built.
const CATEGORIES_WITH_FORM: Partial<Record<SecurityProfileCategory, string>> = {
  antivirus: "antivirus",
  webfilter: "webfilter",
  dnsfilter: "dnsfilter",
  "application-control": "application-control",
  "file-filter": "file-filter",
  "ssl-ssh-inspection": "ssl-ssh-inspection",
  ips: "ips",
};

const SecurityProfilesPage: React.FC = () => {
  const { category: rawCategory } = useParams<{ category: string }>();
  const navigate = useNavigate();
  const { currentMode, currentColor } = useStateContext();
  // isAdmin comes from the context, which trims and lower-cases the role first. The
  // hand-rolled `role === "admin"` this replaced missed a role stored as "Admin" — and the
  // router did not, so it served the admin page while every button on it stayed hidden.
  const { isAdmin } = useAuth();

  const category = isValidCategory(rawCategory) ? rawCategory : "antivirus";
  const meta = CATEGORY_META[category];
  const Mascot = CATEGORY_MASCOT[category];

  // Read-only is per ROW now, not per category.
  //
  // SSL/SSH Inspection used to set a page-wide isReadOnly flag, which hid Create as well as Edit —
  // so the one profile type every other Security Profile depends on could not be built here at all.
  // What FortiOS actually locks is the three profiles it ships (`deep-inspection`,
  // `certificate-inspection`, `no-inspection`); everything else in the table is editable, and a new
  // profile can always be created. The backend marks the locked rows (device_securityprofile.go), so the
  // page greys exactly those and nothing more — the same thing FortiGate's own GUI does.

  const [search, setSearch]             = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SecurityProfile | null>(null);
  const [deleting, setDeleting]         = useState(false);
  const [pageSize, setPageSize]         = useState(10);
  const [page, setPage]                 = useState(1);


  // strict: "no AntiVirus profiles" on a firewall we could not read is the worst version of this
  // bug — it invites someone to create a profile that already exists, or to assume nothing is
  // inspecting traffic.
  const load = useCallback(
    (deviceId: number) => DeviceListSecurityProfiles(deviceId, category, { strict: true }),
    [category],
  );
  const {
    data: profiles, error, reload: fetchAll, device: selectedDevice, viewState,
  } = useDeviceData<SecurityProfile[]>(load, EMPTY);

  const handleDelete = async () => {
    if (!deleteTarget || !selectedDevice) return;
    try {
      setDeleting(true);
      await DeviceDeleteSecurityProfile(selectedDevice.id, category, deleteTarget.name);
      message.success(`${meta.noun} deleted`);
      setDeleteTarget(null);
      void fetchAll();
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to delete ${meta.noun}`));
    } finally {
      setDeleting(false);
    }
  };

  const filtered = profiles.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.comment || "").toLowerCase().includes(search.toLowerCase())
  );

  // Paged like the devices list. The page is CLAMPED rather than reset from an effect, so
  // filtering down to fewer pages than you are standing on can never show a blank table; the
  // search and page-size handlers send you back to page one, where the cause actually is.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const openCreate = () => {
    const formCategory = CATEGORIES_WITH_FORM[category];
    if (formCategory && selectedDevice) {
      navigate(`/admin/security-profiles/${formCategory}/create?deviceId=${selectedDevice.id}`);
    } else {
      message.info(`Create ${meta.noun} — coming soon`);
    }
  };

  return (
    <>
      {/* ── The devices page's list card, part for part ───────────────────────
          Title + Create on the first row, entries-per-page + search on the second, then
          `.shell-table` itself, with the pager outside the card. This replaced a stack of
          flex `<div>` rows — a medallion, a two-line text block and an action cluster — which
          read as a list rather than a table: nothing lined up down the page between the name
          and the comment, and there were no `<th>`s for a screen reader to announce cells
          against. The comment moved out from under the name into a column of its own, which is
          what gave the table something to align.

          All seven categories share this file (the route's `:category` param picks the meta),
          so one card shape covers seven of the section's eight pages; Web Rating Overrides has
          its own file and got the same treatment there. ── */}
      <div className="shell-card p-0! overflow-hidden">
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
          style={{ borderBottom: "1px solid var(--shell-border)" }}
        >
          <h2 className="m-0 text-[16px] font-semibold ink">{meta.title}</h2>
          {isAdmin && selectedDevice && (
            <button onClick={openCreate} className="btn btn-accent btn-sm">
              <FiPlus size={13} /> Create new
            </button>
          )}
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
            placeholder={`Search ${meta.title.toLowerCase()}…`}
            width="w-60"
          />
        </div>

        <DeviceStates
          state={viewState(filtered.length)}
          from={selectedDevice?.name}
          noun={`${meta.title} profile`}
          icon={meta.icon}
          error={error}
          onRetry={() => void fetchAll()}
          filtered={!!search}
        >
          <div className="overflow-x-auto shell-scroll-thin">
            <table className="shell-table w-full min-w-160">
              <colgroup>
                <col style={{ width: 56 }} />
                <col style={{ width: "34%" }} />
                <col />
                <col style={{ width: 92 }} />
              </colgroup>
              <thead>
                <tr>
                  <th aria-hidden />
                  <th scope="col">Name</th>
                  <th scope="col">Comment</th>
                  <th className="text-right" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((p) => (
                  <tr key={p.name}>
                    <td>
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-[5px] text-[15px] text-white"
                        style={categoryChipStyle(categoryHue(CATEGORY_HUES[category], currentMode))}
                        aria-hidden
                      >
                        {meta.icon}
                      </span>
                    </td>
                    <td className="td-key">
                      <span className="block truncate font-semibold">{p.name}</span>
                    </td>
                    <td>
                      <span className="block truncate ink-3">{p.comment || "No comment"}</span>
                    </td>
                    <td className="text-right">
                      {isAdmin && (p.readonly ? (
                        // Built into FortiOS: it refuses both edit and delete. Saying so beats
                        // offering buttons that can only fail.
                        <span className="chip text-[10px]" title="FortiOS ships this profile and does not allow it to be changed. Create a new one instead.">
                          <FiLock size={10} /> Built-in
                        </span>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            title={`Edit ${meta.noun}`}
                            onClick={() => {
                              const formCategory = CATEGORIES_WITH_FORM[category];
                              if (formCategory && selectedDevice) {
                                navigate(`/admin/security-profiles/${formCategory}/edit?deviceId=${selectedDevice.id}&name=${encodeURIComponent(p.name)}`);
                              } else {
                                message.info(`Edit ${meta.noun} — coming soon`);
                              }
                            }}
                            className="btn-icon">
                            <FiEdit2 size={13} />
                          </button>
                          <button onClick={() => setDeleteTarget(p)}
                            title={`Delete ${meta.noun}`}
                            className="btn-icon btn-icon--danger">
                            <FiTrash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DeviceStates>
      </div>

      {/* The count line is built as ONE string rather than as count-then-noun, so that it can be
          translated as a sentence. "antivirus profile" is a compound, and English puts the modifier
          first where Thai and Chinese put the head noun first; handed to the DOM in pieces it came
          out as three separate children and read as "3 antivirus profile" word for word. As a whole
          string it matches a pattern in the dictionary, which can put the two halves in whichever
          order its own language wants. */}
      {viewState(filtered.length) === "rows" && (
        <div className="mt-3 flex items-center justify-between">
          <p className="m-0 text-[11px] ink-3">
            {search
              ? `${filtered.length} of ${profiles.length} ${meta.title.toLowerCase()} profiles`
              : `${profiles.length} ${meta.title.toLowerCase()} profile${profiles.length !== 1 ? "s" : ""}`}
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
                    ? { background: currentColor, color: "white", borderColor: currentColor }
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

      {/* Delete confirm — a centred card the topic's own cartoon heads, so the danger has a face. */}
      {deleteTarget && (
        <MascotDeleteModal
          mascot={<Mascot className="h-24 w-24" title={`Delete ${meta.noun}`} />}
          name={deleteTarget.name}
          // One string, not JSX children. Written as `<>This {meta.noun} will be …</>` the sentence
          // reached the dictionary as the fragments "This" and "will be permanently removed from",
          // because render-time translation works on whole text nodes — and a bare "This" cannot be
          // translated, since neither Thai nor Chinese puts the determiner where English does.
          description={`This ${meta.noun} will be permanently removed from ${selectedDevice?.name ?? ""}.`}
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
};

export default SecurityProfilesPage;
