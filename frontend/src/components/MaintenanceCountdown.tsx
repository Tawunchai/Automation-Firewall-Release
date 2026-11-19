import React, { useCallback, useEffect, useRef, useState } from "react";
import { FiTool, FiX } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../api/http";
import { GetPublicMaintenanceStatus } from "../api/maintenance";
import { useAuth } from "../contexts/AuthContext.logic";

const TOTAL_SECONDS = 60;
export const FORCE_LOGOUT_KEY = "auth:maintenance_logout";

const MaintenanceCountdown: React.FC = () => {
  const { isAuthed, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  const [active, setActive] = useState(false);   // maintenance in-progress; component stays mounted
  const [show, setShow] = useState(false);        // modal UI visible
  const [seconds, setSeconds] = useState(TOTAL_SECONDS);
  const [leaving, setLeaving] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const didLogoutRef = useRef(false);
  const initialCheckedRef = useRef(false);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const doLogout = useCallback(async () => {
    if (didLogoutRef.current) return;
    didLogoutRef.current = true;
    stopTimer();
    setLeaving(true);
    setShow(false);
    sessionStorage.setItem(FORCE_LOGOUT_KEY, "1");
    await logout();
    navigate("/", { replace: true });
  }, [stopTimer, logout, navigate]);

  const startCountdown = useCallback((initialSeconds = TOTAL_SECONDS) => {
    if (didLogoutRef.current) return;
    const secs = Math.max(1, Math.min(initialSeconds, TOTAL_SECONDS));
    setSeconds(secs);
    setActive(true);
    setShow(true);
    setLeaving(false);
    didLogoutRef.current = false;
    stopTimer();
    timerRef.current = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) { doLogout(); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, [stopTimer, doLogout]);

  // Keep latest callbacks in refs so SSE listener doesn't need re-registration
  const startCountdownRef = useRef(startCountdown);
  const stopTimerRef = useRef(stopTimer);
  const doLogoutRef = useRef(doLogout);
  useEffect(() => { startCountdownRef.current = startCountdown; }, [startCountdown]);
  useEffect(() => { stopTimerRef.current = stopTimer; }, [stopTimer]);
  useEffect(() => { doLogoutRef.current = doLogout; }, [doLogout]);

  // SSE — only reconnect on real auth-state changes.
  // ⚠ Do NOT call stopTimer() in cleanup — timer must survive SSE reconnects.
  useEffect(() => {
    if (!isAuthed) return;

    // Initial pull-check: handles the case where a user logs in AFTER
    // maintenance:on was already broadcast (they miss the SSE event).
    if (!initialCheckedRef.current) {
      initialCheckedRef.current = true;
      GetPublicMaintenanceStatus().then((status) => {
        if (status.enabled && !isAdmin && !timerRef.current && !didLogoutRef.current) {
          startCountdownRef.current(
            status.seconds_remaining > 0 ? status.seconds_remaining : TOTAL_SECONDS,
          );
        }
      });
    }

    const es = new EventSource(`${apiUrl}/events`, { withCredentials: true });
    esRef.current = es;

    es.addEventListener("system", (e: MessageEvent) => {
      if (e.data === "maintenance:on" && !isAdmin) {
        startCountdownRef.current(); // fresh 60 s from this event
      }
      if (e.data === "maintenance:off") {
        stopTimerRef.current();
        setShow(false);
        setActive(false);
        didLogoutRef.current = false;
        initialCheckedRef.current = false;
      }
    });

    return () => {
      es.close();
      esRef.current = null;
      // ⚠ intentionally not calling stopTimer here
    };
  }, [isAuthed, isAdmin]);

  // When backend returns 503, AuthContext handles force-logout; just hide UI.
  useEffect(() => {
    const onBlock = () => {
      setShow(false);
      setLeaving(true);
      setTimeout(() => setActive(false), 400);
    };
    window.addEventListener("session:maintenance", onBlock);
    return () => window.removeEventListener("session:maintenance", onBlock);
  }, []);

  if (!active || isAdmin) return null;

  const pct = (seconds / TOTAL_SECONDS) * 100;
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  const reopenModal = () => { setShow(true); setLeaving(false); };

  return (
    <>
      {/* ── Full modal (visible when show=true) ─────────────────────────── */}
      {show && (
        <div
          className={[
            "fixed right-4 top-4 z-9999 w-68 select-none",
            "transition-all duration-400 ease-out",
            !leaving ? "translate-x-0 opacity-100" : "translate-x-80 opacity-0",
          ].join(" ")}
          role="alert"
        >
          <div className="overflow-hidden rounded-[4px] border hairline surface-card shadow-lg shadow-black/8">

            <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-amber-100 dark:bg-amber-500/15">
                  <FiTool className="text-[12px] text-amber-500 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-[12px] font-semibold ink">Maintenance</p>
                  <p className="text-[10px] ink-3">Signing out automatically</p>
                </div>
              </div>
              {/* X = hide modal only; timer keeps running in background */}
              <button
                onClick={() => setShow(false)}
                className="flex h-6 w-6 items-center justify-center rounded-[4px] ink-3 transition surface-hover"
              >
                <FiX className="text-[11px]" />
              </button>
            </div>

            <div className="flex items-center justify-center py-4">
              <span className="text-[42px] font-bold tabular-nums leading-none ink">
                {mm}:{ss}
              </span>
            </div>

            <div className="mx-4 mb-4 h-0.75 overflow-hidden rounded-full surface-sunken">
              <div
                className="h-full rounded-full bg-amber-400 transition-all duration-1000"
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="border-t hairline-2 px-4 py-3">
              <button
                onClick={doLogout}
                className="w-full rounded-[4px] bg-amber-500 py-2 text-[12px] font-semibold text-white transition hover:bg-amber-400"
              >
                Sign out now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mini pill indicator (visible when modal is dismissed) ────────── */}
      {/* top-20 = 80px, safely below the h-16 (64px) navbar */}
      {!show && !leaving && (
        <button
          onClick={reopenModal}
          className="fixed right-4 top-20 z-9999 flex items-center gap-1.5 rounded-full border border-amber-200/80 surface-card px-3 py-1.5 shadow-md shadow-amber-500/10 transition hover:border-amber-300 hover:shadow-amber-500/20 dark:border-amber-400/25 dark:hover:border-amber-400/40"
          title="Maintenance in progress — click to expand"
        >
          <FiTool className="text-[10px] text-amber-500 dark:text-amber-400" />
          <span className="text-[11px] font-bold tabular-nums ink">
            {mm}:{ss}
          </span>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        </button>
      )}
    </>
  );
};

export default MaintenanceCountdown;
