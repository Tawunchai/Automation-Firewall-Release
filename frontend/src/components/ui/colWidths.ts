/**
 * Turn a CSS grid track list ("1.3fr 1.4fr 0.6fr …") into `<colgroup>` widths.
 *
 * The four callers tuned these proportions against their own content — an LDAP distinguished name
 * needs several times the share of a two-character status — and table auto-layout would throw all
 * of that away and re-decide from whatever the first page of rows happens to contain. Converting
 * instead keeps the callers' prop and their intent.
 *
 * `fr` tracks share out 100%; anything else (a `120px` track) is passed through untouched, since a
 * fixed track means the caller wanted that exact width. A malformed or short list falls back to
 * equal shares rather than throwing — a width is a presentation detail and must never be the
 * reason a page fails to render.
 */
export function colWidths(tracks: string, count: number): string[] {
  const parts = tracks.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== count) {
    return Array.from({ length: count }, () => `${100 / Math.max(1, count)}%`);
  }
  const frOf = (t: string) => (t.endsWith("fr") ? Number.parseFloat(t) : NaN);
  const frTotal = parts.reduce((sum, t) => {
    const n = frOf(t);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
  return parts.map((t) => {
    const n = frOf(t);
    if (!Number.isFinite(n) || frTotal <= 0) return t;
    return `${((n / frTotal) * 100).toFixed(3)}%`;
  });
}
