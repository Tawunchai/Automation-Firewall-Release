import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GetMe, Logout } from "../api/auth";
import { clearSessionScoped } from "../lib/sessionScope";
import { useStateContext } from "./ProviderContext.logic";
import { AuthContext } from "./AuthContext.logic";
import type { AuthContextValue, AuthUser } from "./AuthContext.logic";

const AUTH_CACHE_TTL = 30_000;

const FORCE_LOGOUT_KEY = "auth:maintenance_logout";

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { syncThemeFromUser } = useStateContext();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const hasFetchedInitialRef = useRef(false);
  const isFetchingRef        = useRef(false);
  const isMountedRef         = useRef(false);
  const lastFetchedAt        = useRef<number>(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // refreshMe uses syncThemeFromUser (stable ref from ProviderContext) for theme init on login.
  const refreshMe = useCallback(async (force = false) => {
    if (isFetchingRef.current) return;

    // Maintenance force-logout guard: keep retrying until backend accepts logout.
    if (sessionStorage.getItem(FORCE_LOGOUT_KEY)) {
      try {
        isFetchingRef.current = true;
        await Logout();
        sessionStorage.removeItem(FORCE_LOGOUT_KEY);
      } catch {
        // Backend still in maintenance — keep flag, user stays logged-out.
      } finally {
        isFetchingRef.current = false;
      }
      if (isMountedRef.current) {
        setUser(null);
        lastFetchedAt.current = 0;
      }
      return;
    }

    const now = Date.now();
    if (!force && now - lastFetchedAt.current < AUTH_CACHE_TTL) {
      return;
    }

    try {
      isFetchingRef.current = true;
      const me = await GetMe();
      if (!isMountedRef.current) return;
      setUser(me);
      lastFetchedAt.current = Date.now();
      if (me?.theme_mode || me?.theme_color) {
        syncThemeFromUser(me.theme_mode ?? "", me.theme_color ?? "");
      }
    } catch {
      if (!isMountedRef.current) return;
      setUser(null);
      lastFetchedAt.current = 0;
    } finally {
      isFetchingRef.current = false;
    }
  }, [syncThemeFromUser]);

  /**
   * Ends the signed-in session locally: drops the user and throws away everything scoped to it.
   *
   * Called from the three signals that genuinely mean "this session is over" — an explicit logout,
   * a 401 from the interceptor, and the maintenance force-logout. Deliberately NOT called from
   * refreshMe's catch: that also fires on a transient network failure, and discarding an
   * administrator's in-progress AI conversation because one /auth/me request timed out would be a
   * data loss with no session expiry behind it. A session that really has expired answers the next
   * protected request with a 401, which lands here anyway.
   */
  const endSession = useCallback(() => {
    clearSessionScoped();
    // Storage is only half of it. State that lives ABOVE the router — the AI job — and state
    // inside a page that is still mounted at this instant survive the wipe in memory, and the
    // mounted page then flushes its snapshot back to storage on unmount, undoing the clear. So
    // announce the end of the session and let those holders drop what they have.
    //
    // Dispatched synchronously and BEFORE setUser(null): the listeners must run while the old
    // session's components are still mounted, not after React has swapped in the login screen.
    window.dispatchEvent(new CustomEvent("session:ended"));
    if (isMountedRef.current) {
      setUser(null);
      lastFetchedAt.current = 0;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await Logout();
    } catch {
      // ignore — clear local state regardless
    } finally {
      endSession();
    }
  }, [endSession]);

  // Initial auth probe — runs once on mount
  useEffect(() => {
    if (hasFetchedInitialRef.current) return;
    hasFetchedInitialRef.current = true;

    const init = async () => {
      try {
        if (isMountedRef.current) setIsLoading(true);
        await refreshMe(true);
      } finally {
        if (isMountedRef.current) setIsLoading(false);
      }
    };

    void init();
  }, [refreshMe]);

  // Clear auth state when JWT expires (401 on any protected request)
  useEffect(() => {
    window.addEventListener("session:expired", endSession);
    return () => window.removeEventListener("session:expired", endSession);
  }, [endSession]);

  // Force-logout when backend enters maintenance mode (503)
  useEffect(() => {
    const onMaintenance = () => {
      sessionStorage.setItem(FORCE_LOGOUT_KEY, "1");
      endSession();
    };
    window.addEventListener("session:maintenance", onMaintenance);
    return () => window.removeEventListener("session:maintenance", onMaintenance);
  }, [endSession]);

  const value = useMemo<AuthContextValue>(() => {
    const isAuthed = user !== null;
    const role     = String(user?.role ?? "").trim().toLowerCase();
    return {
      user,
      isLoading,
      isAuthed,
      isAdmin:    role === "admin",
      isUser:     role === "user",
      role,
      refreshMe,
      logout,
    };
  }, [user, isLoading, refreshMe, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
