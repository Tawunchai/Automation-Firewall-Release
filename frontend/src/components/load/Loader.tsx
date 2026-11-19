import { createPortal } from "react-dom";

// The console's loading indicator: a progress bar across the very top of the window.
//
// It has been a spinning ring and then a packet-flow mark, and both had the same problem — they sat
// in the middle of the screen behind a dark scrim, so every route change blacked the console out
// for a few hundred milliseconds. That is a heavy way to say "one more second".
//
// A top bar is the pattern GitHub, YouTube and most consoles use, and the reason is not fashion:
// it is OUT OF THE WAY. There is no scrim, the page underneath stays readable, and the bar cannot
// intercept a click (pointer-events: none). Loading stops being an interruption and becomes a
// status line.
//
// HOW THE MOTION IS BUILT. Nothing here knows real progress — the fallback is mounted while a lazy
// route chunk downloads and unmounted when it arrives. So the fill TRICKLES: it moves quickly to
// about a third, then decelerates hard and creeps towards 92%, which it reaches after twelve
// seconds and never passes. Two properties of that curve matter:
//
//   · it never reaches 100%, because completion is the unmount, not a keyframe. A bar that filled
//     and sat there would claim to be finished while the page was still blank;
//   · it is fastest at the start, which is when a fast load finishes — so a quick navigation reads
//     as a confident sweep rather than as a bar that barely moved.
//
// `width` is animated rather than `transform: scaleX`, which would be cheaper. It has to be: the
// glowing head is a child pinned to the fill's right edge, and scaling the parent would squash it
// into a smear. At 3px tall over one element the layout cost is not measurable.

type LoaderProps = {
  /** Thickness basis in px. The bar is about a tenth of this — 3px at the default. */
  size?: number;
  /** Pin to the top of the viewport. Off renders the bar inline, filling its container. */
  overlay?: boolean;
  /** Optional text. Shown as a small pill under the bar; most callers want none. */
  label?: string;
};

/** How long the trickle takes to crawl to its ceiling. Long on purpose — see the note above. */
const TRICKLE = "12s";

const CSS = `
/* The starting width lives here rather than in the inline style, and it has to. An inline
   declaration outranks every rule in this sheet, so an inline zero width would beat the
   reduced-motion rule at the bottom and leave those viewers with an invisible bar. */
.loader-fill { width: 0; }

/* Fast at the start, then decelerating hard. The stops are hand-placed rather than eased by a
   single cubic-bezier so the first third is genuinely quick and the tail is genuinely slow. */
@keyframes loader-trickle {
  0%   { width: 0%; }
  1%   { width: 8%; }
  6%   { width: 24%; }
  14%  { width: 38%; }
  26%  { width: 52%; }
  42%  { width: 64%; }
  62%  { width: 74%; }
  100% { width: 92%; }
}

/* A highlight travelling along the filled part, so the bar reads as moving even once the trickle
   has slowed to a crawl. Without it a slow load looks like a stalled one. */
@keyframes loader-sweep {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(340%); }
}

@keyframes loader-fade { 0%,100% { opacity: .55 } 50% { opacity: 1 } }

@media (prefers-reduced-motion: reduce) {
  /* Still a bar, still clearly busy — it just does not travel. */
  .loader-fill  { animation: none; width: 38%; }
  .loader-sweep { animation: none; opacity: 0; }
  .loader-label { animation: none; }
}`;

const Bar: React.FC<{ size: number; overlay: boolean; label?: string }> = ({ size, overlay, label }) => {
  const h = Math.max(2, Math.round(size * 0.09));

  return (
    <>
      {/* The track. Faint rather than invisible: it shows how far the fill has to go, which is what
          makes the fill's position mean anything. */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "color-mix(in srgb, var(--accent) 14%, transparent)",
        }}
      />

      <span
        className="loader-fill"
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          overflow: "hidden",
          background: "var(--accent)",
          borderRadius: overlay ? `0 ${h}px ${h}px 0` : h,
          boxShadow: `0 0 ${h * 3}px color-mix(in srgb, var(--accent) 70%, transparent)`,
          animation: `loader-trickle ${TRICKLE} linear forwards`,
        }}
      >
        <span
          className="loader-sweep"
          style={{
            position: "absolute",
            inset: 0,
            width: "30%",
            background:
              "linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 30%, white) 55%, transparent)",
            animation: "loader-sweep 1.15s ease-in-out infinite",
          }}
        />
      </span>

      {/* The head. A separate element pinned to the fill's leading edge — this is the reason the
          fill animates width instead of scaleX, which would flatten this into a streak. */}
      <span
        className="loader-fill"
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          animation: `loader-trickle ${TRICKLE} linear forwards`,
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            position: "absolute",
            right: 0,
            top: "50%",
            width: h * 14,
            height: h * 2.2,
            marginTop: h * -1.1,
            borderRadius: "9999px",
            background:
              "linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 65%, white))",
            filter: `blur(${h * 0.7}px)`,
            opacity: 0.9,
          }}
        />
      </span>

      {label && (
        <span
          className="loader-label"
          style={{
            position: "absolute",
            top: h + 8,
            left: "50%",
            transform: "translateX(-50%)",
            borderRadius: 9999,
            border: "1px solid var(--shell-border)",
            background: "var(--shell-card)",
            boxShadow: "var(--shell-elev)",
            padding: "3px 10px",
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: 0.2,
            whiteSpace: "nowrap",
            color: "var(--shell-ink-2, #5b6478)",
            animation: "loader-fade 1.6s ease-in-out infinite",
          }}
        >
          {label}
        </span>
      )}
    </>
  );
};

const Loader: React.FC<LoaderProps> = ({ size = 34, overlay = true, label }) => {
  const h = Math.max(2, Math.round(size * 0.09));

  const content = (
    <div
      role="status"
      aria-live="polite"
      aria-label={label ?? "Loading"}
      style={
        overlay
          ? {
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            height: h,
            zIndex: 99999,
            // The whole point of this shape: it never swallows a click, so the page underneath
            // stays usable while the next chunk downloads.
            pointerEvents: "none",
          }
          : { position: "relative", width: "100%", height: h, margin: "24px 0", borderRadius: h }
      }
    >
      <Bar size={size} overlay={overlay} label={label} />
      <style>{CSS}</style>
    </div>
  );

  // Portalled so `position: fixed` anchors to the viewport rather than to whichever ancestor
  // happens to have a transform on it.
  return overlay ? createPortal(content, document.body) : content;
};

export default Loader;
