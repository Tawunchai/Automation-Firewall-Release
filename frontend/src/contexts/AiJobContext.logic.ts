// The AI job context object and the `useAiJob` hook.
//
// The provider stays in AiJobContext.tsx. This one matters more than most: the job it tracks
// survives navigation on purpose, so a module reload that threw the context away would lose a
// request that is still running on the server.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

import { createContext, useContext } from "react";
import { type ChatMessage, type AttachedImage } from "../api/ai";
import { type AiJob } from "./aiJob";

export type StartArgs = {
  deviceId: number;
  /** Shown in the transcript. */
  prompt: string;
  /** What actually goes to the model — may carry injected live CLI output. */
  sentPrompt: string;
  history: ChatMessage[];
  /** Images attached to THIS turn (not history). Sent to Claude alongside sentPrompt. */
  images?: AttachedImage[];
};

export type AiJobContextValue = {
  job: AiJob | null;
  start: (args: StartArgs) => void;
  /**
   * Take a FINISHED job and clear it. Returns null while one is still running, so a caller cannot
   * consume half an answer. Claiming is what stops the same reply being appended twice when the
   * page re-mounts.
   */
  claim: () => AiJob | null;
  /** Abandon whatever is in flight — used when the user clears the conversation. */
  cancel: () => void;
};

export const AiJobContext = createContext<AiJobContextValue | null>(null);

export const useAiJob = (): AiJobContextValue => {
  const ctx = useContext(AiJobContext);
  if (!ctx) throw new Error("useAiJob must be used inside <AiJobProvider>");
  return ctx;
};
