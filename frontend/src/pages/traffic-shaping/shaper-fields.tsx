import React from "react";
import MinimalSelect from "../../components/ui/MinimalSelect";
import type { ShaperDraft } from "./shaper-form";

const ShaperFields: React.FC<{ draft: ShaperDraft; setDraft: (next: ShaperDraft) => void }> = ({ draft, setDraft }) => (
  <div className="space-y-3">
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <label htmlFor="sh-name" className="field-label">Name</label>
        <input id="sh-name" className="shell-input" maxLength={35} value={draft.name}
               onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </div>
      <div>
        <label htmlFor="sh-unit" className="field-label">Unit</label>
        <MinimalSelect id="sh-unit" ariaLabel="Bandwidth unit" value={draft.bandwidth_unit}
          onChange={(v) => setDraft({ ...draft, bandwidth_unit: v })}
          options={[{ value: "kbps", label: "kbps" }, { value: "mbps", label: "mbps" }, { value: "gbps", label: "gbps" }]} />
      </div>
    </div>

    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <label htmlFor="sh-guar" className="field-label">Guaranteed (floor)</label>
        <input id="sh-guar" type="number" className="shell-input" value={draft.guaranteed_bandwidth}
               onChange={(e) => setDraft({ ...draft, guaranteed_bandwidth: Number(e.target.value) })} />
      </div>
      <div>
        <label htmlFor="sh-max" className="field-label">Maximum (ceiling)</label>
        <input id="sh-max" type="number" className="shell-input" value={draft.maximum_bandwidth}
               onChange={(e) => setDraft({ ...draft, maximum_bandwidth: Number(e.target.value) })} />
        <p className="field-hint">0 means UNLIMITED on FortiOS, which is almost never what a shaper is for.</p>
      </div>
    </div>

    <div>
      <label htmlFor="sh-prio" className="field-label">Priority</label>
      <MinimalSelect id="sh-prio" ariaLabel="Priority" value={draft.priority}
        onChange={(v) => setDraft({ ...draft, priority: v })}
        options={[{ value: "high", label: "high" }, { value: "medium", label: "medium" }, { value: "low", label: "low" }]} />
    </div>

    {/* The field that quietly divides your bandwidth. */}
    <div>
      <label className="flex items-center gap-2 text-[12px] ink-2">
        <input type="checkbox" checked={draft.per_policy}
               onChange={(e) => setDraft({ ...draft, per_policy: e.target.checked })} />
        Apply the limit per policy
      </label>
      <p className="field-hint">
        {draft.per_policy
          ? "Each shaping policy using this shaper gets its OWN full allowance."
          : "The allowance is SHARED: three policies using this shaper share one limit between them."}
      </p>
    </div>
  </div>
);

export default ShaperFields;
