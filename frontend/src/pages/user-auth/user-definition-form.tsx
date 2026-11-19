import React, { useEffect, useMemo, useRef, useState } from "react";
import { FiPlus, FiSearch, FiX, FiUsers, FiInfo, FiArrowUp, FiArrowDown } from "react-icons/fi";
import { type LocalUserOptions } from "../../api/policyObject";
import { labelCls, inputCls, rowCls, Toggle } from "../fw-addresses/address-form";
import { Segmented } from "../../components/ui/form-controls";
import { focusRing } from "../../components/ui/form-controls.logic";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { COUNTRY_DIAL_CODES, NAME_MAX, USER_TYPE_OPTIONS } from "./user-definition-form.logic";
import type { LocalUserFormState } from "./user-definition-form.logic";

// State for the FortiGate "Users/Groups Creation Wizard" — Local User branch (user/local with
// type=password). Field-by-field mapping and the device rules it encodes live in
// services/fortigate.go (buildLocalUserPayload).
// The wizard's User Type list. Only Local User is implemented — the remote types need a server
// datasource (user/radius, user/tacacs+, user/ldap) this form doesn't collect, and FSSO/FortiNAC
// aren't user/local objects at all. They're shown (as the FortiGate dialog does) but disabled.
// Country dial codes for the SMS step. FortiOS stores sms-phone as "+<code>-<number>".
// The wizard's four steps. Each one validates on Next, so a bad field is caught on the step
// that owns it rather than at Submit.
// validateLocalUserForm runs every step — used by the edit page, which shows all fields at once.
// ─── Datasource hook ───────────────────────────────────────────────────────────
// ─── "Select Entries" group picker ─────────────────────────────────────────────
const GroupPicker: React.FC<{
  open: boolean; onClose: () => void;
  candidates: string[]; selected: string[];
  onToggle: (name: string) => void; currentColor: string; loading: boolean;
}> = ({ open, onClose, candidates, selected, onToggle, currentColor, loading }) => {
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); };
  }, [open, onClose]);

  const hits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((c) => !q || c.toLowerCase().includes(q));
  }, [candidates, search]);

  if (!open) return null;

  return (
    <div ref={ref}
      className="absolute left-0 top-full z-30 mt-1 w-75 overflow-hidden rounded border hairline surface-card shadow-lg">
      <div className="flex items-center justify-between border-b hairline surface-sunken px-3 py-2">
        <span className="text-[12px] font-semibold ink-2">Select Entries</span>
        <button type="button" onClick={onClose} className="ink-3 hover-ink">
          <FiX size={14} />
        </button>
      </div>
      <div className="border-b hairline px-2 py-2">
        <div className="relative">
          <FiSearch size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ink-3" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
            className={`${inputCls} w-full pl-7`} {...focusRing(currentColor)} />
        </div>
      </div>
      <div className="max-h-60 overflow-y-auto py-1">
        {loading ? (
          <p className="py-6 text-center text-[12px] ink-3">Loading…</p>
        ) : hits.length === 0 ? (
          <p className="py-6 text-center text-[12px] italic ink-3">No entries</p>
        ) : hits.map((g) => {
          const on = selected.includes(g);
          return (
            <button key={g} type="button" onClick={() => onToggle(g)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors surface-hover"
              style={on ? { background: `${currentColor}12` } : undefined}>
              <FiUsers size={12} className="shrink-0 ink-3" />
              <span className="flex-1 truncate ink">{g}</span>
              {on && <span className="text-[10px] font-bold" style={{ color: currentColor }}>✓</span>}
            </button>
          );
        })}
      </div>
      <div className="border-t hairline px-3 py-2 text-right">
        <button type="button" onClick={onClose}
          className="rounded border hairline px-3 py-1 text-[12px] font-semibold ink-2 surface-hover">
          Close
        </button>
      </div>
    </div>
  );
};

// ─── Step field groups ─────────────────────────────────────────────────────────
export type LocalUserFieldsProps = {
  form: LocalUserFormState;
  set: <K extends keyof LocalUserFormState>(k: K, v: LocalUserFormState[K]) => void;
  errors: Record<string, string>;
  options: LocalUserOptions;
  loadingOptions: boolean;
  currentColor: string;
  isEdit?: boolean;
};

// A required field in the FortiGate GUI has a pale-yellow background.
const requiredBg = (filled: boolean) => (filled ? undefined : { backgroundColor: "#fffbe6" });
const errText = (msg?: string) =>
  msg ? <p className="mt-1 flex items-center gap-1 text-[11px] text-red-500"><span className="text-[10px]">⛔</span>{msg}</p> : null;

