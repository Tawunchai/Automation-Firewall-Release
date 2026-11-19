import React, { useEffect, useMemo, useRef, useState } from "react";
import { FiPlus, FiSearch, FiX, FiUser, FiInfo } from "react-icons/fi";
import {
  type MemberOption, type UserGroupOptions, type UserGroupMatch,
} from "../../api/policyObject";
import { labelCls, inputCls, rowCls, sectionHdr, Toggle } from "../fw-addresses/address-form";
import { Segmented } from "../../components/ui/form-controls";
import { focusRing } from "../../components/ui/form-controls.logic";
import MinimalSelect from "../../components/ui/MinimalSelect";
// The form state, validation, payload mapping and datasource hook live next door so that this
// module exports components only — see the header of user-group-form.logic.ts.
import {
  type UserGroupFormState, GROUP_TYPE_OPTIONS, takesMembers, takesMatches, remoteServerOptions,
  num, MAX_ACCOUNTS_MAX,
} from "./user-group-form.logic";
// ─── "Select Entries" member picker ────────────────────────────────────────────
// Mirrors the FortiGate dialog's panel: a search box, entries grouped by source table with
// a count per group, and click-to-toggle selection.
const MemberPicker: React.FC<{
  open: boolean; onClose: () => void;
  candidates: MemberOption[]; selected: string[];
  onToggle: (name: string) => void; currentColor: string; loading: boolean;
}> = ({ open, onClose, candidates, selected, onToggle, currentColor, loading }) => {
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    // Defer so the click that opened the panel doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); };
  }, [open, onClose]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hits = candidates.filter((c) => !q || c.name.toLowerCase().includes(q));
    const by = new Map<string, MemberOption[]>();
    for (const h of hits) by.set(h.source, [...(by.get(h.source) ?? []), h]);
    return Array.from(by.entries());
  }, [candidates, search]);

  if (!open) return null;
  const total = groups.reduce((n, [, list]) => n + list.length, 0);

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
        ) : total === 0 ? (
          <p className="py-6 text-center text-[12px] italic ink-3">No entries</p>
        ) : (
          groups.map(([source, list]) => (
            <div key={source}>
              <div className="surface-sunken px-3 py-1 text-[10px] font-bold uppercase tracking-wide ink-3">
                {source} ({list.length})
              </div>
              {list.map((m) => {
                const on = selected.includes(m.name);
                return (
                  <button key={`${source}:${m.name}`} type="button" onClick={() => onToggle(m.name)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors surface-hover"
                    style={on ? { background: `${currentColor}12` } : undefined}>
                    <FiUser size={12} className="shrink-0 ink-3" />
                    <span className="flex-1 truncate ink">{m.name}</span>
                    {on && <span className="text-[10px] font-bold" style={{ color: currentColor }}>✓</span>}
                  </button>
                );
              })}
            </div>
          ))
        )}
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

// ─── Fields ────────────────────────────────────────────────────────────────────
export type UserGroupFieldsProps = {
  form: UserGroupFormState;
  set: <K extends keyof UserGroupFormState>(k: K, v: UserGroupFormState[K]) => void;
  errors: Record<string, string>;
  options: UserGroupOptions;
  loadingOptions: boolean;
  currentColor: string;
  isEdit?: boolean;
};

