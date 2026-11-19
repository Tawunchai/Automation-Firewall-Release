import React from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { pageCount, pageRange, ROWS_PER_PAGE } from "./format";

/**
 * The pager under the log table.
 *
 * Deliberately small: Previous, the page it is on, Next, and the span it is showing. A numbered
 * strip of page buttons was the alternative and it is worse here — a log is read newest-first and
 * scanned, not indexed, so nobody wants "page 7 of 11"; they want the next screenful.
 *
 * Paging is over rows ALREADY IN MEMORY (see ROWS_PER_PAGE), so both buttons act instantly and
 * neither costs a round trip to the firewall.
 */
const LogPager: React.FC<{
  /** Total rows after filtering — not the device's count. */
  total: number;
  /** 0-based. The caller keeps it clamped; this only reads it. */
  index: number;
  onChange: (index: number) => void;
  perPage?: number;
}> = ({ total, index, onChange, perPage = ROWS_PER_PAGE }) => {
  const pages = pageCount(total, perPage);
  const range = pageRange(total, index, perPage);

  // One page of results needs no pager, and an empty table needs one even less. Rendering a
  // disabled Previous/Next pair under three rows is furniture, not information.
  if (total === 0 || pages <= 1) {
    return (
      <span className="t-meta tnum" aria-live="polite">
        {total === 0 ? "No entries" : `${range.total} entries`}
      </span>
    );
  }

  const atStart = index <= 0;
  const atEnd = index >= pages - 1;

  return (
    <div className="flex items-center gap-2">
      {/* aria-live so a screen reader is told the span changed — pressing Next moves rows that are
          already on screen, with no navigation for it to announce on its own. */}
      <span className="t-meta tnum" aria-live="polite">
        {range.from}–{range.to} of {range.total}
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-ghost btn-sm hairline gap-1 border"
          onClick={() => onChange(index - 1)}
          disabled={atStart}
          aria-label="Previous page"
        >
          <FiChevronLeft size={12} />
          Previous
        </button>

        <span className="t-meta tnum px-1.5">
          {index + 1} / {pages}
        </span>

        <button
          type="button"
          className="btn btn-ghost btn-sm hairline gap-1 border"
          onClick={() => onChange(index + 1)}
          disabled={atEnd}
          aria-label="Next page"
        >
          Next
          <FiChevronRight size={12} />
        </button>
      </div>
    </div>
  );
};

export default LogPager;
