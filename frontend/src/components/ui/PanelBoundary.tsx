import React from "react";
import { FiAlertOctagon } from "react-icons/fi";

// A crash inside one panel must not take the console with it.
//
// WHY THIS EXISTS. The Audit page's remediation drawer read `preview.questions.length` on a field
// the server was sending as `null`. That is an ordinary bug and it was fixed at the source — but
// what it DID was unmount the entire React tree, and the operator was left looking at a white
// browser window on /admin/audit with no sidebar, no navbar and no way to tell what had happened.
// A page that shows a firewall's compliance state should not be one exception away from showing
// nothing at all.
//
// So the failure is contained: the panel is replaced by a short message naming the error, and
// everything around it keeps working. React only catches errors thrown while RENDERING — an
// exception inside a click handler or a promise still escapes — which is exactly why the data-level
// fix matters too. This is the floor, not the plan.
//
// Deliberately no retry button. A component that just threw on this data will throw again on the
// same data; the honest options are to reload or to change what is being asked for, and both are
// things the reader already has.

type Props = {
  /** What this panel is, for the message. "the remediation panel", not "Component". */
  what: string;
  children: React.ReactNode;
};

type State = { error: Error | null };

class PanelBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Logged rather than swallowed: the message on screen is deliberately short, and whoever is
    // debugging needs the stack and the component that threw.
    console.error(`[${this.props.what}] crashed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-[4px] border px-3.5 py-3"
        style={{ borderColor: "#ef444440", background: "#ef444410" }}>
        <p className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: "#b91c1c" }}>
          <FiAlertOctagon size={13} /> {this.props.what} could not be shown
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed ink-2">
          Something in it failed to render. The rest of this page is unaffected — reload to try
          again, and if it keeps happening the message below is what to report.
        </p>
        <p className="mt-1.5 font-mono text-[10.5px] ink-3">{this.state.error.message}</p>
      </div>
    );
  }
}

export default PanelBoundary;