export const UserGroupFields: React.FC<UserGroupFieldsProps> = ({
  form, set, errors, options, loadingOptions, currentColor, isEdit,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);

  const candidates = form.groupType === "fsso-service" ? options.fsso : options.firewall;

  const toggleMember = (name: string) =>
    set("members", form.members.includes(name)
      ? form.members.filter((m) => m !== name)
      : [...form.members, name]);

  // Only the remote auth servers can appear in a match row — a local user or a PKI peer has no
  // group directory to match against.
  const remoteServers = useMemo(() => remoteServerOptions(options), [options]);

  // Replacing one row keeps the array positional, which is what the device's `id` key expects.
  const setMatch = (i: number, row: UserGroupMatch) =>
    set("matches", form.matches.map((m, j) => (j === i ? row : m)));

  const err = (k: string) => errors[k] && <p className="mt-1 text-[11px] text-red-500">{errors[k]}</p>;
  const numInput = (k: keyof UserGroupFormState, label: string) => (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] ink-2">{label}</span>
      <input type="number" min={0} value={String(form[k])} onChange={(e) => set(k, e.target.value as never)}
        className={`${inputCls} w-17.5 flex-none`} {...focusRing(currentColor)} />
    </div>
  );

  return (
    <div>
      <div className="space-y-3 px-5 py-4">
        {/* Name */}
        <div className={rowCls}>
          <label htmlFor="name" className={labelCls}>Name</label>
          <div className="flex-1">
            <input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={35}
              className={`${inputCls} w-full ${errors.name ? "border-red-400" : ""}`}
              style={{ backgroundColor: form.name ? undefined : "#fffbe6" }}
              {...focusRing(currentColor)} />
            {err("name")}
          </div>
        </div>

        {/* Type — a 4-row list box, like the FortiGate dialog */}
        <div role="group" aria-labelledby="type-label" className={rowCls}>
          <span id="type-label" className={labelCls}>Type</span>
          <div className="flex-1">
            <div className="w-fit min-w-55 overflow-hidden rounded border hairline">
              {GROUP_TYPE_OPTIONS.map((o, i) => {
                const active = form.groupType === o.v;
                return (
                  <button key={o.v} type="button" onClick={() => set("groupType", o.v)}
                    className={`block w-full px-3 py-1.5 text-left text-[12.5px] transition-colors ${i > 0 ? "border-t hairline" : ""} ${active ? "font-semibold text-white" : "ink surface-hover"}`}
                    style={active ? { background: currentColor } : undefined}>
                    {o.l}
                  </button>
                );
              })}
            </div>
            {isEdit && (
              <p className="mt-1.5 flex items-start gap-1 text-[11px] ink-3">
                <FiInfo size={11} className="mt-0.5 shrink-0" />
                Changing the type clears the settings that don't apply to the new type (members are dropped).
              </p>
            )}
          </div>
        </div>

        {/* Members — Firewall + FSSO only */}
        {takesMembers(form.groupType) && (
          <div role="group" aria-labelledby="members-label" className={rowCls}>
            <span id="members-label" className={labelCls}>Members</span>
            <div className="relative flex-1">
              <div className="flex min-h-8 w-full flex-wrap items-center gap-1.5 rounded border hairline surface-card px-2 py-1">
                {form.members.map((m) => (
                  <span key={m} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium"
                    style={{ background: `${currentColor}14`, color: currentColor }}>
                    <FiUser size={10} /> {m}
                    <button type="button" onClick={() => toggleMember(m)} className="opacity-60 hover:opacity-100">
                      <FiX size={11} />
                    </button>
                  </span>
                ))}
                <button type="button" onClick={() => setPickerOpen((o) => !o)}
                  className="flex flex-1 items-center justify-center gap-1 rounded py-0.5 text-[12px] font-semibold ink-2 transition surface-hover">
                  <FiPlus size={13} />
                </button>
              </div>
              <MemberPicker
                open={pickerOpen} onClose={() => setPickerOpen(false)}
                candidates={candidates} selected={form.members} onToggle={toggleMember}
                currentColor={currentColor} loading={loadingOptions}
              />
              {form.groupType === "fsso-service" && !loadingOptions && options.fsso.length === 0 && (
                <p className="mt-1 text-[11px] ink-3">
                  No FSSO groups on this device — configure an FSSO agent first (User &amp; Authentication &gt; Single Sign-On).
                </p>
              )}
            </div>
          </div>
        )}

        {/* Remote Groups — the user/group `match` table. Firewall groups only. */}
        {takesMatches(form.groupType) && (
          <div role="group" aria-labelledby="remote-groups-label" className={rowCls}>
            <span id="remote-groups-label" className={labelCls}>
              Remote Groups <FiInfo size={11} className="ml-0.5 inline ink-3" />
            </span>
            <div className="flex-1 space-y-2">
              {form.matches.length > 0 && (
                <div className="overflow-hidden rounded border hairline">
                  {form.matches.map((m, i) => (
                    <div key={i}
                      className={`flex flex-wrap items-start gap-2 p-2 ${i > 0 ? "border-t hairline" : ""}`}>
                      <div>
                        {/* server-name is a datasource spanning user.ldap / radius / tacacs+ / saml
                            — a free-typed name comes back from the device as "-3". */}
                        <MinimalSelect value={m.server_name} ariaLabel="Remote server"
                          className="w-47.5 flex-none"
                          onChange={(v) => setMatch(i, { ...m, server_name: v })}
                          options={[
                            { value: "", label: "— remote server —" },
                            ...remoteServers.map((s) => ({ value: s.name, label: `${s.name} (${s.source})` })),
                          ]} />
                        {err(`match.${i}.server`)}
                      </div>
                      <div className="min-w-55 flex-1">
                        <input value={m.group_name}
                          onChange={(e) => setMatch(i, { ...m, group_name: e.target.value })}
                          maxLength={511} placeholder="CN=VPN-Users,OU=Groups,DC=corp,DC=local"
                          className={`${inputCls} w-full ${errors[`match.${i}.group`] ? "border-red-400" : ""}`}
                          {...focusRing(currentColor)} />
                        {err(`match.${i}.group`)}
                      </div>
                      <button type="button" onClick={() => set("matches", form.matches.filter((_, j) => j !== i))}
                        className="mt-1 shrink-0 ink-3 transition hover:text-red-500" title="Remove">
                        <FiX size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button type="button"
                onClick={() => set("matches", [...form.matches, { server_name: remoteServers[0]?.name ?? "", group_name: "" }])}
                disabled={remoteServers.length === 0}
                className="flex w-fit items-center gap-1 rounded border hairline px-2.5 py-1 text-[12px] font-semibold ink-2 transition surface-hover disabled:cursor-not-allowed disabled:opacity-50">
                <FiPlus size={12} /> Add Remote Group
              </button>

              {remoteServers.length === 0 ? (
                <p className="text-[11px] ink-3">
                  No remote authentication servers on this device — add one under
                  User &amp; Authentication &gt; LDAP Servers or RADIUS Servers first.
                </p>
              ) : (
                <p className="flex items-start gap-1 text-[11px] ink-3">
                  <FiInfo size={11} className="mt-0.5 shrink-0" />
                  Each remote server used here is added to Members automatically — the FortiGate
                  rejects the whole group otherwise (error -518).
                </p>
              )}
            </div>
          </div>
        )}

        {/* RSSO */}
        {form.groupType === "rsso" && (
          <div className={rowCls}>
            <label htmlFor="radius-attribute-value" className={labelCls}>
              RADIUS Attribute Value <FiInfo size={11} className="ml-0.5 inline ink-3" />
            </label>
            <div className="flex-1">
              <input id="radius-attribute-value" value={form.ssoAttributeValue} onChange={(e) => set("ssoAttributeValue", e.target.value)}
                maxLength={511} placeholder="Name of the RADIUS user group this group represents"
                className={`${inputCls} w-full ${errors.ssoAttributeValue ? "border-red-400" : ""}`}
                {...focusRing(currentColor)} />
              {err("ssoAttributeValue")}
            </div>
          </div>
        )}

        {/* Guest — top block */}
        {form.groupType === "guest" && (
          <>
            <div role="group" aria-labelledby="batch-guest-account-creation-label" className={rowCls}>
              <span id="batch-guest-account-creation-label" className={labelCls}>Batch Guest Account Creation</span>
              <Toggle label="Batch guest account creation" checked={form.multipleGuestAdd} onChange={(v) => set("multipleGuestAdd", v)} color={currentColor} />
            </div>

            {form.multipleGuestAdd ? (
              // Faithful to the device: with batch on, FortiOS forces auto-generated IDs and
              // passwords and ignores the Guest Details block entirely.
              <div className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/8 dark:text-amber-400">
                <FiInfo size={12} className="mt-0.5 shrink-0" />
                <span>
                  Batch creation generates accounts automatically: the FortiGate forces
                  <b> User ID</b> and <b>Password</b> to <i>Auto Generated</i> and ignores the Guest Details
                  below. Expiration and Maximum Accounts still apply.
                </span>
              </div>
            ) : (
              <div role="group" aria-labelledby="user-id-label" className={rowCls}>
                <span id="user-id-label" className={labelCls}>User ID</span>
                <Segmented label="User ID" value={form.userId} onChange={(v) => set("userId", v as UserGroupFormState["userId"])}
                  currentColor={currentColor}
                  options={[
                    { v: "email", l: "Email" },
                    { v: "auto-generate", l: "Auto Generated" },
                    { v: "specify", l: "Specify" },
                  ]} />
              </div>
            )}

            <div className={rowCls}>
              <label htmlFor="maximum-accounts" className={labelCls}>Maximum Accounts</label>
              <div className="flex flex-1 items-center gap-3">
                <Toggle label="Limit the number of accounts" checked={form.maxAccountsEnabled}
                  onChange={(v) => { set("maxAccountsEnabled", v); if (v && num(form.maxAccounts) < 1) set("maxAccounts", "10"); }}
                  color={currentColor} />
                {form.maxAccountsEnabled && (
                  <div>
                    <input id="maximum-accounts" type="number" min={1} max={MAX_ACCOUNTS_MAX} value={form.maxAccounts}
                      onChange={(e) => set("maxAccounts", e.target.value)}
                      className={`${inputCls} w-22.5 flex-none ${errors.maxAccounts ? "border-red-400" : ""}`}
                      {...focusRing(currentColor)} />
                    {err("maxAccounts")}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Guest Details — hidden under batch mode, exactly like the device's behaviour */}
      {form.groupType === "guest" && !form.multipleGuestAdd && (
        <>
          <div className={sectionHdr}>Guest Details</div>
          <div className="space-y-3 px-5 py-4">
            <div role="group" aria-labelledby="enable-name-label" className={rowCls}>
              <span id="enable-name-label" className={labelCls}>Enable Name</span>
              <Toggle label="Ask for a name" checked={form.userName} onChange={(v) => set("userName", v)} color={currentColor} />
            </div>
            <div role="group" aria-labelledby="enable-email-label" className={rowCls}>
              <span id="enable-email-label" className={labelCls}>Enable Email</span>
              <Toggle label="Ask for an email address" checked={form.email} onChange={(v) => set("email", v)} color={currentColor} />
            </div>
            <div role="group" aria-labelledby="enable-sms-label" className={rowCls}>
              <span id="enable-sms-label" className={labelCls}>Enable SMS</span>
              <Toggle label="Ask for a mobile number" checked={form.mobilePhone} onChange={(v) => set("mobilePhone", v)} color={currentColor} />
            </div>

            {form.mobilePhone && (
              <div className={rowCls}>
                <label htmlFor="sms-server" className={labelCls}>SMS Server</label>
                <div className="flex-1 space-y-2">
                  <Segmented label="SMS Server" value={form.smsServer} onChange={(v) => set("smsServer", v as UserGroupFormState["smsServer"])}
                    currentColor={currentColor}
                    options={[{ v: "fortiguard", l: "FortiGuard" }, { v: "custom", l: "Custom" }]} />
                  {form.smsServer === "custom" && (
                    <div>
                      {/* sms-custom-server is a datasource (system.sms-server) — a free-typed name
                          comes back from the device as "-3 entry not found in datasource". */}
                      <MinimalSelect id="sms-server" value={form.smsCustomServer} ariaLabel="SMS server"
                        className="w-full max-w-65"
                        onChange={(v) => set("smsCustomServer", v)}
                        options={[
                          { value: "", label: "— select an SMS server —" },
                          ...options.sms_servers.map((s) => ({ value: s, label: s })),
                        ]} />
                      {options.sms_servers.length === 0 && (
                        <p className="mt-1 text-[11px] ink-3">
                          No custom SMS servers on this device — add one under System &gt; SMS Server, or use FortiGuard.
                        </p>
                      )}
                      {err("smsCustomServer")}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div role="group" aria-labelledby="password-label" className={rowCls}>
              <span id="password-label" className={labelCls}>Password</span>
              <div className="flex flex-1 items-center gap-3">
                <Toggle label="Ask for a password" checked={form.passwordEnabled} onChange={(v) => set("passwordEnabled", v)} color={currentColor} />
                {form.passwordEnabled && (
                  <Segmented label="Ask for a password" value={form.password} onChange={(v) => set("password", v as UserGroupFormState["password"])}
                    currentColor={currentColor}
                    options={[{ v: "auto-generate", l: "Auto Generated" }, { v: "specify", l: "Specify" }]} />
                )}
              </div>
            </div>

            <div role="group" aria-labelledby="sponsor-label" className={rowCls}>
              <span id="sponsor-label" className={labelCls}>Sponsor</span>
              <div className="flex flex-1 items-center gap-3">
                <Toggle label="Ask for a sponsor" checked={form.sponsorEnabled} onChange={(v) => set("sponsorEnabled", v)} color={currentColor} />
                {form.sponsorEnabled && (
                  <Segmented label="Ask for a sponsor" value={form.sponsor} onChange={(v) => set("sponsor", v as UserGroupFormState["sponsor"])}
                    currentColor={currentColor}
                    options={[{ v: "optional", l: "Optional" }, { v: "mandatory", l: "Required" }]} />
                )}
              </div>
            </div>

            <div role="group" aria-labelledby="company-label" className={rowCls}>
              <span id="company-label" className={labelCls}>Company</span>
              <div className="flex flex-1 items-center gap-3">
                <Toggle label="Ask for a company" checked={form.companyEnabled} onChange={(v) => set("companyEnabled", v)} color={currentColor} />
                {form.companyEnabled && (
                  <Segmented label="Ask for a company" value={form.company} onChange={(v) => set("company", v as UserGroupFormState["company"])}
                    currentColor={currentColor}
                    options={[{ v: "optional", l: "Optional" }, { v: "mandatory", l: "Required" }]} />
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Expiration — applies in batch mode too */}
      {form.groupType === "guest" && (
        <>
          <div className={sectionHdr}>Expiration</div>
          <div className="space-y-3 px-5 py-4">
            <div role="group" aria-labelledby="start-countdown-label" className={rowCls}>
              <span id="start-countdown-label" className={labelCls}>Start Countdown</span>
              <Segmented label="Start Countdown" value={form.expireType} onChange={(v) => set("expireType", v as UserGroupFormState["expireType"])}
                currentColor={currentColor}
                options={[
                  { v: "immediately", l: "On Account Creation" },
                  { v: "first-successful-login", l: "After First Login" },
                ]} />
            </div>
            <div role="group" aria-labelledby="time-label" className={rowCls}>
              <span id="time-label" className={labelCls}>Time</span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  {numInput("expireDays", "Days")}
                  {numInput("expireHours", "Hours")}
                  {numInput("expireMinutes", "Minutes")}
                  {numInput("expireSeconds", "Seconds")}
                </div>
                {err("expire")}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
