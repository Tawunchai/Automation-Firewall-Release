import React, { useState } from "react";
import { message } from "../../components/ui/toast";
import { FiInfo, FiCheckCircle, FiXCircle, FiLoader } from "react-icons/fi";
import { DeviceTestRADIUSServer, type RADIUSAuthType, type RADIUSOrdinal, type RADIUSTestResult } from "../../api/policyObject";
import { labelCls, inputCls, rowCls, sectionHdr, Toggle } from "../fw-addresses/address-form";
import { Segmented } from "../../components/ui/form-controls";
import { focusRing } from "../../components/ui/form-controls.logic";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { PasswordInput } from "./ldap-server-form";
import { NAME_MAX, RADIUS_AUTH_OPTIONS, SERVER_MAX } from "./radius-server-form.logic";
import type { RADIUSServerFormState } from "./radius-server-form.logic";
import { apiErrorDetail } from "../../api/errorText";

// Form state for the FortiGate "New RADIUS Server" dialog (User & Authentication >
// RADIUS Servers). ONE user/radius object holds both hosts.
//
// The dialog collects exactly these fields — Name, Authentication method, NAS IP, Include in
// every user group, then a Primary and a Secondary Server block. user/radius also has
// tertiary-* and timeout, but the GUI never shows them, so neither does this form (and the
// payload omits both keys, leaving any CLI-set value on the device untouched).
//
// Field ↔ CMDB map (user/radius?action=schema, FortiOS 7.2.10):
//   authMethodSpecify   → auth-type "auto" when off, the chosen method when on
//   nasIP               → nas-ip          (the device stores "unset" as 0.0.0.0)
//   allUserGroup        → all-usergroup   ("Include in every user group")
//   server/secret       → server / secret            (Primary)
//   secondaryServer/…   → secondary-server / secondary-secret
// The four methods the GUI's Specify dropdown offers. "auto" is not in the list — it IS the
// Default position of the switch.
// buildRADIUSServerPayload omits the blank optional fields rather than sending "".
//   · secrets — the device never returns them, so blank means "keep the stored one"
//   · secondary host — address-typed; FortiOS rejects "" outright with -257 ("value parse error
//     before ''"), which would abort the whole save. See RADIUS_BACKUP_CLEAR_NOTE.
// NAS IP is the exception: it is always sent (blank included) because the backend translates a
// blank one into the device's 0.0.0.0 "unset" value, which really does clear it.
// Removing the secondary host is CLI-only on FortiOS 7.2.10 — verified on the device: PUT with
// "" or null → -257, and 0.0.0.0 collides with the "addresses must be distinct" rule (-61).
// Say so where the user would try it.
export const RADIUS_BACKUP_CLEAR_NOTE =
  "Clearing this field will not remove the server — the FortiGate's REST API cannot unset a " +
  "secondary RADIUS host. Change it to a different address here, or remove it from the CLI with " +
  "`config user radius / edit <name> / unset secondary-server`.";

// ─── Test Connectivity / Test User Credentials ─────────────────────────────────
// These run the DEVICE's own check (monitor/user/radius/test-connect), which keys off the
// SAVED object — so they only work once the server exists. On the create page they are
// disabled with that reason rather than silently testing nothing.

type TestState = { running: boolean; result: RADIUSTestResult | null; error: string };

const testOK = (r: RADIUSTestResult) =>
  r.status.toLowerCase() === "successful" || /accept/i.test(r.access_status);

const TestResultLine: React.FC<{ state: TestState }> = ({ state }) => {
  if (state.running) {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-[11.5px] ink-2">
        <FiLoader size={11} className="animate-spin" /> Testing…
      </p>
    );
  }
  if (state.error) {
    return (
      <p className="mt-1 flex items-start gap-1.5 text-[11.5px] text-red-500">
        <FiXCircle size={11} className="mt-0.5 shrink-0" /> {state.error}
      </p>
    );
  }
  if (!state.result) return null;

  const ok = testOK(state.result);
  const detail = [state.result.access_status, state.result.access_message].filter(Boolean).join(" — ");
  return (
    <p className={`mt-1 flex items-start gap-1.5 text-[11.5px] ${ok ? "text-emerald-600" : "text-amber-600"}`}>
      {ok ? <FiCheckCircle size={11} className="mt-0.5 shrink-0" /> : <FiXCircle size={11} className="mt-0.5 shrink-0" />}
      <span>{state.result.status}{detail ? ` (${detail})` : ""}</span>
    </p>
  );
};

