import type { NotifyRecipientPayload } from "../../api/notify";

// Shared state for the recipient create page — pulled out of the old RecipientForm modal in
// channels.tsx. There is no edit page: the list only ever toggled enabled/disabled or deleted, and
// the old modal never offered a rename either.

export type RecipientDraft = {
  name: string;
  target: string;
  isGroup: boolean;
};

export const BLANK_RECIPIENT: RecipientDraft = { name: "", target: "", isGroup: false };

export const buildRecipientPayload = (d: RecipientDraft, channelId: number): NotifyRecipientPayload => ({
  notify_channel_id: channelId,
  name: d.name.trim() || d.target.trim(),
  target: d.target.trim(),
  is_group: d.isGroup,
});
