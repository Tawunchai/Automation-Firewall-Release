import React, { useState } from "react";
import { FiChevronDown, FiChevronRight, FiInfo, FiAlertTriangle, FiLock, FiUnlock } from "react-icons/fi";
import { SideDrawer, DrawerRow, SegmentedPills, FilterTable } from "../../components/ui/filter-table";
import { Toggle } from "./antivirus-form";
import MinimalSelect from "../../components/ui/MinimalSelect";
import {
  EMPTY_SSL_EXEMPT, sslFieldEnabled,
  type SSLSSHProfileForm, type SSLProtocolOptions, type SSLExemptEntry, type SSLSSHMetadata,
} from "../../api/inspectionProfiles";
import { PROTOCOL_LABELS, deepOnly, exemptValue, parsePorts } from "./sslssh-sections.logic";

type SetFn = <K extends keyof SSLSSHProfileForm>(k: K, v: SSLSSHProfileForm[K]) => void;

// ─── Vocabulary ──────────────────────────────────────────────────────────────

const STATUS_OPTS_FULL: { v: SSLProtocolOptions["status"]; l: string }[] = [
  { v: "disable", l: "Disable" },
  { v: "certificate-inspection", l: "Certificate" },
  { v: "deep-inspection", l: "Deep" },
];
const STATUS_OPTS_DEEP: { v: SSLProtocolOptions["status"]; l: string }[] = [
  { v: "disable", l: "Disable" },
  { v: "deep-inspection", l: "Deep" },
];

const ALLOW_BLOCK: { v: "allow" | "block"; l: string }[] = [
  { v: "allow", l: "Allow" }, { v: "block", l: "Block" },
];
const ALLOW_BLOCK_IGNORE: { v: "allow" | "block" | "ignore"; l: string }[] = [
  { v: "allow", l: "Allow" }, { v: "block", l: "Block" }, { v: "ignore", l: "Ignore" },
];
const CLIENT_CERT: { v: SSLProtocolOptions["client_certificate"]; l: string }[] = [
  { v: "bypass", l: "Bypass" }, { v: "inspect", l: "Inspect" }, { v: "block", l: "Block" },
];
const SNI_CHECK: { v: SSLProtocolOptions["sni_server_cert_check"]; l: string }[] = [
  { v: "disable", l: "Disable" }, { v: "enable", l: "Enable" }, { v: "strict", l: "Strict" },
];
const MIN_TLS: { v: SSLProtocolOptions["min_allowed_ssl_version"]; l: string }[] = [
  { v: "ssl-3.0", l: "SSL 3.0" }, { v: "tls-1.0", l: "TLS 1.0" }, { v: "tls-1.1", l: "TLS 1.1" },
  { v: "tls-1.2", l: "TLS 1.2" }, { v: "tls-1.3", l: "TLS 1.3" },
];

// ─── Protocol Port Mapping ───────────────────────────────────────────────────

const CertOptionRow: React.FC<{
  label: string; hint?: string; gate?: string; children: React.ReactNode;
}> = ({ label, hint, gate, children }) => (
  <div className={`flex items-center gap-3 py-1.5 ${gate ?? ""}`}>
    <span className="w-56 shrink-0 text-[12px] ink-2" title={hint}>{label}</span>
    <div className="flex-1">{children}</div>
  </div>
);