// Both server blocks get both buttons, exactly as the FortiGate dialog shows them.
const ServerTestButtons: React.FC<{
  deviceId: number | null;
  savedName: string;          // "" on the create page — the device has nothing to test yet
  ordinal: RADIUSOrdinal;
  currentColor: string;
}> = ({ deviceId, savedName, ordinal, currentColor }) => {
  const [state, setState] = useState<TestState>({ running: false, result: null, error: "" });
  const [credsOpen, setCredsOpen] = useState(false);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");

  const enabled = !!deviceId && !!savedName;
  const disabledReason = "Save the RADIUS server first — the FortiGate tests a stored server by name.";

  const run = async (u?: string, p?: string) => {
    if (!enabled) return;
    setState({ running: true, result: null, error: "" });
    try {
      const res = await DeviceTestRADIUSServer(deviceId!, savedName, ordinal, u, p);
      setState({ running: false, result: res, error: "" });
    } catch (err) {
      setState({ running: false, result: null, error: apiErrorDetail(err, "Test failed") });
    }
  };

  const btn = "w-fit rounded border px-3 py-1.5 text-[12px] font-semibold transition";
  const btnEnabled = "hairline ink-2 surface-hover  ";
  const btnDisabled = "cursor-not-allowed hairline ink-3  ";

  return (
    <div className="space-y-2">
      {/* The dialog stacks the two buttons, one per row. */}
      <div className="flex flex-col items-start gap-2">
        <button type="button" disabled={!enabled || state.running} onClick={() => run()}
          title={enabled ? undefined : disabledReason}
          className={`${btn} ${enabled ? btnEnabled : btnDisabled}`}>
          Test Connectivity
        </button>
        <button type="button" disabled={!enabled || state.running} onClick={() => setCredsOpen((o) => !o)}
          title={enabled ? undefined : disabledReason}
          className={`${btn} ${enabled ? btnEnabled : btnDisabled}`}>
          Test User Credentials
        </button>
      </div>

      {credsOpen && enabled && (
        <div className="flex flex-wrap items-end gap-2 rounded border hairline p-2.5">
          <div>
            <p className="mb-1 text-[11px] font-medium ink-2">Username</p>
            <input value={user} onChange={(e) => setUser(e.target.value)}
              className={`${inputCls} w-40 flex-none`} {...focusRing(currentColor)} />
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium ink-2">Password</p>
            <PasswordInput value={password} onChange={setPassword} currentColor={currentColor} width="160px" />
          </div>
          <button type="button" disabled={state.running}
            onClick={() => {
              if (!user.trim() || !password) { message.warning("Enter both a username and a password"); return; }
              void run(user.trim(), password);
            }}
            className="h-8 rounded px-4 text-[12px] font-semibold text-white transition disabled:opacity-50"
            style={{ background: currentColor }}>
            Test
          </button>
        </div>
      )}

      <TestResultLine state={state} />
      {!enabled && (
        <p className="flex items-start gap-1 text-[11px] ink-3">
          <FiInfo size={11} className="mt-0.5 shrink-0" /> {disabledReason}
        </p>
      )}
    </div>
  );
};

// ─── Fields ────────────────────────────────────────────────────────────────────
export type RADIUSServerFieldsProps = {
  form: RADIUSServerFormState;
  set: <K extends keyof RADIUSServerFormState>(k: K, v: RADIUSServerFormState[K]) => void;
  errors: Record<string, string>;
  currentColor: string;
  deviceId: number | null;
  savedName?: string; // "" on create — gates the Test buttons
  isEdit?: boolean;
};

