import React, { useCallback, useRef, useState } from "react";
import { windowOf } from "./virtualWindow";

// A windowed list: renders the rows the viewport can show, plus a margin, and nothing else.
//
// ── What it is for, and what it is NOT for ───────────────────────────────────
//
// One list in this console is genuinely long: the Application Control signature picker, which is
// ~2,414 rows of six columns each. Every one of them was in the DOM, inside a 288px scroll box, on
// a drawer that opens from a form — around 15,000 elements to build before the drawer could paint,
// re-built whenever the search box was typed in.
//
// It is not for tables of tens of rows. Windowing costs a wrapper, a scroll listener and a fixed
// row height, and a policy table of ten rules pays all three for nothing. The threshold is in the
// caller: reach for this when a list can plausibly be thousands, not when it can be dozens.
//
// ── The one constraint ───────────────────────────────────────────────────────
//
// Every row must be exactly `rowHeight` tall. That is what makes the arithmetic a division instead
// of a measurement pass, and it is why this is forty lines rather than a library. A caller whose
// rows wrap to two lines will see them overlap — so the row content has to truncate, which is what
// a picker row should do anyway.
//
// Searching and filtering happen in the CALLER, on the array. This component never sees a query:
// it renders a window onto whatever array it is handed, so a filter is just a shorter array and
// the scroll position resets naturally.

type Props<T> = {
  rows: T[];
  /** Fixed, in px. Must match what `render` actually produces. */
  rowHeight: number;
  /** The scroll box's height, in px. */
  height: number;
  render: (row: T, index: number) => React.ReactNode;
  /** React key for a row. */
  keyOf: (row: T, index: number) => React.Key;
  /** Shown instead of the window when there is nothing to show. */
  empty?: React.ReactNode;
  className?: string;
};

function VirtualList<T>({ rows, rowHeight, height, render, keyOf, empty, className }: Props<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  if (rows.length === 0) {
    return <div style={{ height }} className={className}>{empty}</div>;
  }

  const { first, last } = windowOf(scrollTop, rowHeight, height, rows.length);

  return (
    <div ref={ref} onScroll={onScroll} style={{ height, overflowY: "auto" }} className={className}>
      {/* The spacer gives the scrollbar the full list's height; the window is positioned inside
          it. Without this the bar would describe only the rows that happen to be rendered. */}
      <div style={{ height: rows.length * rowHeight, position: "relative" }}>
        <div style={{ position: "absolute", top: first * rowHeight, left: 0, right: 0 }}>
          {rows.slice(first, last).map((row, i) => (
            <div key={keyOf(row, first + i)} style={{ height: rowHeight }}>
              {render(row, first + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default VirtualList;