export const UserTypeStep: React.FC<LocalUserFieldsProps> = ({ form, set, currentColor }) => (
  <div className="px-5 py-4">
    <div className="w-fit min-w-52.5 overflow-hidden rounded border hairline">
      {USER_TYPE_OPTIONS.map((o, i) => {
        const active = form.userType === o.v;
        return (
          <button key={o.v} type="button" disabled={!o.enabled}
            onClick={() => o.enabled && set("userType", o.v as LocalUserFormState["userType"])}
            title={o.enabled ? undefined : "Not supported yet — this app builds Local Users only"}
            className={`block w-full px-3 py-1.5 text-left text-[12.5px] transition-colors ${i > 0 ? "border-t hairline" : ""} ${
              active ? "font-semibold text-white"
                : o.enabled ? "ink surface-hover  "
                : "cursor-not-allowed ink-3"}`}
            style={active ? { background: currentColor } : undefined}>
            {o.l}
          </button>
        );
      })}
    </div>
    <p className="mt-2.5 flex items-start gap-1 text-[11px] ink-3">
      <FiInfo size={11} className="mt-0.5 shrink-0" />
      Only <b className="mx-1">Local User</b> is available — the remote types need a RADIUS/TACACS+/LDAP server object,
      and FSSO/FortiNAC users aren't stored on this device.
    </p>
  </div>
);

export const LoginCredentialsStep: React.FC<LocalUserFieldsProps> = ({ form, set, errors, currentColor, isEdit }) => (
  <div className="space-y-3 px-5 py-4">
    <div className={rowCls}>
      <label htmlFor="username" className={labelCls}>Username</label>
      <div className="flex-1">
        <input id="username" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={NAME_MAX}
          className={`${inputCls} w-full max-w-85 ${errors.name ? "border-red-400" : ""}`}
          style={requiredBg(!!form.name)} {...focusRing(currentColor)} />
        {errText(errors.name)}
      </div>
    </div>
    <div className={rowCls}>
      <label htmlFor="password" className={labelCls}>Password</label>
      <div className="flex-1">
        <input id="password" type="password" value={form.password} onChange={(e) => set("password", e.target.value)}
          autoComplete="new-password"
          placeholder={isEdit ? "Leave blank to keep the current password" : undefined}
          className={`${inputCls} w-full max-w-85 ${errors.password ? "border-red-400" : ""}`}
          style={isEdit ? undefined : requiredBg(!!form.password)} {...focusRing(currentColor)} />
        {errText(errors.password)}
      </div>
    </div>
  </div>
);

