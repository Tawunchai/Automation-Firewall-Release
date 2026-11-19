import type { NotifyChannel, NotifyChannelPayload, NotifyChannelType } from "../../api/notify";

// Shared state and payload-building for the channel create and edit pages — pulled out of the old
// ChannelForm modal in channels.tsx. The token is write-only: blank on an update means "leave the
// stored token alone", which is why it never gets pre-filled from channelToDraft.

export type ChannelDraft = {
  name: string;
  description: string;
  token: string;
};

export const blankChannelDraft = (type: NotifyChannelType): ChannelDraft => ({
  name: type === "line" ? "LINE alerts" : "Email alerts",
  description: "",
  token: "",
});

export const channelToDraft = (ch: NotifyChannel): ChannelDraft => ({
  name: ch.name,
  description: ch.description,
  token: "",
});

export const buildChannelCreatePayload = (d: ChannelDraft, type: NotifyChannelType): NotifyChannelPayload => ({
  name: d.name, type, description: d.description, token: d.token || undefined,
});

export const buildChannelUpdatePayload = (d: ChannelDraft): NotifyChannelPayload => ({
  name: d.name, description: d.description, token: d.token || undefined,
});
