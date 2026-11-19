import React, { useEffect, useRef, useState } from "react";
import { FiChevronDown, FiWifi, FiWifiOff, FiRefreshCw, FiAlertTriangle, FiCheck, FiHardDrive } from "react-icons/fi";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";

// The FortiGate picker.
//
// There is exactly one of these on screen, in the navbar, and it reads and writes the app-wide
// selection in DeviceContext. It takes no props for that reason: a picker that could be handed a
// different device than the one the rest of the console is using is the bug this replaced.
//
// It is chrome, so it is styled as chrome — the shell's own neutral surfaces, no accent tint. The
// only colour on it is the status dot, because whether the firewall is reachable is the one thing
// here that carries information.

const statusColor = (status: string) =>
  status === "active" ? "#10b981" : status === "maintenance" ? "#f59e0b" : "#94a3b8";

const DeviceSelector: React.FC = () => {
  const { device, setDevice, devices, loading } = useSelectedDevice();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = loading
    ? "Loading devices…"
    : device
    ? device.name
    : devices.length === 0
    ? "No FortiGate devices"
    : "Select device";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="t-body inline-flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 font-semibold transition disabled:opacity-60"
        style={{
          background: open ? "var(--shell-hover)" : "var(--shell-sunken)",
          border: "1px solid var(--shell-border)",
          color: "var(--shell-ink)",
          cursor: loading ? "default" : "pointer",
        }}
      >
        <FiHardDrive size={13} className="ink-3 shrink-0" />
        <span className="max-w-40 truncate">{label}</span>

        {device && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: statusColor(device.status) }}
            title={device.status}
          />
        )}

        {loading ? (
          <FiRefreshCw size={11} className="animate-spin opacity-60" />
        ) : (
          <FiChevronDown
            size={12}
            className={`ink-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 z-50 mt-2 w-72 overflow-hidden rounded-[4px]"
          style={{
            background: "var(--shell-card)",
            border: "1px solid var(--shell-border)",
            boxShadow: "var(--shell-elev-lg)",
          }}
        >
          <div className="hairline-b2 px-4 py-2.5">
            <p className="t-label m-0">FortiGate Devices</p>
          </div>

          <div className="shell-scroll max-h-72 overflow-y-auto py-1.5">
            {loading ? (
              <div className="t-meta flex items-center gap-2 px-4 py-3">
                <FiRefreshCw size={12} className="animate-spin" /> Loading devices…
              </div>
            ) : devices.length === 0 ? (
              <div className="flex items-start gap-2 px-4 py-3">
                <FiAlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
                <div>
                  <p className="t-body m-0 font-semibold">No FortiGate devices found</p>
                  <p className="t-meta m-0 mt-0.5">Add one in the Devices page first.</p>
                </div>
              </div>
            ) : (
              devices.map((d) => {
                const isSelected = device?.id === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => { setDevice(d); setOpen(false); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition"
                    style={{
                      background: isSelected ? "var(--shell-sunken)" : "transparent",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--shell-hover)"; }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isSelected ? "var(--shell-sunken)" : "transparent";
                    }}
                  >
                    <span
                      className="medallion h-7 w-7"
                      style={{ background: "var(--shell-sunken)", color: "var(--shell-ink-3)" }}
                    >
                      {d.status === "active" ? <FiWifi size={12} /> : <FiWifiOff size={12} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="t-body truncate font-semibold">{d.name}</span>
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: statusColor(d.status) }}
                        />
                      </span>
                      <span className="t-meta block truncate">
                        {d.mgmt_ip}{d.site ? ` · ${d.site}` : ""}
                      </span>
                    </span>
                    {isSelected && <FiCheck size={13} className="ink-2 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DeviceSelector;
