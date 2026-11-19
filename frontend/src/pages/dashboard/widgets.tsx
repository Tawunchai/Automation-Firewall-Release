import React from "react";
import {
  FiAlertTriangle, FiCheckCircle, FiXCircle, FiMinusCircle,
} from "react-icons/fi";
import type {
  LicenseOverview, LicenseRow, SystemInformation,
} from "../../api/deviceMonitor";
import {
  cloudRegionLabel, formatBytes, formatDate, formatDeviceTime, formatUptime,
  licenseStatusLabel, licenseTone, TONE_COLORS, type Tone,
} from "./format";
import { ICON_CHIP, type IconChipVariant } from "./kpi";

// The non-chart widgets of System > Dashboard > Status. Every one of them renders whatever the
// device actually returned: a section the firewall refused (an unsupported endpoint, a feature
// that is switched off) shows why, instead of a panel of confident-looking zeroes.
//
// All surfaces come from the shell tokens in index.css, so these cards are the same material as
// the sidebar and navbar in both themes.

// ── Shared shell ──────────────────────────────────────────────────────────────

export const Widget: React.FC<{
  title: string;
  icon?: React.ReactNode;
  accent: string;
  action?: React.ReactNode;
  className?: string;
  /** "sans" swaps the title off `.t-card`'s own Poppins-driven `--font-display` and onto the
      page's base `--font-sans` (Plus Jakarta Sans) instead — scoped to the one caller that asks
      for it rather than touching `.t-card` itself, which every other panel in the console
      (Config Drift, the Interfaces throughput panel) still shares. */
  titleFont?: "display" | "sans";
  /** Drops the icon medallion and the `.card-title` accent bar for a bare heading — Dastone's own
      chart-card titles ("Audience Overview") carry neither. Every other widget keeps the ornament;
      this is an exception for the one panel built to sit next to that reference. */
  plainTitle?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, accent, action, className = "", titleFont = "display", plainTitle = false, children }) => (
  <section className={`shell-card flex flex-col overflow-hidden ${className}`}>
    {/* The accent bar on .card-title is the console's one repeated ornament — it is what makes
        a panel title read as a panel title at a glance. Enlarged from the original 24px chip: a
        bigger, softer-tinted badge is the one visual move every "premium" admin template shares,
        and it reads as the header's anchor instead of a small afterthought beside the text. */}
    <header className="card-head">
      <h2
        className={`card-title t-card${plainTitle ? " card-title--plain" : ""}`}
        style={titleFont === "sans" ? { fontFamily: "var(--font-sans)" } : undefined}
      >
        {icon && !plainTitle && (
          <span
            className="medallion h-9 w-9 text-[17px]"
            style={{ color: accent, background: `color-mix(in srgb, ${accent} 14%, transparent)` }}
          >
            {icon}
          </span>
        )}
        <span className="truncate">{title}</span>
      </h2>
      {action}
    </header>
    <div className="flex-1 px-4 py-4">{children}</div>
  </section>
);

/** Why a section is missing — shown in place of the widget body. */
export const WidgetError: React.FC<{ message: string }> = ({ message }) => (
  <div
    className="flex items-start gap-2 rounded-[4px] px-3 py-2.5"
    style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.22)" }}
  >
    <FiAlertTriangle className="mt-0.5 shrink-0" size={13} style={{ color: "#f59e0b" }} />
    <p className="t-meta m-0 text-amber-700 dark:text-amber-300/90">{message}</p>
  </div>
);

const Skeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <div className="space-y-2.5">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="shell-skeleton h-3.5 w-full" />
    ))}
  </div>
);

/** Label/value row — System Information and FortiGate Cloud's own layout (the reference-styled
    icon-chip list stayed on Licenses only, which is the one of the three that's read as a status
    list rather than a spec sheet). */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({
  label, children,
}) => (
  <div className="flex items-start justify-between gap-3 py-2">
    <span className="t-meta shrink-0">{label}</span>
    <span className="t-body min-w-0 wrap-break-word text-right font-semibold">{children}</span>
  </div>
);

/** Hairline between rows, as a wrapper so every info widget divides identically. */
const Rows: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="[&>*+*]:border-t [&>*+*]:border-(--shell-border-2)">{children}</div>
);

/** The shared `.chip-*` soft-pill class for each tone — "muted" has no tint variant, it's what
    the base `.chip` already looks like. */
