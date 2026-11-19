import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { FiServer, FiChevronLeft, FiSave, FiAlertTriangle } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ListDevices, type NetworkDevice } from "../../api/device";
import { DeviceGetInfo } from "../../api/policyObject";
import { DeviceListDHCPServers, DeviceUpdateDHCPServer, type DHCPServer } from "../../api/dhcp";
import { apiErrorText } from "../../api/errorText";
import {
  BLANK_DRAFT, buildPayload, clearingDomain, draftFrom, isBeyondThisForm, validateDraft,
  type DHCPDraft,
} from "./model";
import { DHCPFields } from "./dhcp-form";
import { DhcpInfoPanel } from "./create";

const DHCPServerEditPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const deviceId = Number(searchParams.get("deviceId"));
  const id = Number(searchParams.get("id"));

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [hostname, setHostname] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [original, setOriginal] = useState<DHCPServer | null>(null);

  const [draft, setDraft] = useState<DHCPDraft>({ ...BLANK_DRAFT });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof DHCPDraft>(k: K, v: DHCPDraft[K]) => setDraft((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!deviceId || !id) { setLoading(false); setNotFound(true); return; }
    (async () => {
      const [list, info, servers] = await Promise.all([
        ListDevices().catch(() => []),
        DeviceGetInfo(deviceId),
        // strict: an unreadable firewall must not land here as "server not found".
        DeviceListDHCPServers(deviceId, { strict: true }).catch(() => []),
      ]);

      const found = list.find((d) => d.id === deviceId) ?? null;
      setDevice(found);
      if (found) setHostname(info.hostname || found.name);

      const server = servers.find((s) => s.id === id) ?? null;
      if (!server) setNotFound(true);
      else { setOriginal(server); setDraft(draftFrom(server)); }
      setLoading(false);
    })();
  }, [deviceId, id]);

  const domainWarning = original ? clearingDomain(original, draft) : false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateDraft(draft);
    if (problem) { setFormError(problem); return; }
    setFormError(null);
    try {
      setSaving(true);
      await DeviceUpdateDHCPServer(deviceId, id, buildPayload(draft));
      // The {} {} {} shape matches the create page's message, which is already translated once
      // for both: "DHCP server on {} {} on {}".
      const verb = "updated";
      message.success(`DHCP server on ${draft.interface} ${verb} on ${hostname || device?.name}`);
      navigate(`/admin/dhcp-servers?deviceId=${deviceId}`);
    } catch (err: unknown) {
      setFormError(apiErrorText(err, "the device refused the change"));
    } finally {
      setSaving(false);
    }
  };

  const beyondForm = original ? isBeyondThisForm(original) : false;

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiServer />}
        title={original ? `Edit the DHCP server on ${original.interface}` : "Edit DHCP Server"}
        accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {loading ? (
        <div className="py-20 text-center text-[13px] ink-3">Loading DHCP server…</div>
      ) : notFound ? (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600">DHCP server not found — go back to the list.</div>
      ) : beyondForm ? (
        <div className="banner banner-warn">
          <FiAlertTriangle size={14} className="shrink-0" />
          <span>
            {`The server on ${original!.interface} takes its addresses from somewhere this form does not edit (${original!.server_type === "ipsec" ? "a dial-up VPN" : "a user group"}) — editing it here would rewrite it into a plain range server. Go back to the list.`}
          </span>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {formError && (
            <div className="banner banner-danger mb-4">
              <FiAlertTriangle size={14} className="shrink-0" /><span>{formError}</span>
            </div>
          )}

          {domainWarning && (
            <div className="banner banner-danger mb-4">
              <FiAlertTriangle size={14} className="shrink-0" />
              <span>
                FortiOS cannot clear a DHCP domain over the API — it would keep
                &quot;{original?.domain}&quot; and report success. Put a domain back, or remove it
                on the device with <code>unset domain</code>.
              </span>
            </div>
          )}

          <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 270px" }}>
            <div className="rounded-[4px] border hairline surface-card shadow-sm">
              <DHCPFields draft={draft} set={set} interfaces={[]} isEditing currentColor={currentColor} />
            </div>
            <DhcpInfoPanel device={device} hostname={hostname} currentColor={currentColor} />
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <button type="button" onClick={() => navigate(-1)}
              className="h-10 px-5 rounded-[4px] border hairline text-[13px] font-semibold ink-2 surface-hover transition">Cancel</button>
            <button type="submit" disabled={saving || domainWarning}
              className="h-10 px-6 rounded-[4px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
              style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
              {saving ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</> : <><FiSave size={14} /> Save</>}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default DHCPServerEditPage;
