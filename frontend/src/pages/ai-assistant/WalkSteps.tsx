import React, { type RefObject } from "react";
import type { SimStage } from "./packetSim";

// The stage chips under both simulation views — and, since the transport went, the only control
// either of them has.
//
// WHAT WAS HERE AND WHY IT LEFT. A progress bar, a running clock ("3.56s") and a 0.5×/1×/2× speed
// switch. All three described the drawing as a recording: a thing with a length, a position within
// that length, and a playback rate. The drawing is not a recording — packets now stream through the
// rule base continuously, several in the air at once, the way traffic actually arrives. A progress
// bar over that is measuring something that has no end, a clock is counting something nobody is
// timing, and a speed switch offers a choice between "too fast to read" and "half speed", which is
// not a choice. See walkClock.ts.
//
// WHAT STAYED. The stages the run is made of, as buttons. They are the only control that answers a
// question the animation cannot — "show me the policy lookup again" — and they name the moment
// rather than a percentage of it. Shared by both views for the same reason the clock is: the
// overview in the panel and the walk in full screen are two pictures of one run, and a viewer who
// expands from one to the other should not meet a different set of controls.

export const WalkSteps: React.FC<{
  stages: SimStage[];
  /** Namespaces the data attributes, so two views of two runs never light each other's chips. */
  owner: string;
  onSeek: (ms: number) => void;
  noteRef: RefObject<HTMLParagraphElement | null>;
}> = ({ stages, owner, onSeek, noteRef }) => (
  <>
    <div className="flex flex-wrap gap-1 border-t hairline-2 px-3 pt-2">
      {stages.map((s, i) => (
        <button key={s.id} type="button" data-walkstep={s.id} data-owner={owner}
          onClick={() => onSeek(s.from + 1)}
          title={`Walk the rule table again from "${s.title}"`}
          className="walk-step flex items-baseline gap-1.5 rounded-[4px] border hairline-2 px-2 py-1 text-[10.5px] font-semibold ink-3 transition surface-hover hover-ink">
          <span className="font-mono text-[9.5px]">{i + 1}</span>{s.title}
        </button>
      ))}
    </div>
    <p ref={noteRef} className="px-3 pb-3 pt-2 text-[11.5px] leading-relaxed ink-2" />
  </>
);

export default WalkSteps;