const TONE_CHIP_CLASS: Record<Tone, string> = {
  ok: "chip-ok",
  warn: "chip-warn",
  error: "chip-danger",
  muted: "",
};

/**
 * A single fact, styled as the reference's own file-list row (Financial Documents): a solid
 * gradient icon chip, a bold title that names the field, and a muted meta line underneath it for
 * the actual reading — rather than this widget's old label-left/value-right pair. Every dashboard
 * info widget (System Information, Licenses, FortiGate Cloud) is now a list of these.
 */
const InfoItem: React.FC<{
  icon: React.ReactNode;
  variant: IconChipVariant;
  title: string;
  meta: React.ReactNode;
}> = ({ icon, variant, title, meta }) => (
  <li
    className="-mx-2 flex items-center gap-2.5 rounded-[4px] p-2 transition-colors hover:bg-(--shell-sunken)"
  >
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px]"
      style={ICON_CHIP[variant]}
      aria-hidden
    >
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <p className="m-0 truncate text-[12px] font-semibold text-(--shell-ink)">{title}</p>
      <p className="m-0 mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[10.5px] text-(--shell-ink-3)">
        {meta}
      </p>
    </div>
  </li>
);

/** Scrollable list shell — a fixed ceiling so the three widgets in a row stay the same height
    regardless of how many facts the device actually returned, with a visibly-present scrollbar
    (not the hover-revealed kind elsewhere) saying plainly that there is more below the fold. */
const InfoList: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul className="shell-scroll-thin m-0 max-h-64 list-none space-y-0.5 overflow-y-auto overflow-x-hidden p-0 pr-1">
    {children}
  </ul>
);

/** Tone → icon-chip variant, so a license's actual verdict picks the chip colour. */
const TONE_VARIANT: Record<Tone, IconChipVariant> = {
  ok: "success",
  warn: "warning",
  error: "danger",
  muted: "neutral",
};

const ToneIcon: React.FC<{ tone: Tone; size?: number }> = ({ tone, size = 13 }) => {
  if (tone === "ok") return <FiCheckCircle size={size} />;
  if (tone === "error") return <FiXCircle size={size} />;
  if (tone === "warn") return <FiAlertTriangle size={size} />;
  return <FiMinusCircle size={size} />;
};

/** The shared `.badge-soft` tone classes — "muted" reads as neutral, the same as the reference's
    own "MTD" pill. */
const TONE_BADGE_CLASS: Record<Tone, string> = {
  ok: "badge-success",
  warn: "badge-warning",
  error: "badge-danger",
  muted: "badge-neutral",
};

// ── System Information ────────────────────────────────────────────────────────

export const SystemInformationWidget: React.FC<{
  system: SystemInformation | null;
  /** Seconds elapsed since the snapshot, so time and uptime keep ticking between refreshes. */
  tick: number;
  accent: string;
  loading: boolean;
}> = ({ system, tick, accent, loading }) => (
  <Widget title="System Information" accent={accent} titleFont="sans" plainTitle>
    {loading || !system ? (
      <Skeleton rows={7} />
    ) : (
      <Rows>
        <Row label="Hostname">{system.hostname || "—"}</Row>
        <Row label="Serial Number">
          <span className="t-mono">{system.serial || "—"}</span>
        </Row>
        <Row label="Firmware">
          {system.version || "—"}
          {system.build ? ` build${system.build}` : ""}
          {system.maturity ? ` (${system.maturity})` : ""}
          {system.firmware_latest && (
            <span className="chip chip-warn ml-1.5">
              {system.firmware_latest} available
            </span>
          )}
        </Row>
        <Row label="Mode">{system.operation_mode || "—"}</Row>
        <Row label="System Time">
          <span className="t-mono">
            {formatDeviceTime(system.system_time + tick, system.timezone_offset)}
          </span>
        </Row>
        <Row label="Uptime">
          <span className="t-mono">
            {system.uptime_seconds ? formatUptime(system.uptime_seconds + tick) : "—"}
          </span>
        </Row>
        <Row label="WAN IP">
          <span className="t-mono">{system.wan_ip || "—"}</span>
        </Row>
        {system.vdom_max > 0 && (
          <Row label="Virtual Domains">{system.vdom_used} / {system.vdom_max}</Row>
        )}
      </Rows>
    )}
  </Widget>
);

// ── Licenses ──────────────────────────────────────────────────────────────────

/** One entitlement: icon chip by tone, the label as the title, and the device's own verdict as a
    `.badge-soft` pill in the meta line — replacing the old tinted bar-with-a-chip-on-the-right. */
