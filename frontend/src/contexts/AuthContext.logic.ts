// The auth context object and the `useAuth` hook that reads it.
//
// The PROVIDER is the component, and it stays in AuthContext.tsx. A hook is not a component,
// so exporting both from one module made it a module fast refresh cannot replace — and this is
// the module holding the signed-in user, so every save logged the session out of the page.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

import { createContext, useContext } from "react";
import { type MeResponse } from "../api/auth";

export type AuthUser = MeResponse;

export type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthed: boolean;
  isAdmin: boolean;
  isUser: boolean;
  role: string;
  refreshMe: (force?: boolean) => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