export const RADIUSServerFields: React.FC<RADIUSServerFieldsProps> = ({
  form, set, errors, currentColor, deviceId, savedName = "", isEdit,
}) => {
  const err = (k: string) => errors[k] && <p className="mt-1 text-[11px] text-red-500">{errors[k]}</p>;
  const required = (v: string) => (v.trim() ? undefined : { backgroundColor: "#fffbe6" });

  // One "IP/Name + Secret + Test buttons" block; the two servers differ only in which keys they
  // touch and whether the fields are required.
  const serverBlock = (
    title: string,
    ordinal: RADIUSOrdinal,
    hostKey: "server" | "secondaryServer",
    secretKey: "secret" | "secondarySecret",
    optional?: boolean,
  ) => {
    // On EDIT, a secondary host that is already on the device can be changed but not removed.
    const showClearNote = !!isEdit && !!optional && !form[hostKey].trim();
    return (
      <React.Fragment key={ordinal}>
        <div className={sectionHdr}>{title}</div>
        <div className="space-y-3 px-5 py-4">
          <div className={rowCls}>
            <label htmlFor="ip-name" className={labelCls}>IP/Name</label>
            <div className="flex-1">
              <input id="ip-name" value={form[hostKey]} onChange={(e) => set(hostKey, e.target.value)} maxLength={SERVER_MAX}
                className={`${inputCls} w-full max-w-67.5 ${errors[hostKey] ? "border-red-400" : ""}`}
                style={optional ? undefined : required(form[hostKey])}
                {...focusRing(currentColor)} />
              {err(hostKey)}
              {showClearNote && (
                <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-600">
                  <FiInfo size={11} className="mt-0.5 shrink-0" />
                  {RADIUS_BACKUP_CLEAR_NOTE}
                </p>
              )}
            </div>
          </div>
          <div role="group" aria-labelledby="secret-label" className={rowCls}>
            <span id="secret-label" className={labelCls}>Secret</span>
            <div className="flex-1">
              <PasswordInput value={form[secretKey]} onChange={(v) => set(secretKey, v)}
                currentColor={currentColor} invalid={!!errors[secretKey]}
                placeholder={isEdit ? "unchanged" : ""} />
              {isEdit && !errors[secretKey] && (
                <p className="mt-1 flex items-start gap-1 text-[11px] ink-3">
                  <FiInfo size={11} className="mt-0.5 shrink-0" />
                  Leave blank to keep the stored secret — the FortiGate never returns it.
                </p>
              )}
              {err(secretKey)}
            </div>
          </div>
          <div className={rowCls}>
            <span className={labelCls} />
            <div className="flex-1">
              <ServerTestButtons deviceId={deviceId} savedName={savedName} ordinal={ordinal}
                currentColor={currentColor} />
            </div>
          </div>
        </div>
      </React.Fragment>
    );
  };

  return (
    <div>
      <div className="space-y-3 px-5 py-4">
        <div className={rowCls}>
          <label htmlFor="name" className={labelCls}>Name</label>
          <div className="flex-1">
            <input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={NAME_MAX}
              className={`${inputCls} w-full max-w-67.5 ${errors.name ? "border-red-400" : ""}`}
              style={required(form.name)} {...focusRing(currentColor)} />
            {err("name")}
          </div>
        </div>

        <div className={rowCls}>
          <label htmlFor="authentication-method" className={labelCls}>Authentication method</label>
          <div className="flex flex-1 flex-wrap items-center gap-3">
            <Segmented label="Authentication method" value={form.authMethodSpecify ? "specify" : "default"}
              onChange={(v) => set("authMethodSpecify", v === "specify")}
              currentColor={currentColor}
              options={[{ v: "default", l: "Default" }, { v: "specify", l: "Specify" }]} />
            {form.authMethodSpecify && (
              <MinimalSelect id="authentication-method" value={form.authType} ariaLabel="Authentication method"
                className="w-40 flex-none"
                onChange={(v) => set("authType", v as RADIUSAuthType)}
                options={RADIUS_AUTH_OPTIONS.map((o) => ({ value: o.v, label: o.l }))} />
            )}
          </div>
        </div>

        <div className={rowCls}>
          <label htmlFor="nas-ip" className={labelCls}>NAS IP</label>
          <div className="flex-1">
            <input id="nas-ip" value={form.nasIP} onChange={(e) => set("nasIP", e.target.value)}
              className={`${inputCls} w-full max-w-67.5 ${errors.nasIP ? "border-red-400" : ""}`}
              {...focusRing(currentColor)} />
            {err("nasIP")}
          </div>
        </div>

        <div role="group" aria-labelledby="include-in-every-user-group-label" className={rowCls}>
          <span id="include-in-every-user-group-label" className={labelCls}>Include in every user group</span>
          <div className="pt-1">
            <Toggle label="Include in every user group" checked={form.allUserGroup} onChange={(v) => set("allUserGroup", v)} color={currentColor} />
          </div>
        </div>
      </div>

      {serverBlock("Primary Server", "primary", "server", "secret")}
      {serverBlock("Secondary Server", "secondary", "secondaryServer", "secondarySecret", true)}
    </div>
  );
};
