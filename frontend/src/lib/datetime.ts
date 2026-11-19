// One place the console turns a timestamp into text.
//
// Every date on screen used to be `new Date(x).toLocaleString()`, which follows the BROWSER's
// locale. On a Thai-configured machine that renders 2026 as 2569 — the Buddhist era — so the
// console shipped dates in a calendar the rest of it never mentions, and the Audit / Review report
// stamped "19/8/2569" onto a document meant to be handed to an auditor. A date an auditor cannot
// take at face value is worse than no date.
//
// The fix is to pin the calendar rather than to translate it: en-GB with an explicit month name.
// "19 Aug 2026, 15:11:31" cannot be misread as an American 8/19, cannot be misread as a Buddhist
// year, and matches the English-only rule the rest of the UI follows.
//
// Numbers are deliberately NOT covered here. `n.toLocaleString()` on a number only chooses digit
// grouping, which is the one thing a viewer's locale should decide.

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
};

const DATE_ONLY: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };

const TIME_ONLY: Intl.DateTimeFormatOptions = {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
};

/** The locale is fixed on purpose — see the note above. Never read it from the browser. */
const LOCALE = "en-GB";

const toDate = (value: string | number | Date | null | undefined): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "19 Aug 2026, 15:11:31" — the default for anything with a time component. */
export const formatDateTime = (value: string | number | Date | null | undefined, fallback = "—"): string => {
  const d = toDate(value);
  return d ? d.toLocaleString(LOCALE, DATE_TIME) : fallback;
};

/** "19 Aug 2026" */
export const formatDate = (value: string | number | Date | null | undefined, fallback = "—"): string => {
  const d = toDate(value);
  return d ? d.toLocaleDateString(LOCALE, DATE_ONLY) : fallback;
};

/** "15:11:31" — for a live readout where the date is already established. */
export const formatTime = (value: string | number | Date | null | undefined, fallback = "—"): string => {
  const d = toDate(value);
  return d ? d.toLocaleTimeString(LOCALE, TIME_ONLY) : fallback;
};
