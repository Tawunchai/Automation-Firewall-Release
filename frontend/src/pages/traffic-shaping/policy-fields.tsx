import React from "react";
import MinimalSelect from "../../components/ui/MinimalSelect";
import type { PolicyDraft } from "./policy-form";
import type { TrafficShaper } from "../../api/trafficShaper";

const PolicyFields: React.FC<{
  draft: PolicyDraft;
  setDraft: (next: PolicyDraft) => void;
  addresses: string[];
  services: string[];
  interfaces: string[];
  shapers: TrafficShaper[];
  loadError: string | null;
}> = ({ draft, setDraft, addresses, services, interfaces, shapers, loadError }) => (
  <div className="space-y-3">
    {loadError && (
      <p className="t-meta text-amber-600">Shaper list could not be read: {loadError}</p>
    )}

    <div>
      <label htmlFor="sp-name" className="field-label">Name</label>
      <input id="sp-name" className="shell-input" value={draft.name}
             onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
    </div>

    <div className="grid gap-3 md:grid-cols-2">
      {([
        ["Source interface", "srcintf", interfaces],
        ["Destination interface", "dstintf", interfaces],
        ["Source address", "srcaddr", addresses],
        ["Destination address", "dstaddr", addresses],
        ["Service", "service", services],
      ] as const).map(([label, key, options]) => (
        <div key={key}>
          <label htmlFor={`sp-${key}`} className="field-label">{label}</label>
          <MinimalSelect id={`sp-${key}`} ariaLabel={String(key)}
            value={(draft[key] as string[])[0] ?? ""}
            onChange={(v) => setDraft({ ...draft, [key]: v ? [v] : [] })}
            options={[{ value: "", label: "— any —" }, ...options.map((o) => ({ value: o, label: o }))]} />
        </div>
      ))}
    </div>

    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <label htmlFor="sp-fwd" className="field-label">Shaper — forward</label>
        <MinimalSelect id="sp-fwd" ariaLabel="Forward traffic shaper" value={draft.traffic_shaper}
          onChange={(v) => setDraft({ ...draft, traffic_shaper: v })}
          options={[{ value: "", label: "— none —" }, ...shapers.map((s) => ({ value: s.name, label: s.name }))]} />
      </div>
      <div>
        <label htmlFor="sp-rev" className="field-label">Shaper — reverse</label>
        <MinimalSelect id="sp-rev" ariaLabel="Reverse traffic shaper" value={draft.traffic_shaper_reverse}
          onChange={(v) => setDraft({ ...draft, traffic_shaper_reverse: v })}
          options={[{ value: "", label: "— none —" }, ...shapers.map((s) => ({ value: s.name, label: s.name }))]} />
        <p className="field-hint">
          This is the half people forget: a download limit set only in the forward direction shapes
          the REQUESTS, not the file coming back.
        </p>
      </div>
    </div>
  </div>
);

export default PolicyFields;
