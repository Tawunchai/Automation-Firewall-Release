import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiAlertTriangle } from "react-icons/fi";
import ProfileHero from "./profile";
import Data from "./data";
import Credentials from "./credentials";
import { ListUserByID, type UserResponse } from "../../api";
import { useAuth } from "../../contexts/AuthContext.logic";

const Account: React.FC = () => {
  const { t } = useTranslation();
  const { user: authUser, isLoading: authLoading } = useAuth();

  const [user, setUser] = useState<UserResponse | null>(null);
  const [loadingUser, setLoadingUser] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [reloadKey, setReloadKey] = useState<number>(0);

  const hasFetchedInitialRef = useRef(false);
  const isFetchingRef = useRef(false);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // The signed-in user's id. It used to try five spellings — auth.user, auth.me, auth.profile,
  // auth.currentUser, auth.authUser — of which the context only ever had the first; the other
  // four were guesses that could never match and only hid that fact.
  const currentUserId = authUser?.id ?? null;


  const fetchUser = useCallback(async () => {
    if (isFetchingRef.current) return;
    try {
      isFetchingRef.current = true;
      if (isMountedRef.current) { setLoadingUser(true); setError(""); }
      if (authLoading) return;
      if (!currentUserId) {
        if (!isMountedRef.current) return;
        setError(t("profileCompletion.userNotFoundAuth"));
        setUser(null);
        return;
      }
      const result = await ListUserByID(currentUserId);
      if (!isMountedRef.current) return;
      if (!result) { setError(t("profileCompletion.userNotFound")); setUser(null); return; }
      setUser(result);
    } catch (err) {
      console.error("Fetch user error:", err);
      if (!isMountedRef.current) return;
      setError(t("profileCompletion.fetchError"));
      setUser(null);
    } finally {
      if (isMountedRef.current) setLoadingUser(false);
      isFetchingRef.current = false;
    }
  }, [authLoading, currentUserId, t]);

  useEffect(() => {
    if (authLoading) return;
    if (reloadKey === 0) {
      if (hasFetchedInitialRef.current) return;
      hasFetchedInitialRef.current = true;
    }
    void fetchUser();
  }, [fetchUser, reloadKey, authLoading]);

  const handleProfileUpdated = () => {
    setReloadKey((prev) => prev + 1);
  };

  /* ── Loading ──────────────────────────────────────────────────────
     Skeletons in the shape of the page rather than a one-line "Loading…" box: the layout that
     arrives is the layout that was already there, so nothing jumps when the user lands. */
  if (authLoading || loadingUser) {
    return (
      <div className="p-1">
        <div className="page-stack">
          <div className="shell-skeleton h-33 w-full rounded-[4px]" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="shell-skeleton h-72 w-full rounded-[4px]" />
            <div className="shell-skeleton h-72 w-full rounded-[4px]" />
          </div>
        </div>
      </div>
    );
  }

  /* ── Error ── */
  if (error || !user) {
    return (
      <div className="p-1">
        <div className="shell-card">
          <div className="state-block">
            <span
              className="state-icon"
              style={{ color: "#ef4444", background: "rgba(239,68,68,0.1)" }}
            >
              <FiAlertTriangle />
            </span>
            <p className="state-title">{error || t("common.noData")}</p>
            <p className="state-text">{t("account.loadErrorHint")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-1">
      <div className="page-stack">
        {/* 1. Who you are — identity, security state, how complete the record is. */}
        <ProfileHero user={user} onUpdated={handleProfileUpdated} />

        {/* 2. The detail: who you are here on the left, who you are ON THE FIREWALLS on the right.
             The right column held the activity feed — a read-only log of what this console recorded
             about you. Device Credentials replaced it because it answers the harder version of the
             same question: the firewall's OWN log could not tell you apart from anyone else, since
             every request reached it as one shared `admin`. Mapping your own device account fixes
             that at the source, which is worth more than a second copy of a history the Change
             Ledger already keeps. */}
        {/* Both cards stretch to the taller of the two (each root carries `h-full`), so Personal
            Information and Device Credentials line up at the same height on the two-column layout. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
          <Data user={user} onUpdated={handleProfileUpdated} />
          <Credentials />
        </div>
      </div>
    </div>
  );
};

export default Account;