const LicenseItem: React.FC<{ row: LicenseRow }> = ({ row }) => {
  const tone = licenseTone(row.status);
  return (
    <InfoItem
      icon={<ToneIcon tone={tone} size={13} />}
      variant={TONE_VARIANT[tone]}
      title={row.label}
      meta={
        <>
          <span className={`badge-soft ${TONE_BADGE_CLASS[tone]}`}>{licenseStatusLabel(row.status)}</span>
          {row.expires && (
            <span className="truncate">
              {row.status === "expired" ? "expired" : "expires"} {formatDate(row.expires)}
            </span>
          )}
        </>
      }
    />
  );
};

export const LicensesWidget: React.FC<{
  licenses: LicenseOverview | null;
  error?: string;
  accent: string;
  loading: boolean;
}> = ({ licenses, error, accent, loading }) => {
  const tokens = licenses?.fortitoken;
  const tokenPct = tokens && tokens.total > 0 ? (tokens.used / tokens.total) * 100 : 0;

  return (
    <Widget
      title="Licenses"
      accent={accent}
      titleFont="sans"
      plainTitle
      action={
        licenses?.fortiguard.wan_ip ? (
          <span className="t-meta flex items-center gap-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: licenses.fortiguard.connected ? TONE_COLORS.ok : TONE_COLORS.error,
              }}
            />
            <span className="t-mono">{licenses.fortiguard.wan_ip}</span>
          </span>
        ) : undefined
      }
    >
      {error ? (
        <WidgetError message={error} />
      ) : loading || !licenses ? (
        <Skeleton rows={5} />
      ) : (
        <div className="space-y-2">
          {/* Every entitlement in one scrollable list — no "show N more" toggle. The list's own
              visible scrollbar (InfoList's `.shell-scroll-thin`) is the affordance now: scrolling
              it down is how the rest show up, the same as the reference's own file lists. */}
          <InfoList>
            {[...licenses.primary, ...licenses.secondary].map((row) => (
              <LicenseItem key={row.key} row={row} />
            ))}
          </InfoList>

          {tokens && tokens.total > 0 && (
            <div className="pt-1.5">
              <div className="flex items-center justify-between">
                <span className="t-meta">FortiToken</span>
                <span className="t-body tnum font-semibold">
                  {tokens.used} / {tokens.total}
                </span>
              </div>
              <div
                className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: "var(--shell-sunken)" }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${tokenPct}%`, background: accent }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </Widget>
  );
};

// ── FortiGate Cloud ───────────────────────────────────────────────────────────

export const FortiGateCloudWidget: React.FC<{
  licenses: LicenseOverview | null;
  error?: string;
  accent: string;
  loading: boolean;
}> = ({ licenses, error, accent, loading }) => {
  const cloud = licenses?.forticloud;
  return (
    <Widget title="FortiGate Cloud" accent={accent} titleFont="sans" plainTitle>
      {error ? (
        <WidgetError message={error} />
      ) : loading || !cloud ? (
        <Skeleton rows={4} />
      ) : (
        <Rows>
          <Row label="Status">
            <span className={`chip ${cloud.activated ? "chip-ok" : ""}`}>
              {cloud.activated ? "Activated" : "Not Activated"}
            </span>
          </Row>
          <Row label="Server Location">{cloudRegionLabel(cloud.domain)}</Row>
          <Row label="Log Retention">
            <span className="inline-flex items-center gap-2">
              <span className={`chip ${TONE_CHIP_CLASS[licenseTone(cloud.logging_status)]}`}>
                {licenseStatusLabel(cloud.logging_status)}
              </span>
              {cloud.log_retention_days > 0 && (
                <span className="t-meta">
                  ({cloud.log_retention_days}d)
                </span>
              )}
            </span>
          </Row>
          <Row label="Storage Used">
            {formatBytes(cloud.used_bytes)}
            {cloud.max_bytes ? <span className="ink-3 font-normal"> of {formatBytes(cloud.max_bytes)}</span> : null}
          </Row>
          {cloud.account && <Row label="Account">{cloud.account}</Row>}
        </Rows>
      )}
    </Widget>
  );
};

// Security Fabric used to have a widget here — removed from the dashboard as duplication of the
// port chassis's own up/down read (see pages/dashboard/index.tsx), and deleted from this file
// rather than left to rot once nothing rendered it.
