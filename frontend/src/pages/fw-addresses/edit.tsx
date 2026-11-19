import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { FiEdit2, FiChevronLeft, FiSave } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ListDevices, type NetworkDevice } from "../../api/device";
import { DeviceListAddresses, DeviceUpdateAddress, DeviceGetInfo } from "../../api/policyObject";
import { AddressFieldsMain, AddressFieldsOptions } from "./address-form";
import { useAddressFormOptions, buildAddressPayload, validateAddressForm, addressObjectToForm, BLANK_ADDRESS_FORM, type AddressFormState } from "./address-form.logic";
import { CliModal, InfoPanel } from "./create";
import { apiErrorDetail } from "../../api/errorText";

const FwAddressEditPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const [device, setDevice]         = useState<NetworkDevice | null>(null);
  const [hostname, setHostname]     = useState("");
  const [loadingDev, setLoadingDev] = useState(true);
  const [loadingAddr, setLoadingAddr] = useState(true);
  const [notFound, setNotFound]     = useState(false);
  const [showCLI, setShowCLI]       = useState(false);
  const [originalName, setOriginalName] = useState("");

  const [form, setForm]     = useState<AddressFormState>(BLANK_ADDRESS_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof AddressFormState>(k: K, v: AddressFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  const { interfaces, loadingIf, sdnConnectors } = useAddressFormOptions(device?.id);

  useEffect(() => {
    const deviceIdStr = searchParams.get("deviceId");
    const addrName    = searchParams.get("name");
    if (!deviceIdStr || !addrName) { setLoadingDev(false); setLoadingAddr(false); return; }

    ListDevices().then(async (list) => {
      const found = list.find((d) => d.id === Number(deviceIdStr)) ?? null;
      setDevice(found);
      if (!found) { setLoadingDev(false); setLoadingAddr(false); return; }

      const info = await DeviceGetInfo(found.id);
      setHostname(info.hostname || found.name);
      setLoadingDev(false);

      try {
        const addrs = await DeviceListAddresses(found.id);
        const addr  = addrs.find((a) => a.name === addrName);
        if (!addr) { setNotFound(true); }
        else { setOriginalName(addr.name); setForm(addressObjectToForm(addr)); }
      } catch { setNotFound(true); }
      finally { setLoadingAddr(false); }
    }).catch(() => { setLoadingDev(false); setLoadingAddr(false); });
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateAddressForm(form);
    if (!device) errs.device = "No device selected";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    try {
      setSaving(true);
      await DeviceUpdateAddress(device!.id, originalName, buildAddressPayload(form));
      message.success(`Address "${form.name}" updated on ${hostname || device!.name}`);
      navigate(`/admin/fw-addresses?deviceId=${device!.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to update address"));
    } finally {
      setSaving(false);
    }
  };

  const isLoading = loadingDev || loadingAddr;
  // Name is the FortiGate mkey — editing here keeps the object identity, so lock it.
  const fieldsProps = { form, set, errors, interfaces, loadingIf, sdnConnectors, currentColor, isEdit: true };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiEdit2 />} title="Edit Address" accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: currentColor, borderTopColor: "transparent" }} />
          <span className="ml-3 text-[13px] ink-3">Loading address…</span>
        </div>
      )}

      {!isLoading && notFound && (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600">
          Address not found — it may have been deleted.{" "}
          <button type="button" onClick={() => navigate(-1)} className="underline font-semibold">Go back</button>
        </div>
      )}

      {!isLoading && !device && !notFound && (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-600">
          No device — go back and select a device
        </div>
      )}

      {!isLoading && device && !notFound && (
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 270px" }}>
            <div className="rounded-[4px] border hairline surface-card shadow-sm">
              <AddressFieldsMain {...fieldsProps} />
              <AddressFieldsOptions {...fieldsProps} />
            </div>

            <InfoPanel device={device} hostname={hostname} currentColor={currentColor} onCLI={() => setShowCLI(true)} />
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <button type="button" onClick={() => navigate(-1)}
              className="h-10 px-5 rounded-[4px] border hairline text-[13px] font-semibold ink-2 surface-hover transition">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="h-10 px-6 rounded-[4px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
              style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
              {saving
                ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</>
                : <><FiSave size={14} /> Save Changes</>}
            </button>
          </div>
        </form>
      )}

      {showCLI && device && (
        <CliModal hostname={hostname || device.name} deviceId={device.id} onClose={() => setShowCLI(false)} />
      )}
    </div>
  );
};

export default FwAddressEditPage;
