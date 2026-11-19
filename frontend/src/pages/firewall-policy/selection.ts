import { useCallback, useState } from "react";

// Which policies are selected, as a hook of its own.
//
// It lives apart from bulk.tsx because that file exports components: a module that exports both a
// component and a plain function loses Fast Refresh for the whole file, so the hook that would
// have sat beside <BulkBar /> sits here instead. The same reason pool-model.ts is not inside the
// IP Pools page.

export type Selection = {
  selected: Set<number>;
  toggle: (id: number) => void;
  /** Select or clear a whole visible block — the header checkbox. */
  setMany: (ids: number[], on: boolean) => void;
  clear: () => void;
};

export const useSelection = (): Selection => {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const setMany = useCallback((ids: number[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => { if (on) next.add(id); else next.delete(id); });
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, toggle, setMany, clear };
};
