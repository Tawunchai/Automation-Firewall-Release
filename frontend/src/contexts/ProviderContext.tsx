import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode, ChangeEvent } from "react";
import { UpdateThemePreference } from "../api/user";
import { StateContext, initialState } from "./ProviderContext.logic";
import type { InitialState, StateContextType, ThemeMode } from "./ProviderContext.logic";

/** The console's out-of-the-box accent. A saved choice always wins over it. */
const DEFAULT_ACCENT = "#6F6AF8";

const STORAGE_KEY_MODE  = "themeMode";
const STORAGE_KEY_COLOR = "colorMode";

const applyTheme = (mode: ThemeMode) => {
  if (mode === "Dark") document.documentElement.classList.add("dark");
  else document.documentElement.classList.remove("dark");
};

const applyAccentColor = (color: string) => {
  document.documentElement.style.setProperty("--accent", color);
};

export const ContextProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [screenSize, setScreenSize]   = useState<number | undefined>(undefined);
  // Read from localStorage in the INITIALISER, not in an effect. Starting at the default and
  // correcting afterwards meant the first paint used the light theme even for someone who had
  // chosen dark — a visible flash on every load. Reading it here happens before that paint.
  //
  // Wrapped in try/catch because storage throws outright in some privacy modes, where the right
  // answer is the default rather than a blank screen.
  const [currentColor, setCurrentColor] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY_COLOR) || DEFAULT_ACCENT; } catch { return DEFAULT_ACCENT; }
  });
  const [currentMode, setCurrentMode] = useState<ThemeMode>(() => {
    try { return localStorage.getItem(STORAGE_KEY_MODE) === "Dark" ? "Dark" : "Light"; } catch { return "Light"; }
  });
  const [themeSettings, setThemeSettings] = useState<boolean>(false);
  const [activeMenu, setActiveMenu]   = useState<boolean>(true);
  const [isClicked, setIsClicked]     = useState<InitialState>(initialState);
  const [userRefreshTrigger, setUserRefreshTrigger] = useState<number>(0);

  // The state above already holds the saved values; this only pushes them at the DOM, which an
  // effect is the right place for.
  useEffect(() => {
    applyTheme(currentMode);
    applyAccentColor(currentColor);
    // Mount only: the two effects below keep the DOM in step with any later change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply dark/light class whenever mode changes
  useEffect(() => {
    applyTheme(currentMode);
  }, [currentMode]);

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_MODE && e.newValue) {
        const mode = e.newValue === "Dark" ? "Dark" : "Light";
        setCurrentMode(mode as ThemeMode);
      }
      if (e.key === STORAGE_KEY_COLOR && e.newValue) {
        setCurrentColor(e.newValue);
        applyAccentColor(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    setCurrentMode(mode);
    localStorage.setItem(STORAGE_KEY_MODE, mode);
    void UpdateThemePreference({ theme_mode: mode });
  }, []);

  const setMode = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const mode = e.target.value === "Dark" ? "Dark" : "Light";
      setTheme(mode as ThemeMode);
    },
    [setTheme]
  );

  const toggleMode = useCallback(() => {
    setTheme(currentMode === "Dark" ? "Light" : "Dark");
  }, [currentMode, setTheme]);

  const setColor = useCallback((color: string) => {
    setCurrentColor(color);
    applyAccentColor(color);
    localStorage.setItem(STORAGE_KEY_COLOR, color);
    void UpdateThemePreference({ theme_color: color });
  }, []);

  // Called by AuthContext after login to apply user's saved preference from DB
  const syncThemeFromUser = useCallback((themeMode: string, themeColor: string) => {
    if (themeMode === "Light" || themeMode === "Dark") {
      setCurrentMode(themeMode);
      applyTheme(themeMode);
      localStorage.setItem(STORAGE_KEY_MODE, themeMode);
    }
    if (themeColor) {
      setCurrentColor(themeColor);
      applyAccentColor(themeColor);
      localStorage.setItem(STORAGE_KEY_COLOR, themeColor);
    }
  }, []);

  const handleClick = useCallback(
    (clicked: keyof InitialState) =>
      setIsClicked({ ...initialState, [clicked]: true }),
    []
  );

  const triggerUserRefresh = useCallback(
    () => setUserRefreshTrigger((prev) => prev + 1),
    []
  );

  const value = useMemo<StateContextType>(
    () => ({
      currentColor,
      currentMode,
      setCurrentMode,
      setTheme,
      activeMenu,
      screenSize,
      setScreenSize,
      handleClick,
      isClicked,
      initialState,
      setIsClicked,
      setActiveMenu,
      setCurrentColor,
      setMode,
      setColor,
      themeSettings,
      setThemeSettings,
      toggleMode,
      syncThemeFromUser,
      userRefreshTrigger,
      triggerUserRefresh,
    }),
    [
      currentColor,
      currentMode,
      setTheme,
      activeMenu,
      screenSize,
      isClicked,
      themeSettings,
      setMode,
      setColor,
      toggleMode,
      syncThemeFromUser,
      userRefreshTrigger,
      triggerUserRefresh,
    ]
  );

  return <StateContext.Provider value={value}>{children}</StateContext.Provider>;
};

