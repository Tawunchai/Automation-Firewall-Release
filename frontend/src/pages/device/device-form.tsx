import React from "react";
import { FiKey } from "react-icons/fi";
import MinimalSelect from "../../components/ui/MinimalSelect";
import type { NetworkDevice } from "../../api/device";
import { SCHEDULE_OPTIONS } from "./device-form.logic";
import type { DeviceFormState } from "./device-form.logic";

// The Device create/edit fields, shared by create.tsx and edit.tsx — the same split
// static-routes/route-form.tsx and dhcp-servers/dhcp-form.tsx already use, so this follows that
// pattern rather than inventing a new one.

export const DeviceFields: React.FC<{
  form: DeviceFormState;
  set: <K extends keyof DeviceFormState>(k: K, v: DeviceFormState[K]) => void;
  errors: Record<string, boolean>;
  /** Only present on Edit — drives the automation-account banner below. */
  editing?: NetworkDevice | null;
}> = ({ form, set, errors, editing }) => (
  <div className="space-y-3">
    <label className="block">
      <span className="field-label">Device Name</span>
      <input className="shell-input" placeholder="FortiGate-80E"
        style={errors.name ? { borderColor: "#ef4444" } : undefined}
        value={form.name} onChange={(e) => set("name", e.target.value)} />
    </label>

    <div className="grid grid-cols-4 gap-3">
      <label className="col-span-2 block">
        <span className="field-label">Management IP</span>
        <input className="shell-input" placeholder="10.10.20.90"
          style={errors.mgmt_ip ? { borderColor: "#ef4444" } : undefined}
          value={form.mgmt_ip} onChange={(e) => set("mgmt_ip", e.target.value)} />
      </label>
      <label className="block">
        <span className="field-label">SSH Port</span>
        <input className="shell-input" type="number" min={1} max={65535}
          value={form.port}
          onChange={(e) => set("port", e.target.value === "" ? "" : Number(e.target.value))} />
      </label>
      <label className="block">
        {/* Almost every unit leaves its admin GUI on 443, which is why this looks like a duplicate
            of SSH Port — but it is a different daemon on the device, and a unit whose admin HTTPS
            was moved off 443 cannot be reached at all until this matches it, no matter how correct
            the account password is. */}
        <span className="field-label">API / HTTPS Port</span>
        <input className="shell-input" type="number" min={1} max={65535}
          value={form.api_port}
          onChange={(e) => set("api_port", e.target.value === "" ? "" : Number(e.target.value))} />
      </label>
    </div>

    {/* Only surfaced when something needs doing: scheduled work is blocked, or the device has no
        login of its own yet. When it is reachable on a personal account the banner stays out of the
        way — the reassurance line it used to show there was just noise. Edit-only; a device being
        created has no automation state yet. */}
    {editing && (editing.automation_warning || !editing.automation_account) && (
      <div className={editing.automation_state && editing.automation_state !== "ready"
        ? "banner banner-warn" : "banner banner-accent"}>
        <FiKey size={15} className="shrink-0" />
        <span>
          {editing.automation_warning
            ? <><b>Scheduled work will not run.</b> {editing.automation_warning}</>
            : <>This device has no login of its own. Add yours under <b>Profile ▸ Device Credentials</b> — and tick <b>use for scheduled work</b> there if backups should run on their own.</>}
        </span>
      </div>
    )}

    <div className="grid grid-cols-3 gap-3">
      <label className="block">
        <span className="field-label">Site</span>
        <input className="shell-input" placeholder="HQ"
          value={form.site} onChange={(e) => set("site", e.target.value)} />
      </label>
      <label className="block">
        <span className="field-label">Role</span>
        <input className="shell-input" placeholder="firewall"
          value={form.role} onChange={(e) => set("role", e.target.value)} />
      </label>
      <div className="block">
        <span className="field-label">Status</span>
        <MinimalSelect value={form.status} onChange={(v) => set("status", v)} ariaLabel="Status"
          options={[
            { value: "active", label: "active" },
            { value: "inactive", label: "inactive" },
            { value: "maintenance", label: "maintenance" },
          ]} />
      </div>
    </div>

    <div className="block">
      <span className="field-label">Auto Backup Schedule</span>
      <MinimalSelect value={form.schedule_cron} onChange={(v) => set("schedule_cron", v)}
        ariaLabel="Auto Backup Schedule" options={SCHEDULE_OPTIONS} />
    </div>

    {Object.keys(errors).length > 0 && (
      <p className="m-0 text-[11.5px] text-red-500">Fill in Device Name and Management IP</p>
    )}
  </div>
);