export const ContactInfoStep: React.FC<LocalUserFieldsProps> = ({
  form, set, errors, options, loadingOptions, currentColor,
}) => (
  <div>
    <div className="flex items-center gap-3 border-b hairline surface-sunken px-5 py-2.5">
      <Toggle label="Two-factor authentication" checked={form.twoFactorEnabled} onChange={(v) => set("twoFactorEnabled", v)} color={currentColor} />
      <span className="text-[12.5px] font-semibold ink">Two-factor Authentication</span>
    </div>

    {form.twoFactorEnabled && (
      <div className="space-y-3 px-5 py-4">
        <div role="group" aria-labelledby="authentication-type-label" className={rowCls}>
          <span id="authentication-type-label" className={labelCls}>Authentication Type</span>
          <div className="flex-1">
            <div className="w-fit min-w-40 overflow-hidden rounded border hairline">
              {([
                { v: "fortitoken-cloud", l: "FortiToken Cloud" },
                { v: "fortitoken", l: "FortiToken" },
              ] as const).map((o, i) => {
                const active = form.authType === o.v;
                return (
                  <button key={o.v} type="button" onClick={() => set("authType", o.v)}
                    className={`block w-full px-3 py-1.5 text-left text-[12.5px] transition-colors ${i > 0 ? "border-t hairline" : ""} ${active ? "font-semibold text-white" : "ink surface-hover"}`}
                    style={active ? { background: currentColor } : undefined}>
                    {o.l}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {form.authType === "fortitoken-cloud" ? (
          <div className="flex items-start gap-2 rounded border border-sky-200 bg-sky-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-sky-800 dark:border-sky-400/20 dark:bg-sky-400/8 dark:text-sky-300">
            <FiInfo size={13} className="mt-0.5 shrink-0" />
            <span>
              FortiToken Cloud offers scalable and centrally-managed two factor authentication.
              A <a href="https://www.fortinet.com/products/fortitoken" target="_blank" rel="noopener noreferrer" className="underline">trial subscription</a> is
              available free of charge.
              <br />
              <b>This FortiGate has no FortiToken Cloud subscription</b> — saving will return
              <code className="mx-1 rounded bg-sky-100 px-1 dark:bg-sky-400/15">-7706</code>
              until one is activated. Use <b>FortiToken</b> for a token that already exists on the device.
            </span>
          </div>
        ) : (
          <div className={rowCls}>
            <label htmlFor="token" className={labelCls}>Token</label>
            <div className="flex-1">
              <MinimalSelect id="token" value={form.fortitoken} ariaLabel="Token"
                className="w-full max-w-85"
                onChange={(v) => set("fortitoken", v)}
                options={[
                  { value: "", label: "" },
                  ...options.fortitokens.map((t) => ({ value: t, label: t })),
                ]} />
              {errText(errors.fortitoken)}
              {!loadingOptions && options.fortitokens.length === 0 && (
                <p className="mt-1 text-[11px] ink-3">
                  No FortiTokens on this device — add one under User &amp; Authentication &gt; FortiTokens first.
                </p>
              )}
            </div>
          </div>
        )}

        <div className={rowCls}>
          <label htmlFor="email-address" className={labelCls}>Email Address</label>
          <div className="flex-1">
            <input id="email-address" type="email" value={form.emailTo} onChange={(e) => set("emailTo", e.target.value)}
              className={`${inputCls} w-full max-w-85 ${errors.emailTo ? "border-red-400" : ""}`}
              // 2FA needs a delivery channel: an email OR SMS. With SMS off this is the only one,
              // so mark it required — the device answers -7524 when both are missing.
              style={form.smsEnabled ? undefined : requiredBg(!!form.emailTo)}
              {...focusRing(currentColor)} />
            {errText(errors.emailTo)}
          </div>
        </div>

        <div role="group" aria-labelledby="sms-label" className={rowCls}>
          <span id="sms-label" className={labelCls}>SMS</span>
          <Toggle label="Send the code by SMS" checked={form.smsEnabled} onChange={(v) => set("smsEnabled", v)} color={currentColor} />
        </div>

        {form.smsEnabled && (
          <>
            <div className={rowCls}>
              <label htmlFor="country-dial-code" className={labelCls}>Country Dial Code</label>
              <div className="flex-1">
                <MinimalSelect id="country-dial-code" value={form.smsCountryCode} ariaLabel="Country Dial Code"
                  className="w-full max-w-85"
                  onChange={(v) => set("smsCountryCode", v)}
                  options={[
                    { value: "", label: "" },
                    ...COUNTRY_DIAL_CODES.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })),
                  ]} />
                {errText(errors.smsCountryCode)}
              </div>
            </div>
            <div className={rowCls}>
              <label htmlFor="phone-number" className={labelCls}>Phone Number</label>
              <div className="flex-1">
                <input id="phone-number" value={form.smsPhone} onChange={(e) => set("smsPhone", e.target.value)}
                  placeholder="(__) __-______"
                  className={`${inputCls} w-full max-w-85 ${errors.smsPhone ? "border-red-500" : ""}`}
                  style={requiredBg(!!form.smsPhone)} {...focusRing(currentColor)} />
                {errText(errors.smsPhone)}
              </div>
            </div>
          </>
        )}
      </div>
    )}
  </div>
);

export const ExtraInfoStep: React.FC<LocalUserFieldsProps> = ({
  form, set, errors, options, loadingOptions, currentColor,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const toggleGroup = (g: string) =>
    set("groups", form.groups.includes(g) ? form.groups.filter((x) => x !== g) : [...form.groups, g]);

  return (
    <div className="space-y-3 px-5 py-4">
      <div role="group" aria-labelledby="user-account-status-label" className={rowCls}>
        <span id="user-account-status-label" className={labelCls}>User Account Status</span>
        <Segmented label="User Account Status" value={form.status ? "enabled" : "disabled"} onChange={(v) => set("status", v === "enabled")}
          currentColor={currentColor}
          options={[
            { v: "enabled", l: "Enabled", icon: <FiArrowUp size={12} /> },
            { v: "disabled", l: "Disabled", icon: <FiArrowDown size={12} />, danger: true },
          ]} />
      </div>

      <div role="group" aria-labelledby="user-group-label" className={rowCls}>
        <span id="user-group-label" className={labelCls}>User Group</span>
        <div className="flex flex-1 items-start gap-3">
          <Toggle label="Add to a user group" checked={form.groupEnabled}
            onChange={(v) => { set("groupEnabled", v); if (!v) set("groups", []); }}
            color={currentColor} />
          {form.groupEnabled && (
            <div className="relative min-w-0 flex-1 max-w-85">
              <div className="flex min-h-8 w-full flex-wrap items-center gap-1.5 rounded border hairline surface-card px-2 py-1"
                style={requiredBg(form.groups.length > 0)}>
                {form.groups.map((g) => (
                  <span key={g} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium"
                    style={{ background: `${currentColor}14`, color: currentColor }}>
                    <FiUsers size={10} /> {g}
                    <button type="button" onClick={() => toggleGroup(g)} className="opacity-60 hover:opacity-100">
                      <FiX size={11} />
                    </button>
                  </span>
                ))}
                <button type="button" onClick={() => setPickerOpen((o) => !o)}
                  className="flex flex-1 items-center justify-center gap-1 rounded py-0.5 text-[12px] font-semibold ink-2 transition surface-hover">
                  <FiPlus size={13} />
                </button>
              </div>
              <GroupPicker open={pickerOpen} onClose={() => setPickerOpen(false)}
                candidates={options.groups} selected={form.groups} onToggle={toggleGroup}
                currentColor={currentColor} loading={loadingOptions} />
              {errText(errors.groups)}
              {!loadingOptions && options.groups.length === 0 && (
                <p className="mt-1 text-[11px] ink-3">
                  No Firewall/FSSO groups on this device — guest and RSSO groups can't take members.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// The step components in wizard order, so the create page can index into them.
