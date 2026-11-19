// useNotifyChannels: the hook behind the Notify channels panel.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ListNotifyChannels, type NotifyChannel } from "../../api/notify";

/** Loads the channel list. Kept here so the tab owns its own data. */
export const useNotifyChannels = () => {
  const [channels, setChannels] = useState<NotifyChannel[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setChannels(await ListNotifyChannels());
    } catch {
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const recipients = useMemo(() => channels.flatMap((c) => c.recipients), [channels]);
  return { channels, recipients, loading, reload };
};
