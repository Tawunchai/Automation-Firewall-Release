import React from "react";
import type { RecipientDraft } from "./recipient-form";

const RecipientFields: React.FC<{
  draft: RecipientDraft;
  setDraft: (next: RecipientDraft) => void;
  isLine: boolean;
}> = ({ draft, setDraft, isLine }) => (
  <div>
    <span className="field-label">Label</span>
    <input
      className="shell-input h-9 w-full"
      value={draft.name}
      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
      placeholder={isLine ? "NOC group" : "Network team"}
    />

    <span className="field-label mt-3">{isLine ? "LINE destination id" : "Email address"}</span>
    <input
      className="shell-input h-9 w-full font-mono text-[11.5px]"
      value={draft.target}
      onChange={(e) => setDraft({ ...draft, target: e.target.value })}
      placeholder={isLine ? "U0123456789abcdef0123456789abcdef" : "noc@example.com"}
      autoComplete="off"
    />
    {isLine && (
      <p className="field-hint">
        A userId, groupId or roomId — <span className="font-mono">U…</span>,{" "}
        <span className="font-mono">C…</span> or <span className="font-mono">R…</span> followed by
        32 hex characters. Not the display name: that is accepted by nothing and fails silently at
        3am. The bot must already have been added to the chat.
      </p>
    )}

    {isLine && (
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12px] ink-2">
        <input type="checkbox" checked={draft.isGroup}
               onChange={(e) => setDraft({ ...draft, isGroup: e.target.checked })} className="h-3.5 w-3.5" />
        This is a group or room, not one person
      </label>
    )}
  </div>
);

export default RecipientFields;
