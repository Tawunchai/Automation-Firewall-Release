import React, { useState } from "react";
import { createPortal } from "react-dom";
import { message } from "../../components/ui/toast";
import { FiX, FiInfo, FiCheck, FiServer } from "react-icons/fi";
import { DeviceCreateExchangeConnector } from "../../api/policyObject";
import { labelCls, inputCls, rowCls, sectionHdr, Toggle } from "../fw-addresses/address-form";
import { focusRing } from "../../components/ui/form-controls.logic";
import { PasswordInput } from "./ldap-server-form";
import { BLANK_EXCHANGE_FORM, NAME_MAX, buildExchangeConnectorPayload, splitExchangeAccount, validateExchangeForm } from "./exchange-connector-drawer.logic";
import type { ExchangeConnectorFormState } from "./exchange-connector-drawer.logic";
import { apiErrorDetail } from "../../api/errorText";

// The FortiGate "New External Connector" panel that slides in from the LDAP form's
// "Exchange server" picker → + Create. It writes one user/exchange object.
//
// The GUI collects the account as ONE field shaped "username@server.domain.com" while the CMDB
// keeps three: username, server-name, domain-name. splitExchangeAccount does that split and the
// panel shows what it derived, so nothing is guessed silently.

// splitExchangeAccount turns "svc-fgt@mail.corp.local" into
//   username = "svc-fgt", serverName = "mail.corp.local", domainName = "corp.local".
//
// Splitting on the LAST "@" is deliberate: a UPN-style account can legitimately contain one
// (rare, but the device would store the wrong thing if we took the first). A host with two or
// fewer labels ("corp.local") has no separate parent domain, so serverName is reused rather
// than handing FortiOS a bare TLD.
// Defaults from the screenshots + user/exchange?action=schema: Override off, and the device's
// 0.0.0.0 shown as soon as the override is turned on; Auto-discover KDC defaults to enable.
// ─── Panel ─────────────────────────────────────────────────────────────────────
export const ExchangeConnectorDrawer: React.FC<{
  open: boolean;
  deviceId: number | null;
  currentColor: string;
  onClose: () => void;
  // Fires with the new connector's name so the LDAP form can select it and reload its picker.
  onCreated: (name: string) => void;
}> = ({ open, deviceId, currentColor, onClose, onCreated }) => {
  const [form, setForm] = useState<ExchangeConnectorFormState>(BLANK_EXCHANGE_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ExchangeConnectorFormState>(k: K, v: ExchangeConnectorFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const close = () => {
    setForm(BLANK_EXCHANGE_FORM);
    setErrors({});
    onClose();
  };

  const submit = async () => {
    const errs = validateExchangeForm(form);
    if (Object.keys(errs).length || !deviceId) { setErrors(errs); return; }
    setErrors({});
    try {
      setSaving(true);
      const payload = buildExchangeConnectorPayload(form);
      await DeviceCreateExchangeConnector(deviceId, payload);
      message.success(`Exchange connector "${payload.name}" created`);
      onCreated(payload.name);
      close();
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to create Exchange connector"));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const parts = splitExchangeAccount(form.account);
  const err = (k: string) => errors[k] && <p className="mt-1 text-[11px] text-red-500">{errors[k]}</p>;

  return createPortal(
    <div className="fixed inset-0 z-9999 flex">
      <div role="presentation" className="flex-1 bg-black/30 backdrop-blur-[1px]" onClick={!saving ? close : undefined} />

      <div className="flex h-full w-full max-w-[640px] flex-col surface-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b hairline px-5 py-3">
          <h3 className="text-[14px] font-semibold ink">New External Connector</h3>
          <button type="button" onClick={close} disabled={saving}
            className="ink-3 transition hover-ink disabled:opacity-40">
            <FiX size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Endpoint/Identity — the dialog shows the connector type as a selected tile */}
          <div className={sectionHdr}>Endpoint/Identity</div>
          <div className="flex flex-col items-center gap-2 px-5 py-5">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full"
              style={{ background: `${currentColor}14`, border: `1px solid ${currentColor}35` }}>
              <FiServer size={26} style={{ color: currentColor }} />
              <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full text-white"
                style={{ background: "#16a34a" }}>
                <FiCheck size={12} />
              </span>
            </div>
            <p className="text-center text-[12.5px] font-medium ink-2">
              Exchange<br />Server
            </p>
          </div>

          {/* Connector Settings */}
          <div className={sectionHdr}>Connector Settings</div>
          <div className="space-y-3 px-5 py-4">
            <div className={rowCls}>
              <label htmlFor="name" className={labelCls}>Name</label>
              <div className="flex-1">
                <input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={NAME_MAX}
                  className={`${inputCls} w-full max-w-[280px] ${errors.name ? "border-red-400" : ""}`}
                  style={form.name.trim() ? undefined : { backgroundColor: "#fffbe6" }}
                  {...focusRing(currentColor)} />
                {err("name")}
              </div>
            </div>
          </div>

          {/* Exchange Server Connector */}
          <div className={sectionHdr}>Exchange Server Connector</div>
          <div className="space-y-3 px-5 py-4">
            <div className={rowCls}>
              <label htmlFor="exchange-account" className={labelCls}>
                Exchange account <FiInfo size={11} className="ml-0.5 inline ink-3" />
              </label>
              <div className="flex-1">
                <input id="exchange-account" value={form.account} onChange={(e) => set("account", e.target.value)}
                  placeholder="username@server.domain.com"
                  className={`${inputCls} w-full max-w-[280px] ${errors.account ? "border-red-400" : ""}`}
                  style={form.account.trim() ? undefined : { backgroundColor: "#fffbe6" }}
                  {...focusRing(currentColor)} />
                {err("account")}
                {/* The device stores three fields, not one — show what the split produced. */}
                {parts.username && parts.serverName && (
                  <p className="mt-1 text-[11px] ink-3">
                    Stored as username <b>{parts.username}</b>, server <b>{parts.serverName}</b>,
                    domain <b>{parts.domainName}</b>
                  </p>
                )}
              </div>
            </div>

            <div role="group" aria-labelledby="password-label" className={rowCls}>
              <span id="password-label" className={labelCls}>Password</span>
              <div className="flex-1">
                <PasswordInput value={form.password} onChange={(v) => set("password", v)}
                  currentColor={currentColor} invalid={!!errors.password} width="280px" />
                {err("password")}
              </div>
            </div>

            <div className={rowCls}>
              <label htmlFor="override-server-ip-address" className={labelCls}>
                Override server IP address <FiInfo size={11} className="ml-0.5 inline ink-3" />
              </label>
              <div className="flex flex-1 items-start gap-3">
                <div className="pt-1">
                  <Toggle label="Override server IP address" checked={form.overrideIP} onChange={(v) => set("overrideIP", v)} color={currentColor} />
                </div>
                {form.overrideIP && (
                  <div>
                    <input id="override-server-ip-address" value={form.ip} onChange={(e) => set("ip", e.target.value)}
                      className={`${inputCls} w-[200px] flex-none ${errors.ip ? "border-red-400" : ""}`}
                      {...focusRing(currentColor)} />
                    {err("ip")}
                  </div>
                )}
              </div>
            </div>

            <div role="group" aria-labelledby="auto-discover-kdc-label" className={rowCls}>
              <span id="auto-discover-kdc-label" className={labelCls}>
                Auto-discover KDC <FiInfo size={11} className="ml-0.5 inline ink-3" />
              </span>
              <div className="pt-1">
                <Toggle label="Auto-discover KDC" checked={form.autoDiscoverKDC} onChange={(v) => set("autoDiscoverKDC", v)} color={currentColor} />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-center gap-3 border-t hairline px-5 py-3">
          <button type="button" onClick={submit} disabled={saving || !deviceId}
            className="flex h-9 items-center gap-2 rounded px-8 text-[13px] font-semibold text-white transition disabled:opacity-50"
            style={{ background: currentColor }}>
            {saving && <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
            OK
          </button>
          <button type="button" onClick={close} disabled={saving}
            className="h-9 rounded border hairline px-8 text-[13px] font-semibold ink-2 transition surface-hover disabled:opacity-50">
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
