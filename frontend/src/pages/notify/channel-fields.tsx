import React from "react";
import type { NotifyChannelType } from "../../api/notify";
import type { ChannelDraft } from "./channel-form";

const ChannelFields: React.FC<{
  type: NotifyChannelType;
  draft: ChannelDraft;
  setDraft: (next: ChannelDraft) => void;
  hasToken?: boolean;
}> = ({ type, draft, setDraft, hasToken }) => (
  <div>
    <span className="field-label">Name</span>
    <input className="shell-input h-9 w-full" value={draft.name}
           onChange={(e) => setDraft({ ...draft, name: e.target.value })} />

    <span className="field-label mt-3">Note (optional)</span>
    <input
      className="shell-input h-9 w-full"
      value={draft.description}
      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
      placeholder="What this channel is for"
    />

    {type === "line" ? (
      <>
        <label htmlFor="channel-access-token-configured" className="field-label mt-3">
          Channel access token {hasToken && <span className="ml-1 chip chip-ok">configured</span>}
        </label>
        <input id="channel-access-token-configured"
          className="shell-input h-9 w-full font-mono text-[11.5px]"
          value={draft.token}
          onChange={(e) => setDraft({ ...draft, token: e.target.value })}
          placeholder={hasToken ? "Leave blank to keep the stored token" : "Long-lived Messaging API token"}
          autoComplete="off"
        />
        <p className="field-hint">
          From the LINE Developers console: your Messaging API channel → <b>Channel access token
          (long-lived)</b>. It is stored encrypted and never sent back to this page.
        </p>
      </>
    ) : (
      <p className="field-hint mt-3">
        Email is sent through the account under <b>Service ▸ Email</b>. There is no separate
        password here — one place to configure means one place for it to be wrong.
      </p>
    )}
  </div>
);

export default ChannelFields;
