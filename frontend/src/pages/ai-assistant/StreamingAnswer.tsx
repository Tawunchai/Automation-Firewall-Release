import { FiHardDrive } from "react-icons/fi";
import type { AiStreamView } from "../../contexts/AiJobContext";
import aiAssistantIcon from "../../assets/ai_assistant_icon.jpg";

// The answer as it is being written: the bubble that stands in for the assistant's message until
// the `done` event replaces it with a real transcript entry.
//
// ⚠️ EVERYTHING HERE IS A PREVIEW. The text comes from parsing HALF-WRITTEN tool-call JSON
// (parsePartialToolInput in ai_stream.go), which is why it may lag a character or show a config
// block with no `end` yet. The deployable CLI is the one on the resolved ConfigSuggestion, which
// has been through signature validation and profile de-duplication on the server — so nothing in
// this component is ever a source for a wizard draft or an Apply.
//
// Lifted out of index.tsx, which is over the repo's file-size ceiling: this is a self-contained
// piece of rendering with one input and no state.
export const StreamingAnswer = ({ view }: { view: AiStreamView | null }) => {
  const nothingYet = !view?.explanation && !view?.cli;

  return (
    <div className="flex gap-2">
      <img src={aiAssistantIcon} alt="AI assistant"
        className="h-7 w-7 shrink-0 rounded-[5px] object-cover" />

      {nothingYet ? (
        // Nothing written yet — say WHAT we are waiting for instead of bare dots. The two phases
        // feel very different to wait through: reading the device takes about a second, the model
        // tens of them.
        <div className="flex items-center gap-2 rounded-[4px] rounded-tl-sm border hairline-2 surface-sunken px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <div className="dot-muted h-1.5 w-1.5 animate-bounce rounded-full" style={{ animationDelay: "0ms" }} />
            <div className="dot-muted h-1.5 w-1.5 animate-bounce rounded-full" style={{ animationDelay: "150ms" }} />
            <div className="dot-muted h-1.5 w-1.5 animate-bounce rounded-full" style={{ animationDelay: "300ms" }} />
          </div>
          <span className="text-[11px] ink-2">
            {view?.phase === "model" ? "The model is thinking…" : "Reading live data from the device…"}
          </span>
        </div>
      ) : (
        <div className="max-w-[85%] rounded-[4px] rounded-tl-sm border hairline-2 surface-sunken px-3.5 py-2.5 text-[13px] leading-relaxed ink">
          {view.explanation && (
            <p className="whitespace-pre-wrap">
              {view.explanation}
              <span className="dot-muted ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm" />
            </p>
          )}

          {view.cli && (
            <div className="code-surface mt-2 overflow-hidden rounded-[5px] border hairline">
              <div className="code-surface-head">
                <FiHardDrive size={10} className="text-green-400" />
                <span className="text-[10px] font-semibold text-green-400">FortiOS CLI</span>
                <span className="ml-auto text-[9px] font-medium text-white/40">writing…</span>
              </div>
              <pre className="max-h-52 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-green-300">
                {view.cli}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
