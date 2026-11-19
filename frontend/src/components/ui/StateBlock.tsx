import React from "react";
import { FiAlertTriangle, FiHardDrive, FiInbox, FiLoader } from "react-icons/fi";
import type { DeviceViewState } from "../../hooks/useDeviceData";

// The four things a list panel can show instead of rows.
//
// Every list page in the console wrote its own: a centred grey line for "loading", a different
// centred grey line for "empty", an amber block for "the device would not answer". They drifted —
// different paddings, different sizes, and in a couple of places an error rendered with the same
// weight as an empty list, which is the one confusion that actually matters here. An empty policy
// table means "no rules exist"; an unreadable one means "rules may well be in force and we cannot
// see them". Those must not look alike.
//
// So: one shape (`.state-block` in index.css), four meanings, and the error variant is the only
// one that is coloured.

/** Waiting on the device. Names it, because "Loading…" over a firewall console is not enough. */
export const LoadingState: React.FC<{ what?: string; from?: string }> = ({ what = "data", from }) => (
  <div className="state-block">
    <span className="state-icon">
      <FiLoader className="animate-spin" size={18} />
    </span>
    <p className="state-title m-0">
      Loading {what}{from ? ` from ${from}` : ""}…
    </p>
  </div>
);

/** No device is selected. The picker is in the navbar, so that is where this points. */
export const NoDeviceState: React.FC = () => (
  <div className="state-block">
    <span className="state-icon"><FiHardDrive size={18} /></span>
    <p className="state-title m-0">No device selected</p>
    <p className="state-text m-0">Pick a FortiGate from the selector in the top bar and this page loads on its own</p>
  </div>
);

/** The device answered, and the answer was "nothing here". */
export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}> = ({ icon, title, hint, action }) => (
  <div className="state-block">
    <span className="state-icon">{icon ?? <FiInbox size={18} />}</span>
    <p className="state-title m-0">{title}</p>
    {hint && <p className="state-text m-0">{hint}</p>}
    {action}
  </div>
);

/**
 * The device did not answer.
 *
 * Deliberately distinct from EmptyState, and never a fallback for it: on a firewall console the
 * difference between "there are no rules" and "we could not read the rules" is the difference
 * between a safe page and a dangerously wrong one.
 */
export const ErrorState: React.FC<{
  title: string;
  detail?: string;
  note?: string;
  onRetry?: () => void;
}> = ({ title, detail, note, onRetry }) => (
  <div className="state-block">
    <span className="state-icon" style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>
      <FiAlertTriangle size={18} />
    </span>
    <p className="state-title m-0">{title}</p>
    {detail && <p className="state-text m-0">{detail}</p>}
    {note && <p className="state-text m-0 opacity-80">{note}</p>}
    {onRetry && (
      <button type="button" className="btn btn-soft btn-sm mt-1" onClick={onRetry}>
        Try again
      </button>
    )}
  </div>
);

/**
 * Renders whichever of the four blocks the page should be showing, or the rows.
 *
 * Every device list page routes through this, so the ordering rule in `deviceViewState` — above
 * all, that an ERROR never falls through to "empty" — is applied in one place instead of being
 * re-implemented per page, which is how seven of eight pages came to get it wrong.
 */
export const DeviceStates: React.FC<{
  state: DeviceViewState;
  /** Device name, for "loading from …". */
  from?: string;
  /** What the page is loading, e.g. "address object". */
  noun: string;
  icon?: React.ReactNode;
  /** The failure text from useDeviceData. */
  error?: string | null;
  onRetry?: () => void;
  /** Shown on the empty state only — e.g. a "create the first one" button. */
  emptyAction?: React.ReactNode;
  /** True when a search box is filtering, so "empty" means "no match", not "none exist". */
  filtered?: boolean;
  children: React.ReactNode;
}> = ({ state, from, noun, icon, error, onRetry, emptyAction, filtered, children }) => {
  switch (state) {
    case "no-device":
      return <NoDeviceState />;
    case "loading":
      return <LoadingState what={noun} from={from} />;
    case "error":
      return (
        <ErrorState
          title={`Could not read the ${noun} list from ${from ?? "the device"}`}
          detail={error ?? undefined}
          note={`The device may well still have ${noun}s — this list is "unreadable", not "empty"`}
          onRetry={onRetry}
        />
      );
    case "empty":
      return (
        <EmptyState
          icon={icon}
          title={filtered ? `No ${noun} matches your search` : `This device has no ${noun} yet`}
          action={filtered ? undefined : emptyAction}
        />
      );
    default:
      return <>{children}</>;
  }
};
