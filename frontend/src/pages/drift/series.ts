import { useMemo } from "react";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { metricHues } from "../dashboard/kpi.logic";

// The page's two identities — "through this console" and "outside the console" — in ONE place.
//
// The tiles, the list's origin tags, the guide and both charts all wear these, so a reader who
// learns the colours anywhere on the page can read them everywhere. They are the dashboard's
// validated METRIC_HUES pair (slots 1–2), light and dark each validated against its own surface.

export type SeriesHues = { consoleHue: string; outsideHue: string };

export const useSeriesHues = (): SeriesHues => {
  const { currentMode } = useStateContext();
  return useMemo(() => {
    const [consoleHue, outsideHue] = metricHues(currentMode);
    return { consoleHue, outsideHue };
  }, [currentMode]);
};
