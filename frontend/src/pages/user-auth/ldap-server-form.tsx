import React, { useEffect, useRef, useState } from "react";
import { FiSearch, FiPlus, FiEye, FiEyeOff, FiInfo, FiChevronDown } from "react-icons/fi";
import { type LDAPServerOptions, type LDAPBindType, type LDAPProtocol } from "../../api/policyObject";
import { labelCls, inputCls, rowCls, Toggle } from "../fw-addresses/address-form";
import { Segmented } from "../../components/ui/form-controls";
import { focusRing } from "../../components/ui/form-controls.logic";
import { BIND_TYPE_OPTIONS, CNID_MAX, DN_MAX, NAME_MAX, SERVER_MAX, USERNAME_MAX, bindTakesCredentials, portForProtocol } from "./ldap-server-form.logic";
import type { LDAPServerFormState } from "./ldap-server-form.logic";

// Form state for the FortiGate "Edit LDAP Server" dialog (User & Authentication > LDAP Servers).
// One flat shape; buildLDAPServerPayload emits only what the chosen toggles actually use.
//
// Field ↔ CMDB map lives in services/fortigate_authserver.go — the short version:
//   exchangeEnabled     → obtain-user-info + user-info-exchange-server
//   bindType            → type          (username/password only for "regular")
//   secureEnabled       → secure        ("disable" when off)
//   protocol            → secure        (starttls | ldaps)
//   certEnabled         → ca-cert       ("Certificate" is really "is a CA cert selected?")
//   serverIdentityCheck → server-identity-check
// FortiOS default ports; the GUI flips between them when Protocol changes.
// Defaults mirror the dialog's initial state in the screenshots: port 389, cnid "cn",
// Bind Type = Simple, every toggle off. server-identity-check defaults to enable in the CMDB
// schema, which is what the GUI pre-selects once you turn Certificate on.
// Only a Regular bind carries credentials — the dialog hides Username/Password for the other
// two, and FortiOS ignores them there.
// portForProtocol is the GUI's convenience behaviour: switching Protocol moves the port to the
// matching default, but ONLY when the current value is still the other default. A port the user
// typed themselves (1389, 3268, …) is never overwritten.
// FortiOS field sizes, from user/ldap?action=schema.
// buildLDAPServerPayload sends every gated field in BOTH states rather than omitting it when a
// toggle is off — the backend needs that to CLEAR a setting on edit (and obtain-user-info
// defaults to enable on the device, so "off" has to be said out loud).
// ─── Datasource hook ───────────────────────────────────────────────────────────
// ─── Searchable dropdown ───────────────────────────────────────────────────────
// The FortiGate datasource control: a closed box that opens into a search field, an optional
// "+ Create" action, and the entry list (or "No entries" in italics, as in the screenshots).
export const SearchSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  entries: { value: string; label: string; hint?: string }[];
  placeholder?: string;
  currentColor: string;
  loading?: boolean;
  invalid?: boolean;
  onCreate?: () => void;
  createLabel?: string;
  width?: string;
}> = ({ value, onChange, entries, placeholder = "", currentColor, loading, invalid, onCreate, createLabel = "Create", width = "270px" }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); };
  }, [open]);

  const q = search.trim().toLowerCase();
  const hits = entries.filter((e) => !q || e.label.toLowerCase().includes(q));

  return (
    <div className="relative" style={{ width }} ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={`flex h-8 w-full items-center justify-between rounded border surface-card px-2.5 text-left text-[13px] transition ${invalid ? "border-red-400" : "hairline"}`}>
        <span className={value ? "truncate ink" : "truncate ink-3"}>
          {value || placeholder}
        </span>
        <FiChevronDown size={13} className="shrink-0 ink-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-full overflow-hidden rounded border hairline surface-card shadow-lg">
          <div className="flex items-center gap-2 border-b hairline p-2">
            <div className="relative flex-1">
              <FiSearch size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ink-3" />
              {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the popover has just opened on a click and its only job is to be filtered, so focus belongs in the search box -- the same place a native combobox puts it */}
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
                className={`${inputCls} w-full pl-7`} {...focusRing(currentColor)} />
            </div>
            {onCreate && (
              <button type="button" onClick={() => { setOpen(false); onCreate(); }}
                className="flex h-8 shrink-0 items-center gap-1 rounded px-2.5 text-[12px] font-semibold text-white transition"
                style={{ background: currentColor }}>
                <FiPlus size={12} /> {createLabel}
              </button>
            )}
          </div>

          <div className="max-h-55 overflow-y-auto py-1">
            {loading ? (
              <p className="py-5 text-center text-[12px] ink-3">Loading…</p>
            ) : hits.length === 0 ? (
              <p className="py-5 text-center text-[12px] italic ink-3">No entries</p>
            ) : (
              hits.map((e) => (
                <button key={e.value} type="button"
                  onClick={() => { onChange(e.value); setOpen(false); setSearch(""); }}
                  className="flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors surface-hover"
                  style={value === e.value ? { background: `${currentColor}12` } : undefined}>
                  <span className="text-[12.5px] ink">{e.label}</span>
                  {e.hint && <span className="text-[10.5px] ink-3">{e.hint}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Password input with the GUI's reveal eye ──────────────────────────────────
export const PasswordInput: React.FC<{
  value: string; onChange: (v: string) => void; currentColor: string;
  invalid?: boolean; placeholder?: string; width?: string;
}> = ({ value, onChange, currentColor, invalid, placeholder, width = "270px" }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative" style={{ width }}>
      <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} autoComplete="new-password"
        className={`${inputCls} w-full pr-8 ${invalid ? "border-red-400" : ""}`}
        style={{ backgroundColor: value ? undefined : "#fffbe6" }}
        {...focusRing(currentColor)} />
      <button type="button" onClick={() => setShow((s) => !s)} tabIndex={-1}
        className="absolute right-2 top-1/2 -translate-y-1/2 ink-3 transition hover-ink">
        {show ? <FiEyeOff size={13} /> : <FiEye size={13} />}
      </button>
    </div>
  );
};

// A control the firmware can't back — rendered so the layout matches the FortiGate dialog, but
// disabled with the reason, instead of a button that silently does nothing.
const UnsupportedButton: React.FC<{ label: string; reason: string }> = ({ label, reason }) => (
  <button type="button" disabled title={reason}
    className="w-fit cursor-not-allowed rounded border hairline px-3 py-1.5 text-[12px] font-semibold ink-3">
    {label}
  </button>
);

const NO_LDAP_TEST_REASON =
  "FortiOS 7.2.10 has no LDAP test endpoint — monitor/user/ldap/query, /test-connect and " +
  "/test-user-credentials all return 404 on this device.";

// ─── Fields ────────────────────────────────────────────────────────────────────
export type LDAPServerFieldsProps = {
  form: LDAPServerFormState;
  set: <K extends keyof LDAPServerFormState>(k: K, v: LDAPServerFormState[K]) => void;
  errors: Record<string, string>;
  options: LDAPServerOptions;
  loadingOptions: boolean;
  currentColor: string;
  onCreateExchange: () => void;
  isEdit?: boolean;
};

export const LDAPServerFields: React.FC<LDAPServerFieldsProps> = ({
  form, set, errors, options, loadingOptions, currentColor, onCreateExchange, isEdit,
}) => {
  const err = (k: string) => errors[k] && <p className="mt-1 text-[11px] text-red-500">{errors[k]}</p>;

  // The FortiGate dialog tints a required-but-empty field pale yellow.
  const required = (v: string) => (v.trim() ? undefined : { backgroundColor: "#fffbe6" });

  return (
    <div className="space-y-3 px-5 py-4">
      {/* Name */}
      <div className={rowCls}>
        <label htmlFor="name" className={labelCls}>Name</label>
        <div className="flex-1">
          <input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={NAME_MAX}
            className={`${inputCls} w-full max-w-67.5 ${errors.name ? "border-red-400" : ""}`}
            style={required(form.name)} {...focusRing(currentColor)} />
          {err("name")}
        </div>
      </div>

      {/* Server IP/Name */}
      <div className={rowCls}>
        <label htmlFor="server-ip-name" className={labelCls}>Server IP/Name</label>
        <div className="flex-1">
          <input id="server-ip-name" value={form.server} onChange={(e) => set("server", e.target.value)} maxLength={SERVER_MAX}
            className={`${inputCls} w-full max-w-67.5 ${errors.server ? "border-red-400" : ""}`}
            style={required(form.server)} {...focusRing(currentColor)} />
          {err("server")}
        </div>
      </div>

      {/* Server Port */}
      <div className={rowCls}>
        <label htmlFor="server-port" className={labelCls}>Server Port</label>
        <div className="flex-1">
          <input id="server-port" type="number" min={1} max={65535} value={form.port}
            onChange={(e) => set("port", e.target.value)}
            className={`${inputCls} w-full max-w-67.5 ${errors.port ? "border-red-400" : ""}`}
            {...focusRing(currentColor)} />
          {err("port")}
        </div>
      </div>

      {/* Common Name Identifier */}
      <div className={rowCls}>
        <label htmlFor="common-name-identifier" className={labelCls}>Common Name Identifier</label>
        <div className="flex-1">
          <input id="common-name-identifier" value={form.cnid} onChange={(e) => set("cnid", e.target.value)} maxLength={CNID_MAX}
            className={`${inputCls} w-full max-w-67.5 ${errors.cnid ? "border-red-400" : ""}`}
            {...focusRing(currentColor)} />
          {err("cnid")}
        </div>
      </div>

      {/* Distinguished Name + Browse */}
      <div className={rowCls}>
        <label htmlFor="distinguished-name" className={labelCls}>Distinguished Name</label>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <input id="distinguished-name" value={form.dn} onChange={(e) => set("dn", e.target.value)} maxLength={DN_MAX}
              placeholder="dc=example,dc=com"
              className={`${inputCls} w-full max-w-67.5 flex-none ${errors.dn ? "border-red-400" : ""}`}
              {...focusRing(currentColor)} />
            {/* The GUI's LDAP tree browser needs monitor/user/ldap/query, which 7.2.10 lacks. */}
            <UnsupportedButton label="Browse" reason={NO_LDAP_TEST_REASON} />
          </div>
          {err("dn")}
        </div>
      </div>

      {/* Exchange server → obtain-user-info + user-info-exchange-server */}
      <div role="group" aria-labelledby="exchange-server-label" className={rowCls}>
        <span id="exchange-server-label" className={labelCls}>Exchange server</span>
        <div className="flex flex-1 items-start gap-3">
          <div className="pt-1">
            <Toggle label="Use an Exchange server" checked={form.exchangeEnabled} onChange={(v) => set("exchangeEnabled", v)} color={currentColor} />
          </div>
          {form.exchangeEnabled && (
            <div>
              <SearchSelect
                value={form.exchangeServer} onChange={(v) => set("exchangeServer", v)}
                entries={options.exchange_servers.map((e) => ({
                  value: e.name, label: e.name,
                  hint: [e.username, e.server_name].filter(Boolean).join("@") || undefined,
                }))}
                currentColor={currentColor} loading={loadingOptions}
                invalid={!!errors.exchangeServer}
                onCreate={onCreateExchange} createLabel="Create"
              />
              {err("exchangeServer")}
            </div>
          )}
        </div>
      </div>

      {/* Bind Type */}
      <div role="group" aria-labelledby="bind-type-label" className={rowCls}>
        <span id="bind-type-label" className={labelCls}>Bind Type</span>
        <Segmented label="Bind Type" value={form.bindType} onChange={(v) => set("bindType", v as LDAPBindType)}
          currentColor={currentColor} options={BIND_TYPE_OPTIONS.map((o) => ({ v: o.v, l: o.l }))} />
      </div>

      {/* Regular bind credentials */}
      {bindTakesCredentials(form.bindType) && (
        <>
          <div className={rowCls}>
            <label htmlFor="username" className={labelCls}>Username</label>
            <div className="flex-1">
              <input id="username" value={form.username} onChange={(e) => set("username", e.target.value)} maxLength={USERNAME_MAX}
                placeholder="cn=admin,dc=example,dc=com"
                className={`${inputCls} w-full max-w-67.5 ${errors.username ? "border-red-400" : ""}`}
                style={required(form.username)} {...focusRing(currentColor)} />
              {err("username")}
            </div>
          </div>
          <div role="group" aria-labelledby="password-label" className={rowCls}>
            <span id="password-label" className={labelCls}>Password</span>
            <div className="flex-1">
              <PasswordInput value={form.password} onChange={(v) => set("password", v)}
                currentColor={currentColor} invalid={!!errors.password}
                placeholder={isEdit ? "unchanged" : ""} />
              {isEdit && !errors.password && (
                <p className="mt-1 flex items-start gap-1 text-[11px] ink-3">
                  <FiInfo size={11} className="mt-0.5 shrink-0" />
                  Leave blank to keep the stored password — the FortiGate never returns it.
                </p>
              )}
              {err("password")}
            </div>
          </div>
        </>
      )}

      {/* Secure Connection */}
      <div role="group" aria-labelledby="secure-connection-label" className={rowCls}>
        <span id="secure-connection-label" className={labelCls}>Secure Connection</span>
        <div className="pt-1">
          <Toggle label="Secure connection" checked={form.secureEnabled} onChange={(v) => set("secureEnabled", v)} color={currentColor} />
        </div>
      </div>

      {form.secureEnabled && (
        <>
          <div role="group" aria-labelledby="protocol-label" className={rowCls}>
            <span id="protocol-label" className={labelCls}>Protocol</span>
            {/* Switching protocol moves the port to the matching default, exactly like the GUI. */}
            <Segmented label="Protocol" value={form.protocol}
              onChange={(v) => {
                const next = v as LDAPProtocol;
                set("protocol", next);
                set("port", portForProtocol(form.port, next));
              }}
              currentColor={currentColor}
              options={[{ v: "starttls", l: "STARTTLS" }, { v: "ldaps", l: "LDAPS" }]} />
          </div>

          <div role="group" aria-labelledby="certificate-label" className={rowCls}>
            <span id="certificate-label" className={labelCls}>Certificate</span>
            <div className="flex flex-1 items-start gap-3">
              <div className="pt-1">
                <Toggle label="Use a certificate" checked={form.certEnabled} onChange={(v) => set("certEnabled", v)} color={currentColor} />
              </div>
              {form.certEnabled && (
                <div>
                  <SearchSelect
                    value={form.caCert} onChange={(v) => set("caCert", v)}
                    entries={options.ca_certs.map((c) => ({ value: c, label: c }))}
                    currentColor={currentColor} loading={loadingOptions}
                    invalid={!!errors.caCert}
                  />
                  {err("caCert")}
                </div>
              )}
            </div>
          </div>

          {/* Server identity check — the GUI only shows it once a certificate is selected. */}
          {form.certEnabled && (
            <div role="group" aria-labelledby="server-identity-check-label" className={rowCls}>
              <span id="server-identity-check-label" className={labelCls}>
                Server identity check <FiInfo size={11} className="ml-0.5 inline ink-3" />
              </span>
              <div className="pt-1">
                <Toggle label="Server identity check" checked={form.serverIdentityCheck}
                  onChange={(v) => set("serverIdentityCheck", v)} color={currentColor} />
              </div>
            </div>
          )}
        </>
      )}

      {/* The dialog's two test buttons. This firmware has no LDAP monitor API — see the tooltip. */}
      <div className="flex flex-col gap-2 pt-1">
        <UnsupportedButton label="Test Connectivity" reason={NO_LDAP_TEST_REASON} />
        <UnsupportedButton label="Test User Credentials" reason={NO_LDAP_TEST_REASON} />
        <p className="flex items-start gap-1 text-[11px] ink-3">
          <FiInfo size={11} className="mt-0.5 shrink-0" />
          FortiOS 7.2.10 exposes no LDAP test endpoint, so these are disabled. RADIUS servers do
          have one — see User &amp; Authentication &gt; RADIUS Servers.
        </p>
      </div>
    </div>
  );
};
