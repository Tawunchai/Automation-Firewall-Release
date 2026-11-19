import React from "react";
import MemberPicker, { type Candidate } from "./member-picker";
import type { GroupDraft, GroupKind } from "./group-form";

// The field block shared by the Address Group and Service Group create/edit pages — name, comment,
// the member picker, and the two or three kind-specific checkboxes the old modal showed. Pulled out
// so create.tsx and edit.tsx render identically instead of each hand-rolling the same five fields.

const GroupFields: React.FC<{
  kind: GroupKind;
  draft: GroupDraft;
  setDraft: (next: GroupDraft) => void;
  candidates: Candidate[];
  candError: string | null;
}> = ({ kind, draft, setDraft, candidates, candError }) => {
  const isAddr = kind === "address";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="grp-name" className="field-label">Name</label>
          <input id="grp-name" className="shell-input" value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={isAddr ? "internal-subnets" : "web-services"} />
        </div>
        <div>
          <label htmlFor="grp-comment" className="field-label">Comment</label>
          <input id="grp-comment" className="shell-input" value={draft.comment}
            onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
            placeholder="What this group is for" />
        </div>
      </div>

      <MemberPicker
        candidates={candidates}
        value={draft.members}
        onChange={(members) => setDraft({ ...draft, members })}
        selfName={draft.name}
        noun={isAddr ? "address" : "service"}
        loadError={candError}
      />

      {isAddr ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-[12px] ink-2">
            <input type="checkbox" checked={draft.allowRouting}
              onChange={(e) => setDraft({ ...draft, allowRouting: e.target.checked })} />
            Static route configuration
            <span className="t-meta">— lets a static route name this group as its destination</span>
          </label>

          <label className="flex items-center gap-2 text-[12px] ink-2">
            <input type="checkbox" checked={draft.exclude}
              onChange={(e) => setDraft({ ...draft, exclude: e.target.checked })} />
            Exclude members
            <span className="t-meta">— subtract addresses from the group above</span>
          </label>

          {draft.exclude && (
            <MemberPicker
              candidates={candidates}
              value={draft.excludeMembers}
              onChange={(excludeMembers) => setDraft({ ...draft, excludeMembers })}
              selfName={draft.name}
              noun="address"
              loadError={candError}
            />
          )}
        </div>
      ) : (
        <label className="flex items-center gap-2 text-[12px] ink-2">
          <input type="checkbox" checked={draft.proxy}
            onChange={(e) => setDraft({ ...draft, proxy: e.target.checked })} />
          Explicit proxy group
          <span className="t-meta">— for proxy policies, not firewall policies</span>
        </label>
      )}
    </div>
  );
};

export default GroupFields;
