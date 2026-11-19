import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FiCpu, FiAlertTriangle, FiArrowRight, FiX } from "react-icons/fi";
import { useAiJob } from "../../contexts/AiJobContext.logic";
import { NAVBAR_H } from "../structure/navbar/index";
import {
  nextNotice, noticeTitle, noticeBody, NOTICE_MS, AI_PAGE_PATH, isAiPagePath,
  type AiNotice,
} from "./noticeRules";

// "Your AI proposal is ready" — the popup that slides in from the right, under the navbar.
//
// WHY IT EXISTS
// An AI request takes ~30 seconds and already survives navigation (contexts/AiJobContext), so the
// sensible thing to do is walk away and work on something else. The trouble was that nothing ever
// said it had finished: the answer sat parked, silently, until the user happened to open the
// assistant again. This is the missing half of that feature.
//
// WHY IT DOES NOT USE `message` (components/ui/toast)
// A toast is for the consequence of something you just did — it appears where your attention
// already is and it is gone in three seconds. This is the opposite: it arrives for work you
// started minutes ago, on a page that has nothing to do with it, and it has somewhere to take you.
// So it waits ~12s, it names the question back to you, and clicking it navigates. It is still
// small: uninvited chrome on someone else's page has to earn its space.
//
// WHAT IT MUST NOT DO
// **Claim the job.** Claiming is what hands the answer to the transcript, and it can only happen
// once — doing it here would consume the reply and the assistant would open showing nothing. This
// only reads `job`; the page still claims it on arrival, whether the user got here by clicking the
// popup or by their own route.

const AiJobNotice: React.FC = () => {
  const { job } = useAiJob();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onAiPage = isAiPagePath(pathname);

  const [notice, setNotice] = useState<AiNotice | null>(null);
  /** Drives the enter/leave transition; separate from `notice` so the exit can be animated. */
  const [shown, setShown] = useState(false);
  /** Every job id already announced. Without it the popup reappears on every provider publish. */
  const announcedRef = useRef<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paused, setPaused] = useState(false);

  const clearTimers = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    if (dropTimer.current) { clearTimeout(dropTimer.current); dropTimer.current = null; }
  };

  /** Slide out, then unmount once the transition has played. */
  const dismiss = useCallback(() => {
    clearTimers();
    setShown(false);
    dropTimer.current = setTimeout(() => setNotice(null), 240);
  }, []);

  const open = useCallback(() => {
    dismiss();
    navigate(AI_PAGE_PATH);
  }, [dismiss, navigate]);

  // Raise a notice when a job finishes somewhere other than the assistant.
  useEffect(() => {
    const next = nextNotice({ job, onAiPage, announcedId: announcedRef.current });
    if (!next) return;
    announcedRef.current = next.id;
    clearTimers();
    setNotice(next);
    // Two frames: mount at translateX(110%), then flip to 0 so the browser has something to
    // transition FROM. Setting both in one commit paints it already in place.
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
  }, [job, onAiPage]);

  // Walking to the assistant makes the popup redundant — the answer is right there.
  useEffect(() => {
    if (onAiPage && notice) dismiss();
  }, [onAiPage, notice, dismiss]);

  // The auto-dismiss clock, paused while the pointer is over the card so a popup cannot expire
  // out from under someone reading it.
  useEffect(() => {
    if (!notice || !shown || paused) return;
    hideTimer.current = setTimeout(dismiss, NOTICE_MS);
    return () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
  }, [notice, shown, paused, dismiss]);

  useEffect(() => clearTimers, []);

  if (!notice) return null;

  const isError = notice.kind === "error";
  // Green on success, red on failure. Not `--accent`: the accent is a personalisation colour that
  // says nothing about outcome — with a red accent a finished proposal looked like a failure.
  // #10b981 is the same green the shell already uses for "online" / "ok".
  const tone = isError ? "#ef4444" : "#10b981";

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{
        position: "fixed",
        // Under the navbar, which is sticky at the top of the scroll container.
        top: NAVBAR_H + 12,
        right: 16,
        zIndex: 45,
        // Deliberately small. It is a signpost that arrives uninvited on an unrelated page, so it
        // has to be readable at a glance and take almost no room while doing it.
        width: "min(290px, calc(100vw - 28px))",
        transform: shown ? "translateX(0)" : "translateX(110%)",
        opacity: shown ? 1 : 0,
        transition: "transform .28s cubic-bezier(.22,1,.36,1), opacity .28s ease",
        borderRadius: 12,
        border: "1px solid var(--shell-border)",
        borderLeft: `3px solid ${tone}`,
        background: "var(--shell-card)",
        boxShadow: "var(--shell-elev, 0 8px 24px -10px rgba(15,23,42,.24))",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={open}
        style={{
          display: "flex", gap: 9, alignItems: "flex-start",
          width: "100%", padding: "9px 26px 9px 10px", textAlign: "left", background: "transparent",
          border: 0, cursor: "pointer",
        }}
      >
        <span
          style={{
            display: "grid", placeItems: "center", flexShrink: 0,
            width: 24, height: 24, borderRadius: 8,
            background: `color-mix(in srgb, ${tone} 14%, transparent)`,
            color: tone,
          }}
        >
          {isError ? <FiAlertTriangle size={13} /> : <FiCpu size={13} />}
        </span>

        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="ink" style={{ display: "block", fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>
            {noticeTitle(notice.kind)}
          </span>
          {/* One line then an ellipsis: a question can be a paragraph, and the popup is a
              signpost rather than a transcript. */}
          <span
            className="ink-3"
            style={{
              display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical",
              overflow: "hidden", marginTop: 1, fontSize: 11, lineHeight: 1.4,
            }}
          >
            {noticeBody(notice)}
          </span>
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              marginTop: 5, fontSize: 10.5, fontWeight: 600, color: tone,
            }}
          >
            Open AI Assistant <FiArrowRight size={10} />
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="ink-3 surface-hover"
        style={{
          position: "absolute", top: 6, right: 6,
          display: "grid", placeItems: "center", width: 18, height: 18,
          borderRadius: 6, border: 0, background: "transparent", cursor: "pointer",
        }}
      >
        <FiX size={11} />
      </button>

      {/* The remaining time, as a bar that drains. It stops when the clock does, which is what
          makes hovering to read feel like it worked. */}
      <span
        key={`${notice.id}-${paused}`}
        style={{
          display: "block", height: 2, background: tone, opacity: 0.55,
          transformOrigin: "left",
          animation: paused ? "none" : `ai-notice-drain ${NOTICE_MS}ms linear forwards`,
        }}
      />
      <style>{`@keyframes ai-notice-drain { from { transform: scaleX(1) } to { transform: scaleX(0) } }`}</style>
    </div>
  );
};

export default AiJobNotice;
