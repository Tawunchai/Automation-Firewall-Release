import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { FiShare2 } from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { ListDevices, type NetworkDevice } from "../../api/device";
import {
  DeviceGetSDWAN, DeviceCreateSDWANMember, DeviceUpdateSDWANMember,
  DeviceListSystemInterfaces,
  type SDWANZone, type SDWANMember, type SystemInterface,
} from "../../api/policyObject";
import { SDWANFormShell, fRow, fLabel, fInput } from "./form-shell";
import { apiErrorDetail } from "../../api/errorText";

// New / Edit SD-WAN Member — the FortiGate dialog, as a page.
// Interface · SD-WAN Zone · Gateway · Cost · Priority · Status.

const MemberFormPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const deviceIdParam = params.get("deviceId");
  const seqParam = params.get("seq");
  const isEdit = !!seqParam;
  const backTo = `/admin/sdwan?tab=zones${deviceIdParam ? `&deviceId=${deviceIdParam}` : ""}`;

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [zones, setZones] = useState<SDWANZone[]>([]);
  const [members, setMembers] = useState<SDWANMember[]>([]);
  const [interfaces, setInterfaces] = useState<SystemInterface[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [iface, setIface] = useState("");
  const [zone, setZone] = useState("");
  const [gateway, setGateway] = useState("0.0.0.0");
  const [cost, setCost] = useState("0");
  const [priority, setPriority] = useState("1");
  const [status, setStatus] = useState(true);
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!deviceIdParam) { setLoading(false); return; }
    let live = true;
    void (async () => {
      const list = await ListDevices().catch(() => []);
      const found = list.find((d) => d.id === Number(deviceIdParam)) ?? null;
      if (!live) return;
      setDevice(found);
      if (!found) { setLoading(false); return; }

      const [overview, ifaces] = await Promise.all([
        DeviceGetSDWAN(found.id).catch(() => null),
        DeviceListSystemInterfaces(found.id).catch(() => [] as SystemInterface[]),
      ]);
      if (!live) return;
      setInterfaces(ifaces);
      if (overview) {
        setZones(overview.zones);
        setMembers(overview.members);
        const existing = isEdit
          ? overview.members.find((m) => m.seq_num === Number(seqParam))
          : undefined;
        if (existing) {
          setIface(existing.interface);
          setZone(existing.zone);
          setGateway(existing.gateway || "0.0.0.0");
          setCost(String(existing.cost ?? 0));
          setPriority(String(existing.priority ?? 1));
          setStatus(existing.status);
          setComment(existing.comment ?? "");
        } else if (!isEdit) {
          // The device's own default zone, which every FortiGate ships with.
          setZone(overview.zones[0]?.name ?? "virtual-wan-link");
        } else {
          setError(`No SD-WAN member with sequence number ${seqParam} on this device`);
        }
      }
      setLoading(false);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceIdParam, seqParam]);

  // An interface may belong to one member only. The one being edited stays selectable, or the form
  // would refuse to save the member it just loaded.
  const available = useMemo(() => {
    const taken = new Set(members.filter((m) => m.seq_num !== Number(seqParam)).map((m) => m.interface));
    return interfaces.filter((i) => !taken.has(i.name));
  }, [interfaces, members, seqParam]);

  const submit = async () => {
    if (!device) return;
    if (!iface) { setError("Choose an interface"); return; }
    if (!zone) { setError("Choose an SD-WAN zone"); return; }
    setError("");
    setSaving(true);
    try {
      const form = {
        interface: iface, zone,
        gateway: gateway.trim() || "0.0.0.0",
        cost: Number(cost) || 0,
        priority: Number(priority) || 0,
        status, comment: comment.trim(),
      };
      if (isEdit) {
        await DeviceUpdateSDWANMember(device.id, Number(seqParam), form);
        message.success(`SD-WAN member "${iface}" updated on ${device.name}`);
      } else {
        await DeviceCreateSDWANMember(device.id, form);
        message.success(`SD-WAN member "${iface}" created on ${device.name}`);
      }
      navigate(backTo);
    } catch (err) {
      setError(apiErrorDetail(err, "The device rejected the change"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SDWANFormShell
      icon={<FiShare2 />}
      title={isEdit ? `Edit SD-WAN Member — ${iface || seqParam}` : "New SD-WAN Member"}
      device={device}
      backTo={backTo}
      loading={loading}
      saving={saving}
      error={error}
      onSubmit={() => void submit()}
    >
      <div className="space-y-4 px-5 py-5">
        <div className={fRow}>
          <label htmlFor="interface" className={fLabel}>Interface</label>
          <div className="flex-1">
            <MinimalSelect id="interface" value={iface} onChange={setIface} ariaLabel="Interface"
              options={[
                { value: "", label: "None" },
                ...available.map((i) => ({ value: i.name, label: i.alias ? `${i.alias} (${i.name})` : i.name })),
              ]} />
            {available.length === 0 && (
              <p className="mt-1 text-[11px] ink-3">
                Every interface on this device is already an SD-WAN member.
              </p>
            )}
          </div>
        </div>

        <div className={fRow}>
          <label htmlFor="sd-wan-zone" className={fLabel}>SD-WAN Zone</label>
          <div className="flex-1">
            <MinimalSelect id="sd-wan-zone" value={zone} onChange={setZone} ariaLabel="SD-WAN Zone"
              options={zones.map((z) => ({ value: z.name, label: z.name }))} />
          </div>
        </div>

        <div className={fRow}>
          <label htmlFor="gateway" className={fLabel}>Gateway</label>
          <div className="flex-1">
            <input id="gateway" className={fInput} value={gateway} onChange={(e) => setGateway(e.target.value)}
              placeholder="0.0.0.0" />
            {/* Saying so beats a form that demands a gateway an interface will learn for itself. */}
            <p className="mt-1 text-[11px] ink-3">
              Leave 0.0.0.0 on an interface that learns its gateway (DHCP or PPPoE).
            </p>
          </div>
        </div>

        <div className={fRow}>
          <label htmlFor="cost" className={fLabel}>Cost</label>
          <input id="cost" className={`${fInput} max-w-[140px]`} type="number" min={0} max={65535}
            value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>

        <div className={fRow}>
          <label htmlFor="priority" className={fLabel}>Priority</label>
          <div className="flex-1">
            <input id="priority" className={`${fInput} max-w-[140px]`} type="number" min={0} max={65535}
              value={priority} onChange={(e) => setPriority(e.target.value)} />
            <p className="mt-1 text-[11px] ink-3">Lower wins when several members are equal.</p>
          </div>
        </div>

        <div role="group" aria-labelledby="status-label" className={fRow}>
          <span id="status-label" className={fLabel}>Status</span>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setStatus(true)}
              className={`btn btn-sm ${status ? "btn-accent" : "btn-soft"}`}>Enabled</button>
            <button type="button" onClick={() => setStatus(false)}
              className={`btn btn-sm ${!status ? "btn-accent" : "btn-soft"}`}>Disabled</button>
          </div>
        </div>

        <div className={fRow}>
          <label htmlFor="comments" className={fLabel}>Comments</label>
          <input id="comments" className={fInput} value={comment} maxLength={255}
            onChange={(e) => setComment(e.target.value)} placeholder="Optional" />
        </div>
      </div>
    </SDWANFormShell>
  );
};

export default MemberFormPage;
