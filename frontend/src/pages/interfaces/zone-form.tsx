import React from "react";
import { FiAlertTriangle, FiInfo } from "react-icons/fi";
import type { SystemInterface } from "../../api/policyObject";
import MinimalSelect from "../../components/ui/MinimalSelect";
import type { ZoneDraft } from "./zone-form.logic";

// The fields shared by the standalone create and edit pages — pulled out of zones-tab.tsx's old
// modal the same way static-routes/route-form.tsx and dhcp-servers/dhcp-form.tsx already split
// theirs out for their own full-page create/edit.

export const ZoneFields: React.FC<{
  draft: ZoneDraft;
  set: <K extends keyof ZoneDraft>(k: K, v: ZoneDraft[K]) => void;
  interfaces: SystemInterface[];
  ifError: string | null;
  claimedBy: Map<string, string>;
  /** The zone's own current name, while editing — its own members must not show as "taken". */
  originalName: string | null;
  formError: string | null;
}> = ({ draft, set, interfaces, ifError, claimedBy, originalName, formError }) => {
  const toggleInterface = (name: string) => {
    const has = draft.interfaces.includes(name);
    set("interfaces", has ? draft.interfaces.filter((i) => i !== name) : [...draft.interfaces, name]);
  };

  return (
    <div className="space-y-3 px-6 py-5">
      {formError && (
        <div className="banner banner-danger">
          <FiAlertTriangle size={14} className="shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="zone-name" className="field-label">Name</label>
          <input id="zone-name" className="shell-input" value={draft.name}
                 onChange={(e) => set("name", e.target.value)} placeholder="inside" maxLength={35} />
        </div>
        <div>
          <label htmlFor="zone-intra" className="field-label">Intra-zone traffic</label>
          <MinimalSelect id="zone-intra" ariaLabel="Intra-zone traffic" className="w-full" value={draft.intrazone}
            onChange={(v) => set("intrazone", v)}
            options={[
              { value: "deny", label: "Deny — traffic between members still needs a policy" },
              { value: "allow", label: "Allow — members can reach each other with no rule" },
            ]} />
        </div>
      </div>

      <div>
        <label htmlFor="zone-desc" className="field-label">Description</label>
        <input id="zone-desc" className="shell-input" value={draft.description}
               onChange={(e) => set("description", e.target.value)} />
      </div>

      <div>
        <span className="field-label">Interfaces</span>
        {ifError ? (
          <div className="banner banner-warn">
            <FiAlertTriangle size={14} className="shrink-0" />
            <span>{`Could not read the interface list (${ifError}). This is unreadable, not empty.`}</span>
          </div>
        ) : (
          <>
            <div className="panel panel-flush" style={{ maxHeight: 220, overflowY: "auto" }}>
              {interfaces.map((i, idx) => {
                const owner = claimedBy.get(i.name.toLowerCase());
                const takenByOther = owner !== undefined && owner !== originalName;
                const selected = draft.interfaces.includes(i.name);
                return (
                  <label key={i.name}
                         className={`flex items-center gap-2 px-3 py-1.5${idx < interfaces.length - 1 ? " border-b hairline-2" : ""} ${takenByOther ? "opacity-55" : "surface-hover cursor-pointer"}`}>
                    <input type="checkbox" checked={selected} disabled={takenByOther}
                           onChange={() => toggleInterface(i.name)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium ink">{i.name}</span>
                      <span className="block truncate t-meta">
                        {i.ip || "no address"}{i.alias ? ` · ${i.alias}` : ""}
                      </span>
                    </span>
                    {takenByOther && <span className="chip shrink-0">{`in ${owner}`}</span>}
                  </label>
                );
              })}
              {interfaces.length === 0 && (
                <p className="t-meta m-0 px-3 py-6 text-center">No interfaces reported</p>
              )}
            </div>

            <p className="field-hint flex items-start gap-1.5">
              <FiInfo size={12} className="mt-0.5 shrink-0" />
              <span>
                An interface can only be in one zone, and FortiOS also refuses one that a firewall
                policy names directly. Ports already in another zone are greyed out here; the policy
                conflict only shows as the device's refusal when you save.
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
};
