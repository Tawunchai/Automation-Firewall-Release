/**
 * Which rows a windowed list should render, given where it is scrolled to.
 *
 * Its own module rather than a second export from VirtualList.tsx: a file that exports a component
 * and a plain function loses Fast Refresh for the whole file. Being testable without a DOM is the
 * useful side effect — and this arithmetic is the part worth pinning, because an off-by-one here
 * is a row that never renders. On the Application Control picker that means a signature the
 * operator cannot select and cannot explain.
 */

/**
 * Rows kept above and below the viewport.
 *
 * Three is enough that a fast scroll does not show a blank band on any machine this console runs
 * on, and small enough that the saving is still most of the list. A constant rather than a prop
 * because a caller tuning it would be guessing.
 */
export const OVERSCAN = 3;

export const windowOf = (
  scrollTop: number, rowHeight: number, height: number, total: number,
): { first: number; last: number } => {
  // A zero row height would divide by zero and hand back NaN indices, which slice() turns into an
  // empty render — a picker that silently shows nothing.
  if (total === 0 || rowHeight <= 0) return { first: 0, last: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const last = Math.min(total, first + Math.ceil(height / rowHeight) + OVERSCAN * 2);
  return { first, last };
};
