import { baseApi } from "./http";

/** One action with its all-time count. */
export type ActionCount = { action: string; count: number };

/** One calendar day (YYYY-MM-DD, UTC) with its event count. */
export type DayCount = { date: string; count: number };

/**
 * Aggregate counts for the Users page charts.
 *
 * These come from their own endpoint rather than from the paginated activity-log list — the panels
 * used to compute an "all time" total from whatever fitted in the default 50-row page. The server
 * counts with GROUP BY instead, so the numbers are exact and the payload does not grow with the
 * account's history.
 */
export type ActivitySummary = {
  total: number;
  actions: ActionCount[];
  /** One entry per day of the window, including empty days, oldest first. */
  days: DayCount[];
  window_days: number;
};

const EMPTY_SUMMARY: ActivitySummary = { total: 0, actions: [], days: [], window_days: 14 };

export const GetMyActivityLogSummary = async (days = 14): Promise<ActivitySummary> => {
  try {
    const response = await baseApi.get("/activity-logs/summary", { params: { days } });
    const d = response.data?.data;
    if (!d) return EMPTY_SUMMARY;
    return {
      total: d.total ?? 0,
      actions: d.actions ?? [],
      days: d.days ?? [],
      window_days: d.window_days ?? days,
    };
  } catch (error) {
    console.error("GetMyActivityLogSummary error:", error);
    return EMPTY_SUMMARY;
  }
};