const ProtocolBlock: React.FC<{
  proto: SSLProtocolOptions; onPatch: (p: Partial<SSLProtocolOptions>) => void;
  meta: SSLSSHMetadata; color: string;
}> = ({ proto, onPatch, meta, color }) => {
  const [open, setOpen] = useState(false);
  const isCatchAll = proto.protocol === "ssl";
  // The catch-all's switch is `inspect-all`; every other block uses `status`.
  const inspection = isCatchAll ? proto.inspect_all : proto.status;
  const on = inspection !== "disable";
  const label = PROTOCOL_LABELS[proto.protocol] ?? proto.protocol.toUpperCase();

  // Greyed rather than hidden: a field this device does not have is still worth showing, because
  // "why can't I set the ports" is a question with an answer (see the flow-mode banner).
  const has = (field: string) => sslFieldEnabled(meta, proto.protocol, field);
  const gate = (field: string) => (has(field) ? "" : "pointer-events-none opacity-40");

  return (
    <div className="border-b hairline-2 last:border-0">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="flex w-44 shrink-0 items-center gap-1.5 text-left text-[12px] font-semibold ink">
          {open ? <FiChevronDown size={13} className="ink-3" /> : <FiChevronRight size={13} className="ink-3" />}
          {on ? <FiUnlock size={11} style={{ color }} /> : <FiLock size={11} className="ink-3" />}
          {label}
        </button>

        <div className={gate(isCatchAll ? "inspect-all" : "status")}>
          <SegmentedPills<SSLProtocolOptions["status"]> label="Inspection mode"
            opts={deepOnly(proto.protocol) ? STATUS_OPTS_DEEP : STATUS_OPTS_FULL}
            value={inspection as SSLProtocolOptions["status"]} color={color}
            onChange={(v) => onPatch(isCatchAll ? { inspect_all: v as SSLProtocolOptions["inspect_all"] } : { status: v })} />
        </div>

        {!isCatchAll && (
          <div className={`flex items-center gap-2 ${gate("ports")}`}>
            <label htmlFor="ports" className="text-[11px] ink-3">Ports</label>
            <input id="ports"
              defaultValue={proto.ports.join(", ")}
              key={`${proto.protocol}-${proto.ports.join(",")}`}
              disabled={!has("ports")}
              onBlur={(e) => onPatch({ ports: parsePorts(e.target.value) })}
              placeholder="443"
              className="h-7 w-32 rounded border hairline surface-card px-2 text-[12px] ink outline-none" />
          </div>
        )}

        {isCatchAll && (
          <span className="text-[11px] ink-3">TLS on any port no block below claims</span>
        )}

        {on && !isCatchAll && has("ports") && proto.ports.length === 0 && (
          <span className="flex items-center gap-1 text-[11px] text-amber-500">
            <FiAlertTriangle size={11} /> no ports — inspects nothing
          </span>
        )}
      </div>

      {open && (
        <div className="border-t hairline-2 surface-sunken px-6 py-3">
          {proto.protocol === "ssh" ? (
            <>
              <CertOptionRow label="Inspect all SSH ports"
                hint="Inspect SSH found on any port, not just the ones listed above.">
                <SegmentedPills<SSLProtocolOptions["inspect_all"]> label="Inspect all SSH ports"
                  opts={[{ v: "disable", l: "Disable" }, { v: "deep-inspection", l: "Deep" }]}
                  value={proto.inspect_all} color={color}
                  onChange={(v) => onPatch({ inspect_all: v })} />
              </CertOptionRow>
              <CertOptionRow label="Unsupported SSH version"
                hint="What to do with an SSH version this firewall cannot inspect.">
                <SegmentedPills<SSLProtocolOptions["unsupported_version"]> label="Unsupported SSH version"
                  opts={[{ v: "bypass", l: "Bypass" }, { v: "block", l: "Block" }]}
                  value={proto.unsupported_version} color={color}
                  onChange={(v) => onPatch({ unsupported_version: v })} />
              </CertOptionRow>
              <CertOptionRow label="SSH algorithm"
                hint="high-encryption restricts the session to strong ciphers; older clients may fail to connect.">
                <SegmentedPills<SSLProtocolOptions["ssh_algorithm"]> label="SSH algorithm"
                  opts={[{ v: "compatible", l: "Compatible" }, { v: "high-encryption", l: "High encryption" }]}
                  value={proto.ssh_algorithm} color={color}
                  onChange={(v) => onPatch({ ssh_algorithm: v })} />
              </CertOptionRow>
              <CertOptionRow label="SSH tunnel policy check">
                <Toggle label="SSH tunnel policy check" checked={proto.ssh_tun_policy_check} color={color}
                  onChange={(v) => onPatch({ ssh_tun_policy_check: v })} />
              </CertOptionRow>
            </>
          ) : (
            <>
              {/* These five are the ones that decide whether a bad certificate reaches the user.
                  They default the way FortiOS defaults them, which is not uniformly "block". */}
              <CertOptionRow gate={gate("expired-server-cert")} label="Expired certificate"
                hint="A server certificate whose validity period has passed.">
                <SegmentedPills<"allow" | "block" | "ignore"> label="Expired certificate" opts={ALLOW_BLOCK_IGNORE}
                  value={proto.expired_server_cert} color={color}
                  onChange={(v) => onPatch({ expired_server_cert: v })} />
              </CertOptionRow>
              <CertOptionRow gate={gate("revoked-server-cert")} label="Revoked certificate"
                hint="A certificate the issuing CA has withdrawn.">
                <SegmentedPills<"allow" | "block" | "ignore"> label="Revoked certificate" opts={ALLOW_BLOCK_IGNORE}
                  value={proto.revoked_server_cert} color={color}
                  onChange={(v) => onPatch({ revoked_server_cert: v })} />
              </CertOptionRow>
              <CertOptionRow gate={gate("untrusted-server-cert")} label="Untrusted certificate"
                hint="Signed by a CA this firewall does not trust. FortiOS allows these by default.">
                <SegmentedPills<"allow" | "block" | "ignore"> label="Untrusted certificate" opts={ALLOW_BLOCK_IGNORE}
                  value={proto.untrusted_server_cert} color={color}
                  onChange={(v) => onPatch({ untrusted_server_cert: v })} />
              </CertOptionRow>
              <CertOptionRow gate={gate("cert-validation-failure")} label="Certificate validation failure">
                <SegmentedPills<"allow" | "block" | "ignore"> label="Certificate validation failure" opts={ALLOW_BLOCK_IGNORE}
                  value={proto.cert_validation_failure} color={color}
                  onChange={(v) => onPatch({ cert_validation_failure: v })} />
              </CertOptionRow>
              <CertOptionRow gate={gate("cert-validation-timeout")} label="Certificate validation timeout">
                <SegmentedPills<"allow" | "block" | "ignore"> label="Certificate validation timeout" opts={ALLOW_BLOCK_IGNORE}
                  value={proto.cert_validation_timeout} color={color}
                  onChange={(v) => onPatch({ cert_validation_timeout: v })} />
              </CertOptionRow>

              <div className="my-2 border-t hairline-2" />

              <CertOptionRow gate={gate("client-certificate")} label="Client certificate"
                hint="What to do when the client presents a certificate of its own.">
                <SegmentedPills<SSLProtocolOptions["client_certificate"]> label="Client certificate" opts={CLIENT_CERT}
                  value={proto.client_certificate} color={color}
                  onChange={(v) => onPatch({ client_certificate: v })} />
              </CertOptionRow>
              <CertOptionRow gate={gate("sni-server-cert-check")} label="SNI / server certificate check"
                hint="Strict requires the certificate to match the name the client asked for.">
                <SegmentedPills<SSLProtocolOptions["sni_server_cert_check"]> label="SNI / server certificate check" opts={SNI_CHECK}
                  value={proto.sni_server_cert_check} color={color}
                  onChange={(v) => onPatch({ sni_server_cert_check: v })} />
              </CertOptionRow>
              <CertOptionRow gate={gate("min-allowed-ssl-version")} label="Minimum TLS version"
                hint="Sessions negotiating below this are treated as unsupported.">
                <MinimalSelect value={proto.min_allowed_ssl_version} ariaLabel="Minimum TLS version"
                  size="sm" className="w-40"
                  onChange={(v) => onPatch({ min_allowed_ssl_version: v as SSLProtocolOptions["min_allowed_ssl_version"] })}
                  options={MIN_TLS.map((o) => ({ value: o.v, label: o.l }))} />
              </CertOptionRow>
              <CertOptionRow gate={gate("unsupported-ssl-version")} label="Unsupported TLS version">
                <SegmentedPills<"allow" | "block"> label="Unsupported TLS version" opts={ALLOW_BLOCK}
                  value={proto.unsupported_ssl_version} color={color}
                  onChange={(v) => onPatch({ unsupported_ssl_version: v })} />
              </CertOptionRow>
              <CertOptionRow gate={gate("unsupported-ssl-cipher")} label="Unsupported cipher">
                <SegmentedPills<"allow" | "block"> label="Unsupported cipher" opts={ALLOW_BLOCK}
                  value={proto.unsupported_ssl_cipher} color={color}
                  onChange={(v) => onPatch({ unsupported_ssl_cipher: v })} />
              </CertOptionRow>
              <CertOptionRow gate={gate("unsupported-ssl-negotiation")} label="Failed handshake">
                <SegmentedPills<"allow" | "block"> label="Failed handshake" opts={ALLOW_BLOCK}
                  value={proto.unsupported_ssl_negotiation} color={color}
                  onChange={(v) => onPatch({ unsupported_ssl_negotiation: v })} />
              </CertOptionRow>
              {proto.protocol !== "dot" && (
                <CertOptionRow gate={gate("cert-probe-failure")} label="Certificate probe failure">
                  <SegmentedPills<"allow" | "block"> label="Certificate probe failure" opts={ALLOW_BLOCK}
                    value={proto.cert_probe_failure} color={color}
                    onChange={(v) => onPatch({ cert_probe_failure: v })} />
                </CertOptionRow>
              )}
              {proto.protocol !== "ftps" && (
                <CertOptionRow gate={gate("proxy-after-tcp-handshake")} label="Proxy after TCP handshake">
                  <Toggle label="Proxy after TCP handshake" checked={proto.proxy_after_tcp_handshake} color={color}
                    onChange={(v) => onPatch({ proxy_after_tcp_handshake: v })} />
                </CertOptionRow>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export const SSLProtocolTable: React.FC<{
  form: SSLSSHProfileForm; set: SetFn; meta: SSLSSHMetadata; currentColor: string;
}> = ({ form, set, meta, currentColor }) => {
  const patchAt = (i: number, p: Partial<SSLProtocolOptions>) =>
    set("protocols", form.protocols.map((row, x) => (x === i ? { ...row, ...p } : row)));

  const anyDeep = form.protocols.some(
    (p) => p.status === "deep-inspection" || (p.protocol === "ssl" && p.inspect_all === "deep-inspection"));

  return (
    <div className="px-6 pb-5">
      <div className="ml-1 mt-2 overflow-hidden rounded-[4px] border hairline">
        {form.protocols.map((p, i) => (
          <ProtocolBlock key={p.protocol} proto={p} meta={meta} color={currentColor}
            onPatch={(patch) => patchAt(i, patch)} />
        ))}
      </div>

      <p className="mt-2 flex items-start gap-1.5 text-[11px] ink-3">
        <FiInfo size={12} className="mt-0.5 shrink-0" />
        <span>
          <strong>Certificate</strong> inspection reads only the certificate — enough for Web Filter
          to see the site name, but AntiVirus and Application Control still cannot see inside.
          <strong> Deep</strong> inspection decrypts the session, which is what the other Security
          Profiles need — and what requires the CA above to be trusted by every endpoint.
        </span>
      </p>

      {anyDeep && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-500">
          <FiAlertTriangle size={12} className="mt-0.5 shrink-0" />
          Deep inspection breaks certificate pinning. Banking apps, software updaters and some
          mobile apps will fail until they are exempted below.
        </p>
      )}
    </div>
  );
};

// ─── Exemptions ──────────────────────────────────────────────────────────────

const EXEMPT_TYPES: { v: SSLExemptEntry["type"]; l: string }[] = [
  { v: "fortiguard-category", l: "Category" },
  { v: "address", l: "Address" },
  { v: "address6", l: "IPv6 Address" },
  { v: "wildcard-fqdn", l: "Wildcard FQDN" },
  { v: "regex", l: "Regex" },
];

export const SSLExemptions: React.FC<{
  form: SSLSSHProfileForm; set: SetFn; meta: SSLSSHMetadata; currentColor: string;
}> = ({ form, set, meta, currentColor }) => {
  const rows = form.exemptions;
  const [draft, setDraft] = useState<{ entry: SSLExemptEntry; index: number | null } | null>(null);

  const patch = (p: Partial<SSLExemptEntry>) => draft && setDraft({ ...draft, entry: { ...draft.entry, ...p } });

  const save = () => {
    if (!draft) return;
    const next = [...rows];
    if (draft.index === null) next.push(draft.entry);
    else next[draft.index] = draft.entry;
    set("exemptions", next);
    setDraft(null);
  };

  const canSave = !!draft && exemptValue(draft.entry, meta).trim().length > 0
    && !(draft.entry.type === "fortiguard-category" && draft.entry.fortiguard_category <= 0);

  return (
    <div className="px-6 pb-5">
      <FilterTable<SSLExemptEntry>
        rows={rows} color={currentColor} gridCols="1fr 2fr"
        matches={(r, q) => r.type.includes(q) || exemptValue(r, meta).toLowerCase().includes(q)}
        columns={[
          { key: "type", header: "Type", render: (r) => EXEMPT_TYPES.find((t) => t.v === r.type)?.l ?? r.type },
          { key: "value", header: "Value", render: (r) => exemptValue(r, meta) || "—" },
        ]}
        onCreate={() => setDraft({ entry: { ...EMPTY_SSL_EXEMPT }, index: null })}
        onEdit={(i) => setDraft({ entry: { ...rows[i] }, index: i })}
        onDelete={(i) => set("exemptions", rows.filter((_, x) => x !== i))}
      />

      <SideDrawer open={!!draft} color={currentColor}
        title={draft?.index === null ? "New Exemption" : "Edit Exemption"}
        canSave={canSave} onOK={save} onCancel={() => setDraft(null)}>
        {draft && (
          <>
            <DrawerRow label="Type" top>
              <SegmentedPills<SSLExemptEntry["type"]> label="Exempt entry type" opts={EXEMPT_TYPES} value={draft.entry.type}
                color={currentColor} onChange={(v) => patch({ type: v })} />
            </DrawerRow>

            {draft.entry.type === "fortiguard-category" && (
              <DrawerRow label="Category" top>
                <MinimalSelect value={String(draft.entry.fortiguard_category)} ariaLabel="Category" className="w-full"
                  onChange={(v) => patch({ fortiguard_category: Number(v) })}
                  options={[
                    { value: "0", label: "Select a category…" },
                    ...meta.categories.map((c) => ({ value: String(c.id), label: c.name })),
                  ]} />
                {meta.categories.length === 0 && (
                  <p className="mt-1 text-[11px] ink-3">
                    This device returned no FortiGuard categories — an inactive web-filtering
                    subscription. Use an address or wildcard FQDN instead.
                  </p>
                )}
              </DrawerRow>
            )}

            {draft.entry.type === "address" && (
              <DrawerRow label="Address" top>
                <MinimalSelect value={draft.entry.address} ariaLabel="Address" className="w-full"
                  onChange={(v) => patch({ address: v })}
                  options={[
                    { value: "", label: "Select an address object…" },
                    ...meta.addresses.map((a) => ({ value: a, label: a })),
                  ]} />
              </DrawerRow>
            )}

            {draft.entry.type === "address6" && (
              <DrawerRow label="IPv6 address" top>
                <input value={draft.entry.address6} placeholder="an IPv6 address object name"
                  onChange={(e) => patch({ address6: e.target.value })}
                  className="h-8 w-full rounded border hairline surface-card px-2.5 text-[13px] ink outline-none" />
              </DrawerRow>
            )}

            {draft.entry.type === "wildcard-fqdn" && (
              <DrawerRow label="Wildcard FQDN" top>
                <MinimalSelect value={draft.entry.wildcard_fqdn} ariaLabel="Wildcard FQDN" className="w-full"
                  onChange={(v) => patch({ wildcard_fqdn: v })}
                  options={[
                    { value: "", label: "Select an FQDN object…" },
                    ...meta.wildcard_fqdns.map((a) => ({ value: a, label: a })),
                  ]} />
                <p className="mt-1 text-[11px] ink-3">
                  Only FQDN-type address objects appear here — the device rejects anything else in
                  this slot.
                </p>
              </DrawerRow>
            )}

            {draft.entry.type === "regex" && (
              <DrawerRow label="Pattern" top>
                <input value={draft.entry.regex} placeholder=".*\\.bank\\.co\\.th"
                  onChange={(e) => patch({ regex: e.target.value })}
                  className="h-8 w-full rounded border hairline surface-card px-2.5 font-mono text-[13px] ink outline-none" />
              </DrawerRow>
            )}
          </>
        )}
      </SideDrawer>
    </div>
  );
};
