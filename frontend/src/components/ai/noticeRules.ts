import type { AiJob } from "../../contexts/aiJob";

// When the "your answer is ready" popup should appear, kept apart from the component that draws it.
//
// The rules read as obvious and every one of them is a bug that would otherwise be invisible:
// a popup raised while the answer is still streaming, one raised on the page that is already
// showing the answer, and — the loud one — one raised again on every re-render because nothing
// remembered it had already been shown. The AI provider re-publishes its job object every 80ms
// while a model writes, so "announce on change" without an identity check means ~375 popups per
// answer.

export type AiNoticeKind = "done" | "error";

export type AiNotice = {
  /** The job's id. Also the de-duplication key — one notice per job, ever. */
  id: string;
  kind: AiNoticeKind;
  /** What the user asked, for the popup's body line. */
  prompt: string;
  /** The failure reason on an error notice; "" on a successful one. */
  detail: string;
};

export type AiNoticeInput = {
  job: AiJob | null;
  /** True while the AI Assistant page itself is open — it renders the answer, so nothing to say. */
  onAiPage: boolean;
  /** The id of the job already announced, or null. */
  announcedId: string | null;
};

/**
 * The notice to raise now, or null.
 *
 * Pure, and deliberately total: every "no" is a case rather than a fallthrough, so adding a state
 * to AiJob makes this fail a test instead of silently going quiet.
 */
export const nextNotice = ({ job, onAiPage, announcedId }: AiNoticeInput): AiNotice | null => {
  if (!job) return null;
  // Half an answer is not an answer.
  if (job.status === "running") return null;
  // The page the notice would point at is already open.
  if (onAiPage) return null;
  // Already announced — the provider republishes the same finished job whenever anything upstream
  // re-renders, and a job stays parked until the AI page claims it.
  if (announcedId === job.id) return null;

  return {
    id: job.id,
    kind: job.status === "error" ? "error" : "done",
    prompt: job.prompt,
    detail: job.status === "error" ? (job.error ?? "The AI request failed") : "",
  };
};

/** The popup's headline. */
export const noticeTitle = (kind: AiNoticeKind): string =>
  kind === "error" ? "The AI request failed" : "Your AI proposal is ready";

/** The line under it: the failure reason, or the question that was asked. */
export const noticeBody = (n: AiNotice): string => {
  const text = n.kind === "error" ? n.detail : n.prompt;
  return text.trim() || (n.kind === "error" ? "No reason given" : "Open the assistant to review it");
};

/** How long a notice stays on screen. Long enough to read a question back, short enough to ignore. */
export const NOTICE_MS = 12_000;

/** The route the notice takes you to. */
export const AI_PAGE_PATH = "/admin/ai-assistant";

/** Whether a pathname counts as "the AI Assistant page is open". */
export const isAiPagePath = (pathname: string): boolean =>
  pathname === AI_PAGE_PATH || pathname.startsWith(`${AI_PAGE_PATH}/`);
