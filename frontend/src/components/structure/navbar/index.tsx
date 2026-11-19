import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  RiMenuFoldLine, RiMenuUnfoldLine,
  RiTerminalBoxLine,
} from "react-icons/ri";
import { HiOutlinePaintBrush } from "react-icons/hi2";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";
import { UserProfile } from "../path";
import CliConsole from "./CliConsole";
import LanguageSwitcher from "./LanguageSwitcher";
import { useStateContext } from "../../../contexts/ProviderContext.logic";
import { useAuth } from "../../../contexts/AuthContext.logic";
import { getLinks, resolveCrumb } from "../sidebar/data";
import DeviceSelector from "../../ui/DeviceSelector";
import VDOMSelector from "../../ui/VDOMSelector";
import { ListUserByID, type UserResponse } from "../../../api";
import { useTranslation } from "react-i18next";

// The top bar.
//
// Three things carry it:
//
//   · It sits on the light content surface, opposite the dark navigation panel — the two together
//     are what make the console read as a designed shell rather than a page with chrome bolted on.
//   · The left side answers "where am I?" with a breadcrumb derived from the same link table the
//     sidebar renders, so a page can never show a title the menu disagrees with.
//   · The action icons live in one hairline-divided group with the identity block behind a rule,
//     which is what makes the right side read as a toolbar instead of scattered glyphs.
//
// It also carries the console's ONE device picker. "Which firewall am I looking at" is shell
// state, not a page control: it outlives any single page, and every device page needs the same
// answer. It used to be per-page — 18 pickers, 18 independent selections — so moving between
// Firewall Policy, Addresses and Web Filter meant choosing the same firewall three times, with
// nothing keeping the three answers in agreement. Now the selection lives in DeviceContext and is
// rendered here, once.
//
// It is rendered on EVERY page, unconditionally. There was an allow-list of "device-scoped" routes
// that hid it on Users, Calendar, Password Policy and the rest (routes/deviceRoutes.ts, now
// deleted), on the reasoning that a picker above a page it cannot affect invites the reading that
// changing it would do something there. In use that traded one misreading for a worse one: the
// control that is supposed to be shell state disappeared and came back as you walked around the
// app, so it read as page state after all — and any page missing from the list silently lost it.
// A picker that is always in the same place is the thing that makes the selection feel global; the
// pages it does not apply to simply ignore it.

const DESKTOP_BREAKPOINT = 900;
const NAV_AVATAR_SIZE = 34;
const NAVBAR_ROW1_H = 64;
const NAVBAR_ROW2_H = 50;              // Dastone's .page-title-box: 1rem padding around an 18px title
export const NAVBAR_H = NAVBAR_ROW1_H + NAVBAR_ROW2_H;

/**
 * Downscales the profile image to exactly the size the navbar draws it at.
 *
 * Browsers resample a 1024px avatar into a 34px box badly; doing it once on a canvas keeps the
 * small circle crisp instead of aliased.
 */
const createCoverThumbnail = async (src: string, size: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        const canvas = document.createElement("canvas");
        const ts = Math.round(size * dpr);
        canvas.width = ts; canvas.height = ts;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("no ctx")); return; }
        ctx.clearRect(0, 0, ts, ts);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        const sw = img.naturalWidth, sh = img.naturalHeight;
        const scale = Math.max(ts / sw, ts / sh);
        const dw = sw * scale, dh = sh * scale;
        ctx.drawImage(img, (ts - dw) / 2, (ts - dh) / 2, dw, dh);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("load failed"));
    img.src = src;
  });

// ── Icon button ───────────────────────────────────────────────────────────────

