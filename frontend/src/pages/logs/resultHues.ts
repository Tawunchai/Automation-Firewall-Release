import { useMemo } from "react";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import type { ResultGroup } from "./story";

// The three result colours the tiles, both charts and the table share, so "blocked" is the same
// colour everywhere on the page.
//
// Validated with the dataviz palette validator, light and dark separately, against each mode's card
// surface (#ffffff / #0f141e) — all checks pass in both. The first try, amber #F59E0B + red #DC2626,
// failed in dark mode: the two were under the normal-vision floor, too close to tell apart. The red
// is a rose (#E11D48) for that reason. Blocked and reset are status-like, so every place these
// appear also carries a word — never colour alone.
const HUES: Record<"Light" | "Dark", Record<ResultGroup, string>> = {
  Light: { ok: "#845ADF", problem: "#D97706", blocked: "#E11D48" },
  Dark: { ok: "#8B5CF6", problem: "#D97706", blocked: "#E11D48" },
};

export const useResultHues = (): Record<ResultGroup, string> => {
  const { currentMode } = useStateContext();
  return useMemo(() => HUES[currentMode === "Dark" ? "Dark" : "Light"], [currentMode]);
};
