import React, { useState } from "react";
import Modal from "./Modal";
import { FiMaximize2 } from "react-icons/fi";

interface DiffViewProps {
  text: string;
  maxHeight?: string;
  title?: string;
  // summaryOnly renders just the "+N -M lines · Expand" header (no inline diff), so a large
  // deploy result stays light — the full colourised diff is one click away in the modal.
  summaryOnly?: boolean;
}

/** Color unified diff lines: + green / - red / @@ purple / # gray */
const renderLines = (text: string) =>
  text.split("\n").map((l, i) => {
    let color = "inherit";
    let bg = "transparent";
    // Tokens, not literals: this renders in Config Drift, the Change Ledger and the rollback
    // review, and the paper-white tints these replaced were unreadable in dark mode. The light
    // theme's values are the same colours as before. See --diff-* in index.css.
    if (l.startsWith("+") && !l.startsWith("+++")) { color = "var(--diff-add-ink)"; bg = "var(--diff-add-bg)"; }
    else if (l.startsWith("-") && !l.startsWith("---")) { color = "var(--diff-del-ink)"; bg = "var(--diff-del-bg)"; }
    else if (l.startsWith("@@")) { color = "var(--diff-hunk-ink)"; bg = "var(--diff-hunk-bg)"; }
    else if (l.startsWith("#") || l.startsWith("---") || l.startsWith("+++")) { color = "var(--diff-meta-ink)"; }
    return (
      <div key={i} style={{ color, background: bg, whiteSpace: "pre-wrap", wordBreak: "break-all", minHeight: "1.4em" }}>
        {l || " "}
      </div>
    );
  });

const DiffView: React.FC<DiffViewProps> = ({ text, maxHeight = "16rem", title = "Config Diff", summaryOnly = false }) => {
  const [open, setOpen] = useState(false);

  if (!text) return null;

  const lines = text.split("\n").length;
  const added   = text.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removed = text.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

  return (
    <>
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: summaryOnly ? 0 : 4 }}>
          <span style={{ fontSize: 11, color: "#64748b" }}>
            {lines} lines
            {added > 0 && <span style={{ color: "#16a34a", marginLeft: 6 }}>+{added}</span>}
            {removed > 0 && <span style={{ color: "#dc2626", marginLeft: 4 }}>-{removed}</span>}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ink-2 hover-ink inline-flex items-center gap-1 rounded px-1 text-[11px] font-semibold transition"
          >
            <FiMaximize2 size={11} /> {summaryOnly ? "View diff" : "Expand"}
          </button>
        </div>
        {!summaryOnly && (
          <pre
            className="overflow-auto rounded-[4px] surface-sunken p-2 text-[12px] leading-snug dark:bg-black/30"
            style={{ fontFamily: "monospace", margin: 0, maxHeight }}
          >
            {renderLines(text)}
          </pre>
        )}
      </div>

      <Modal
        title={title}
        open={open}
        onClose={() => setOpen(false)}
        width="max-w-[80vw]"
        bodyClassName="p-0"
        footer={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
            Close
          </button>
        }
      >
        <div style={{ padding: "0 16px 8px" }}>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            {lines} lines
            {added > 0 && <span style={{ color: "#16a34a", marginLeft: 8 }}>+{added} added</span>}
            {removed > 0 && <span style={{ color: "#dc2626", marginLeft: 6 }}>-{removed} removed</span>}
          </span>
        </div>
        <pre
          style={{
            fontFamily: "monospace", fontSize: 13, margin: 0,
            padding: "0 16px 16px", maxHeight: "75vh", overflow: "auto",
            background: "#0f172a", color: "#e2e8f0",
          }}
        >
          {text.split("\n").map((l, i) => {
            let color = "#e2e8f0";
            let bg = "transparent";
            if (l.startsWith("+") && !l.startsWith("+++")) { color = "#86efac"; bg = "#14532d22"; }
            else if (l.startsWith("-") && !l.startsWith("---")) { color = "#fca5a5"; bg = "#7f1d1d22"; }
            else if (l.startsWith("@@")) { color = "#c084fc"; }
            else if (l.startsWith("#") || l.startsWith("---") || l.startsWith("+++")) { color = "#94a3b8"; }
            return (
              <div key={i} style={{ color, background: bg, whiteSpace: "pre-wrap", wordBreak: "break-all", minHeight: "1.5em" }}>
                {l || " "}
              </div>
            );
          })}
        </pre>
      </Modal>
    </>
  );
};

export default DiffView;