const NavBtn: React.FC<{
  onClick?: () => void;
  label: string;
  active?: boolean;
  badge?: boolean;
  badgeColor?: string;
  children: React.ReactNode;
}> = ({ onClick, label, active, badge, badgeColor = "#f97316", children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={`shell-btn${active ? " shell-btn--on" : ""}`}
    style={{ width: 38, height: 38, borderRadius: 10 }}
  >
    {children}
    {badge && (
      <span
        className="absolute right-2.25 top-2 h-1.75 w-1.75 rounded-full"
        style={{ background: badgeColor, boxShadow: "0 0 0 2px var(--shell-bg)" }}
      />
    )}
  </button>
);

/** Hairline between icon groups — the thing that turns a row of glyphs into a toolbar. */
const Divider: React.FC = () => (
  <span className="mx-1 h-5 w-px shrink-0" style={{ background: "var(--shell-border)" }} />
);

// ── Navbar ────────────────────────────────────────────────────────────────────

const Navbar: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const [avatarHovered, setAvatarHovered] = useState(false);
  // Owned here rather than inside UserProfile: selecting a menu item closes that menu, so a dialog
  // rendered from it would be unmounted by the very click that opened it.
  // The CLI Console. Mounted from the navbar so it survives navigation — the whole point of a
  // console is to keep a shell open while you move around the app looking at what it told you.
  const [consoleOpen, setConsoleOpen] = useState(false);

  const {
    activeMenu,
    setActiveMenu,
    handleClick,
    isClicked,
    setScreenSize,
    screenSize,
    currentColor,
    themeSettings,
    setThemeSettings,
    userRefreshTrigger,
  } = useStateContext();

  const { user, logout, isAdmin } = useAuth();
  const [navbarUser, setNavbarUser] = useState<UserResponse | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [profileThumbSrc, setProfileThumbSrc] = useState("");
  const [thumbLoading, setThumbLoading] = useState(false);

  const isMountedRef = useRef(false);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Screen resize
  useEffect(() => {
    const onResize = () => setScreenSize(window.innerWidth);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [setScreenSize]);

  useEffect(() => {
    if (typeof screenSize === "number") setActiveMenu(screenSize > DESKTOP_BREAKPOINT);
  }, [screenSize, setActiveMenu]);

  // User
  const currentUserId = useMemo(() => user?.id ?? null, [user?.id]);

  const fetchNavbarUser = useCallback(async () => {
    if (isFetchingRef.current || !currentUserId) return;
    try {
      isFetchingRef.current = true;
      const result = await ListUserByID(currentUserId);
      if (isMountedRef.current && result) setNavbarUser(result);
    } catch { /* silent */ } finally { isFetchingRef.current = false; }
  }, [currentUserId]);

  useEffect(() => {
    if (user) setNavbarUser(user as UserResponse);
    else setNavbarUser(null);
  }, [user]);

  useEffect(() => {
    if (!currentUserId || userRefreshTrigger === 0) return;
    void fetchNavbarUser();
  }, [currentUserId, userRefreshTrigger, fetchNavbarUser]);

  useEffect(() => { setProfileError(false); }, [navbarUser?.profile]);

  const avatarFallback = useMemo(() =>
    "data:image/svg+xml;utf8," + encodeURIComponent(`
      <svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>
        <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stop-color='#dbeafe'/>
          <stop offset='100%' stop-color='#c4b5fd'/>
        </linearGradient></defs>
        <rect width='100%' height='100%' rx='18' fill='url(#g)'/>
        <circle cx='80' cy='62' r='24' fill='#475569'/>
        <path d='M38 126c7-20 24-30 42-30s35 10 42 30' fill='#475569'/>
      </svg>`),
  []);

  const effectiveUser = navbarUser ?? (user as UserResponse | null);
  const profileSrc = !profileError && effectiveUser?.profile?.trim()
    ? effectiveUser.profile : avatarFallback;

  useEffect(() => {
    let cancelled = false;
    const build = async () => {
      if (!profileSrc) { setProfileThumbSrc(""); return; }
      if (profileSrc.startsWith("data:image/svg+xml")) { setProfileThumbSrc(profileSrc); return; }
      try {
        setThumbLoading(true);
        const url = await createCoverThumbnail(profileSrc, NAV_AVATAR_SIZE);
        if (!cancelled) setProfileThumbSrc(url);
      } catch { if (!cancelled) setProfileThumbSrc(profileSrc); }
      finally { if (!cancelled) setThumbLoading(false); }
    };
    void build();
    return () => { cancelled = true; };
  }, [profileSrc]);

  const fullName = `${effectiveUser?.first_name || "Guest"} ${effectiveUser?.last_name || ""}`.trim();
  const roleName = effectiveUser?.role || "Viewer";
  const email = effectiveUser?.email || "";

  const isDesktop = typeof screenSize === "number" ? screenSize > DESKTOP_BREAKPOINT : true;

  // Breadcrumb — same source of truth as the sidebar.
  const crumb = useMemo(
    () => resolveCrumb(location.pathname, getLinks({ isAdmin })),
    [location.pathname, isAdmin],
  );

  return (
    <header
      className="sticky top-0 z-40 w-full"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        flexShrink: 0,
      }}
    >
      {/* ── Row 1: sidebar toggle + device picker (left), action icons + avatar (right) ──── */}
      <div
        className="flex w-full items-center gap-2 px-3 sm:px-5"
        style={{
          height: NAVBAR_ROW1_H,
          background: "color-mix(in srgb, var(--shell-bg) 86%, transparent)",
          backdropFilter: "blur(16px) saturate(170%)",
          WebkitBackdropFilter: "blur(16px) saturate(170%)",
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <NavBtn
            label={activeMenu ? "Collapse sidebar" : "Expand sidebar"}
            onClick={() => setActiveMenu((prev) => !prev)}
          >
            {isDesktop && activeMenu
              ? <RiMenuFoldLine style={{ fontSize: 20 }} />
              : <RiMenuUnfoldLine style={{ fontSize: 20 }} />}
          </NavBtn>

          {/* The console's device picker — on every page, never conditional (see the note at the
              top of this file). Neutral-surfaced so the chrome stays quiet; the only colour on it
              is the reachability dot. */}
          <DeviceSelector />
          {/* On a split firewall the device alone is only half an address — "policy #3" is a
              different rule in each tenant. This renders nothing on the units that are not split,
              which is most of them. */}
          <VDOMSelector />
        </div>

        {/* ── Right: actions ───────────────────────────────────────────────────────────────
            Flat icons with a plain gap, no grouping pill — a direct port of Dastone's own
            `.topbar-custom .nav-link.nav-icon` row (flag, sun/moon, bell, avatar, each its own
            36px circle, nothing boxing them together). No light/dark toggle here: mode is one of
            the choices inside Appearance (the brush), and two controls for one setting is two
            places to disagree about what the current mode is. */}
        <div className="flex shrink-0 items-center gap-1">
        {/* Language. Dastone's own flag icon sits first in this cluster. Picking one switches
            the whole console — see src/i18n/jsx-runtime.ts for how. */}
        <LanguageSwitcher />

        {/* CLI Console. Admin-only, matching the backend, which refuses the socket upgrade for
            anyone else — an icon that can only ever fail is worse than no icon. Hidden on phones
            for the plain reason that a terminal is unusable on one. */}
        {isDesktop && isAdmin && (
          <NavBtn
            label="CLI Console"
            onClick={() => setConsoleOpen((v) => !v)}
            active={consoleOpen}
          >
            <RiTerminalBoxLine style={{ fontSize: 18 }} />
          </NavBtn>
        )}

        <NavBtn
          label="Appearance"
          onClick={() => setThemeSettings(!themeSettings)}
          active={themeSettings}
        >
          <HiOutlinePaintBrush style={{ fontSize: 17 }} />
        </NavBtn>

        <Divider />

        {/* Avatar + identity */}
        <button
          type="button"
          onClick={() => handleClick("userProfile")}
          aria-label={t("nav.openProfile")}
          onMouseEnter={() => setAvatarHovered(true)}
          onMouseLeave={() => setAvatarHovered(false)}
          className="flex items-center gap-2.5 rounded-[4px] border-none py-1 pl-1 pr-2"
          style={{
            background: isClicked.userProfile || avatarHovered ? "var(--shell-hover)" : "transparent",
            cursor: "pointer",
            transition: "background 150ms",
          }}
        >
          <span className="relative shrink-0">
            <span
              className="block overflow-hidden rounded-full"
              style={{
                width: NAV_AVATAR_SIZE,
                height: NAV_AVATAR_SIZE,
                boxShadow: avatarHovered
                  ? `0 0 0 2px ${currentColor}`
                  : "0 0 0 1px var(--shell-border)",
                transition: "box-shadow 150ms",
              }}
            >
              <img
                src={profileThumbSrc || profileSrc}
                alt={fullName}
                draggable={false}
                className="block h-full w-full object-cover"
                style={{ opacity: thumbLoading ? 0.7 : 1 }}
                onError={() => setProfileError(true)}
              />
            </span>
            <span
              className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full"
              style={{ background: "#10b981", boxShadow: "0 0 0 2px var(--shell-bg)" }}
            />
          </span>

          {isDesktop && (
            <>
              <span className="flex flex-col items-start">
                <span className="t-body max-w-40 truncate font-semibold">{fullName || "User"}</span>
                <span className="t-meta capitalize">{roleName}</span>
              </span>
              <FiChevronDown
                size={12}
                style={{
                  color: "var(--shell-ink-3)",
                  transform: isClicked.userProfile ? "rotate(180deg)" : "none",
                  transition: "transform 160ms",
                }}
              />
            </>
          )}
        </button>
        </div>
      </div>

      {/* ── Row 2: page title + breadcrumb strip ─────────────────────────────
          A direct port of Dastone's own page header: the page name as a real heading (24px/700,
          sentence case — not the small uppercase label this used to be) on the plain canvas, with
          the breadcrumb trail as quiet text on the right, same row. A second band under the icon
          row rather than a title jammed into row 1 — the page you are on reads as its own line,
          not a label competing with the toggle and the device picker for space. */}
      <div
        className="flex min-w-0 items-center justify-between gap-3 px-3 sm:px-5"
        style={{
          height: NAVBAR_ROW2_H,
          background: "var(--shell-bg)",
          borderTop: "1px solid var(--shell-border-2)",
        }}
      >
        <h1
          className="m-0 truncate text-[18px] font-semibold"
          style={{ color: "var(--shell-ink)", fontFamily: "var(--font-sans)" }}
        >
          {crumb.label}
        </h1>

        {/* Dastone's own `.breadcrumb`: both the brand link and the active (current-page) item
            share --bs-link-color / --bs-breadcrumb-item-active-color, which both resolve to the
            accent — not one muted + one accent, which is how this read before the port. */}
        {isDesktop && (
          <div className="flex shrink-0 items-center gap-1.5">
            {/* .accent-text, not an inline var(--accent): Dastone's own dark theme lightens its
                link colour (#6f6af8 → #a9a6fb) for contrast on a near-black canvas, and that's
                exactly what this class already does for every other accent-coloured label. */}
            <span className="t-meta accent-text font-semibold">
              {crumb.section !== crumb.label ? crumb.section : "AutoWall"}
            </span>
            <FiChevronRight size={9} style={{ color: "var(--shell-ink-3)", flexShrink: 0 }} />
            <span className="t-meta accent-text font-semibold">{crumb.label}</span>
          </div>
        )}
      </div>

      {isClicked.userProfile && (
        <UserProfile
          profileSrc={profileSrc}
          avatarFallback={avatarFallback}
          fullName={fullName}
          roleName={roleName}
          email={email}
          logout={logout}
        />
      )}

      <CliConsole open={consoleOpen} onClose={() => setConsoleOpen(false)} />
    </header>
  );
};

export default Navbar;
