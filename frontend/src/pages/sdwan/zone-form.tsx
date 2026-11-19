import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FiGlobe, FiCheck, FiSearch } from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { ListDevices, type NetworkDevice } from "../../api/device";
import {
  DeviceGetSDWAN, DeviceCreateSDWANZone, DeviceUpdateSDWANZone, DeviceUpdateSDWANMember,
  type SDWANMember,
} from "../../api/policyObject";
import { SDWANFormShell, fRow, fLabel, fInput } from "./form-shell";
import { apiErrorDetail } from "../../api/errorText";

// New / Edit SD-WAN Zone — Name + Interface members.
//
// A member's zone is stored on the MEMBER (system/sdwan/members.zone), not on the zone, so moving
// one here is an update to that member. The page says so rather than implying the zone owns a
// member list, and the moves are issued one write each after the zone itself exists.

const ZoneFormPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const deviceIdParam = params.get("deviceId");
  const nameParam = params.get("name");
  const isEdit = !!nameParam;
  const backTo = `/admin/sdwan?tab=zones${deviceIdParam ? `&deviceId=${deviceIdParam}` : ""}`;

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [members, setMembers] = useState<SDWANMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!deviceIdParam) { setLoading(false); return; }
    let live = true;
    void (async () => {
      const list = await ListDevices().catch(() => []);
      const found = list.find((d) => d.id === Number(deviceIdParam)) ?? null;
      if (!live) return;
      setDevice(found);
      if (!found) { setLoading(false); return; }

      const overview = await DeviceGetSDWAN(found.id).catch(() => null);
      if (!live) return;
      if (overview) {
        setMembers(overview.members);
        if (isEdit) {
          const zone = overview.zones.find((z) => z.name === nameParam);
          if (zone) {
            setName(zone.name);
            setPicked(new Set(overview.members.filter((m) => m.zone === zone.name).map((m) => m.seq_num)));
          } else {
            setError(`No SD-WAN zone named "${nameParam}" on this device`);
          }
        }
      }
      setLoading(false);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceIdParam, nameParam]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => `${m.interface} ${m.zone}`.toLowerCase().includes(q));
  }, [members, search]);

  const toggle = (seq: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq); else next.add(seq);
      return next;
    });

  const submit = async () => {
    if (!device) return;
    const clean = name.trim();
    if (!clean) { setError("Enter a zone name"); return; }
    setError("");
    setSaving(true);
    try {
      if (isEdit && nameParam) {
        await DeviceUpdateSDWANZone(device.id, nameParam, { name: clean });
      } else {
        await DeviceCreateSDWANZone(device.id, { name: clean });
      }

      // Then move whichever members changed hands. After the zone exists, because a member cannot
      // point at a zone the device has not created yet.
      for (const m of members) {
        const shouldBeHere = picked.has(m.seq_num);
        const isHere = m.zone === clean;
        if (shouldBeHere === isHere) continue;
        const target = shouldBeHere ? clean : "virtual-wan-link";
        if (target === m.zone) continue;
        await DeviceUpdateSDWANMember(device.id, m.seq_num, {
          interface: m.interface, zone: target, gateway: m.gateway, source: m.source,
          cost: m.cost, weight: m.weight, priority: m.priority, status: m.status,
          comment: m.comment,
        });
      }

      message.success(isEdit ? `SD-WAN zone "${clean}" updated` : `SD-WAN zone "${clean}" created`);
      navigate(backTo);
    } catch (err) {
      setError(apiErrorDetail(err, "The device rejected the change"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SDWANFormShell
      icon={<FiGlobe />}
      title={isEdit ? `Edit SD-WAN Zone — ${nameParam}` : "New SD-WAN Zone"}
      device={device}
      backTo={backTo}
      loading={loading}
      saving={saving}
      error={error}
      onSubmit={() => void submit()}
    >
      <div className="space-y-4 px-5 py-5">
        <div className={fRow}>
          <label htmlFor="name" className={fLabel}>Name</label>
          <input id="name" className={`${fInput} bg-yellow-50 dark:bg-yellow-900/10`} value={name}
            maxLength={35} onChange={(e) => setName(e.target.value)} placeholder="e.g. branch-wan" />
        </div>

        <div>
          <p className="t-label mb-1.5">Interface members</p>
          {members.length === 0 ? (
            <p className="rounded border hairline surface-sunken px-3 py-2.5 text-[11.5px] ink-3">
              There are no SD-WAN members on this device yet. Create one first, then it can be moved
              into a zone.
            </p>
          ) : (
            <>
              <div className="mb-1.5 flex items-center gap-1.5 rounded border hairline surface-sunken px-2.5">
                <FiSearch size={11} className="ink-3" />
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter members"
                  className="h-7 w-full bg-transparent text-[11.5px] ink outline-none" />
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded border hairline p-1.5">
                {shown.map((m) => {
                  const on = picked.has(m.seq_num);
                  return (
                    <button key={m.seq_num} type="button" onClick={() => toggle(m.seq_num)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition surface-hover">
                      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-sm border"
                        style={on
                          ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
                          : { borderColor: "var(--shell-border)" }}>
                        {on && <FiCheck size={10} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold ink">{m.interface}</span>
                        <span className="block truncate text-[10.5px] ink-3">
                          seq {m.seq_num} · currently in {m.zone}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] ink-3">
                A member's zone is stored on the member, so unticking one here moves it back to
                <b className="ink"> virtual-wan-link</b> rather than leaving it without a zone.
              </p>
            </>
          )}
        </div>
      </div>
    </SDWANFormShell>
  );
};

export default ZoneFormPage;
