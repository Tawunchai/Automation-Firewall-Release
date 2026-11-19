// The theme/shell context object, its initial state, and the `useStateContext` hook.
//
// The ContextProvider component stays in ProviderContext.tsx.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

import React, { createContext, useContext } from "react";
import type { ChangeEvent } from "react";

export interface InitialState {
  chat: boolean;
  cart: boolean;
  userProfile: boolean;
  notification: boolean;
}

export type ThemeMode = "Light" | "Dark";

export interface StateContextType {
  screenSize: number | undefined;
  setScreenSize: React.Dispatch<React.SetStateAction<number | undefined>>;

  currentColor: string;
  setCurrentColor: React.Dispatch<React.SetStateAction<string>>;

  currentMode: ThemeMode;
  setCurrentMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
  setTheme: (mode: ThemeMode) => void;

  themeSettings: boolean;
  setThemeSettings: React.Dispatch<React.SetStateAction<boolean>>;

  activeMenu: boolean;
  setActiveMenu: React.Dispatch<React.SetStateAction<boolean>>;

  isClicked: InitialState;
  setIsClicked: React.Dispatch<React.SetStateAction<InitialState>>;
  initialState: InitialState;

  setMode: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  setColor: (color: string) => void;
  handleClick: (clicked: keyof InitialState) => void;
  toggleMode: () => void;

  syncThemeFromUser: (themeMode: string, themeColor: string) => void;

  userRefreshTrigger: number;
  triggerUserRefresh: () => void;
}

export const initialState: InitialState = {
  chat: false,
  cart: false,
  userProfile: false,
  notification: false,
};

export const StateContext = createContext<StateContextType | undefined>(undefined);

export const useStateContext = (): StateContextType => {
  const context = useContext(StateContext);
  if (!context) throw new Error("useStateContext must be used within a ContextProvider");
  return context;
};
