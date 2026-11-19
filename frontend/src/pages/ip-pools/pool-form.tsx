import React from "react";
import { FiAlertTriangle } from "react-icons/fi";
import MinimalSelect from "../../components/ui/MinimalSelect";
import type { IPPoolType } from "../../api/objectGroups";
import { poolSizes, type PoolDraft } from "./pool-model";

// The fields shared by the standalone create and edit pages — pulled out of the page shells so
// both render identically, the same split static-routes/route-form.tsx and dhcp-servers/dhcp-form.tsx
// already use for their own full-page create/edit.

const TYPE_LABEL: Record<IPPoolType, string> = {
  "overload": "Overload",
  "one-to-one": "One-to-One",
  "fixed-port-range": "Fixed Port Range",
  "port-block-allocation": "Port Block Allocation",
};

export const PoolFields: React.FC<{
  draft: PoolDraft;
  set: <K extends keyof PoolDraft>(k: K, v: PoolDraft[K]) => void;
  interfaces: string[];
  formError: string | null;
}> = ({ draft, set, interfaces, formError }) => {
  const sizes = poolSizes(draft);
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
          <label htmlFor="pool-name" className="field-label">Name</label>
          <input id="pool-name" className="shell-input" value={draft.name}
                 onChange={(e) => set("name", e.target.value)} placeholder="branch-nat" />
        </div>
        <div>
          <label htmlFor="pool-type" className="field-label">Type</label>
          <MinimalSelect id="pool-type" value={draft.type} ariaLabel="Pool type"
            onChange={(v) => set("type", v as IPPoolType)}
            options={(Object.keys(TYPE_LABEL) as IPPoolType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="pool-start" className="field-label">External IP — start</label>
          <input id="pool-start" className="shell-input" value={draft.startIp}
                 onChange={(e) => set("startIp", e.target.value)} placeholder="203.0.113.10" />
        </div>
        <div>
          <label htmlFor="pool-end" className="field-label">External IP — end</label>
          <input id="pool-end" className="shell-input" value={draft.endIp}
                 onChange={(e) => set("endIp", e.target.value)} placeholder="203.0.113.20" />
        </div>
      </div>

      {draft.type === "fixed-port-range" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="pool-src-start" className="field-label">Internal IP — start</label>
            <input id="pool-src-start" className="shell-input" value={draft.sourceStartIp}
                   onChange={(e) => set("sourceStartIp", e.target.value)} placeholder="10.0.0.1" />
          </div>
          <div>
            <label htmlFor="pool-src-end" className="field-label">Internal IP — end</label>
            <input id="pool-src-end" className="shell-input" value={draft.sourceEndIp}
                   onChange={(e) => set("sourceEndIp", e.target.value)} placeholder="10.0.0.20" />
          </div>
        </div>
      )}

      {draft.type === "port-block-allocation" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="pool-block" className="field-label">Block size</label>
            <input id="pool-block" type="number" className="shell-input" value={draft.blockSize}
                   onChange={(e) => set("blockSize", Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="pool-blocks" className="field-label">Blocks per user</label>
            <input id="pool-blocks" type="number" className="shell-input" value={draft.numBlocksPerUser}
                   onChange={(e) => set("numBlocksPerUser", Number(e.target.value))} />
          </div>
        </div>
      )}

      {sizes && (
        <div className={`banner ${sizes.warning ? "banner-danger" : "banner-accent"}`}>
          {sizes.warning && <FiAlertTriangle size={14} className="shrink-0" />}
          <span>{sizes.warning ?? sizes.summary}</span>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="pool-intf" className="field-label">Associated interface</label>
          <MinimalSelect id="pool-intf" value={draft.associatedInterface} ariaLabel="Associated interface"
            onChange={(v) => set("associatedInterface", v)}
            options={[{ value: "", label: "Any" }, ...interfaces.map((i) => ({ value: i, label: i }))]} />
        </div>
        <div>
          <label htmlFor="pool-comments" className="field-label">Comments</label>
          <input id="pool-comments" className="shell-input" value={draft.comments}
                 onChange={(e) => set("comments", e.target.value)} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-[12px] ink-2">
        <input type="checkbox" checked={draft.arpReply}
               onChange={(e) => set("arpReply", e.target.checked)} />
        ARP reply
        <span className="t-meta">
          — on by default on the device. With it off, nothing answers ARP for this range and the
          pool is unreachable unless something else does.
        </span>
      </label>
    </div>
  );
};
