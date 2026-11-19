import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import { FiChevronDown, FiUser, FiLogOut } from "react-icons/fi";
import { getLinks, type SidebarLink, type SidebarSection } from "./data";
import { useStateContext } from "../../../contexts/ProviderContext.logic";
import { useAuth } from "../../../contexts/AuthContext.logic";
import logoSidebar from "../../../assets/logo_sidebar.png";

// The console's primary navigation.
//
// A light panel in light mode, a dark one in dark mode (see --nav-* in index.css) — ported from
// Dastone's own sidebar, which genuinely lightens in light mode rather than staying one fixed
// dark rail regardless of theme.
//
// The hard problem underneath is volume: an admin sees ~45 pages across 9 sections. A flat
// always-open list is a wall nobody reads. Two things fix it, and they are the reason for most
// of the code below:
//
//   1. Sections open and close independently — several can stand open at once. What makes that
//      readable is that "open" and "you are here" are drawn differently: only the section holding
//      the current route wears the accent. See `openKeys` below.
//   2. The collapsed rail is one icon per SECTION, not a column of 45 link icons; hovering (or
//      clicking) it opens a flyout with that section's real links.

const DESKTOP_BP = 900;

export const SIDEBAR_W_EXPANDED = 250;
export const SIDEBAR_W_COLLAPSED = 84;

const adminPath = (name: string) => `/admin/${name}`;

const safeNorm = (p: string) => {
  try { return decodeURIComponent(p).replace(/\/+$/, "").toLowerCase(); }
  catch { return p.replace(/\/+$/, "").toLowerCase(); }
};

/** True when `pathname` is this link's page — or a child of it (…/create, …/edit/3). */
const isLinkActive = (pathname: string, name: string) => {
  const here = safeNorm(pathname);
  const target = safeNorm(adminPath(name));
  return here === target || here.startsWith(`${target}/`);
};

// ── Nav item ──────────────────────────────────────────────────────────────────

const NavItem: React.FC<{
  link: SidebarLink;
  onNavigate?: () => void;
}> = ({ link, onNavigate }) => {
  const location = useLocation();
  const active = isLinkActive(location.pathname, link.name);
  const label = link.label ?? link.name;

  return (
    <NavLink
      to={adminPath(link.name)}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`nav-item${active ? " nav-item--active" : ""}`}
    >
      {/* A nav item here is Dastone's *nested* submenu link (e.g. "Analytics" under "Dashboards"),
          which carries no icon of its own — only a small disc, hollow when resting, filled with
          the accent when this is the current page. The section header above it is what carries the
          one icon per group (Dastone's own top-level `.menu-icon`), and that is also the only icon
          the collapsed rail shows. */}
      <span className="nav-dot" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
      </span>
      {link.badge && (
        <span
          className="t-label shrink-0 rounded-full px-1.5 py-px text-white"
          style={{ background: "var(--accent)" }}
        >
          {link.badge}
        </span>
      )}
    </NavLink>
  );
};

// ── Expanded section ──────────────────────────────────────────────────────────

const Section: React.FC<{
  section: SidebarSection;
  open: boolean;
  /** This section owns the current route — the ONE header allowed to wear the accent. */
  active: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}> = ({ section, open, active, onToggle, onNavigate }) => (
  <div>
    {/* A direct port of Dastone's own top-level `.nav-link[data-bs-toggle=collapse]`: icon + label
        + chevron, not a plain uppercase group label — Dastone never shows "NAVIGATION"/"COMPONENTS"
        style dividers above individual collapsible groups, each group header IS a nav-link.
        Open and active are deliberately two different looks: several sections can stand open at
        once, so "expanded" only lifts the ink, while the accent wash, the left bar and the bold
        label are reserved for the section whose own page is on screen. */}
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`nav-section-btn${open ? " nav-section-btn--open" : ""}${active ? " nav-section-btn--active" : ""}`}
    >
      {section.icon && <span className="nav-ico">{section.icon}</span>}
      <span className="nav-section-title min-w-0 flex-1 truncate">{section.title}</span>
      <FiChevronDown
        size={12}
        className="nav-section-chevron shrink-0 transition-transform duration-200"
        style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
      />
    </button>

    {/* Grid-rows trick: animates to the content's real height without measuring it in JS. */}
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-out"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden">
        {section.links.map((link) => (
          <NavItem key={link.name} link={link} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  </div>
);

// ── Collapsed rail section (icon + hover flyout) ──────────────────────────────

const RailSection: React.FC<{ section: SidebarSection; onNavigate?: () => void }> = ({
  section, onNavigate,
}) => {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);

  const sectionActive = section.links.some((l) => isLinkActive(location.pathname, l.name));

  const show = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      // Keep the panel on screen when a long section opens near the bottom edge.
      const estHeight = 44 + section.links.length * 40;
      setTop(Math.min(rect.top, Math.max(8, window.innerHeight - estHeight - 12)));
    }
    setOpen(true);
  };

  // A small grace period, so travelling diagonally from the icon into the panel does not
  // close it out from under the cursor.
  const hide = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  };

  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);

  return (
    <div ref={anchorRef} className="relative" onMouseEnter={show} onMouseLeave={hide}>
      {/* One chip per SECTION — its own icon, the same one the expanded header carries. The rail
          used to render every link in every section instead, which turned a 13-section menu into
          ~45 undifferentiated icons separated by hairlines: nothing in that column told you which
          group you were looking at. The links live in the flyout, which is where there is room to
          name them. Click toggles it too, so the rail is reachable without a pointer hover. */}
      <button
        type="button"
        title={section.title}
        aria-label={section.title}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        className={`nav-rail-btn${sectionActive ? " nav-rail-btn--active" : ""}`}
      >
        <span className="nav-ico">{section.icon}</span>
      </button>

      {open && (
        <div
          className="rail-flyout fixed z-50 w-60 overflow-hidden rounded-[5px] py-1.5"
          style={{
            left: SIDEBAR_W_COLLAPSED + 8,
            top,
            background: "var(--nav-bg-2)",
            border: "1px solid var(--nav-border)",
            boxShadow: "0 24px 60px -20px rgba(2,6,23,0.75)",
          }}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          <p className="t-label m-0 px-5 pb-1.5 pt-2" style={{ color: "var(--nav-ink-3)" }}>
            {section.title}
          </p>
          {section.links.map((link) => (
            <NavItem key={link.name} link={link} onNavigate={() => { setOpen(false); onNavigate?.(); }} />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Sidebar ───────────────────────────────────────────────────────────────────

const Sidebar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuth();
  const { activeMenu, setActiveMenu, screenSize } = useStateContext();

  const handleSignOut = useCallback(async () => {
    try { await logout(); } finally { navigate("/", { replace: true }); }
  }, [logout, navigate]);

  // A broken/expired profile URL falls back to the generic icon rather than a blank circle.
  const [avatarBroken, setAvatarBroken] = useState(false);
  useEffect(() => { setAvatarBroken(false); }, [user?.profile]);

  const isDesktop = typeof screenSize === "number" ? screenSize > DESKTOP_BP : true;
  const collapsed = isDesktop && !activeMenu;

  const sections = useMemo(() => getLinks({ isAdmin }), [isAdmin]);

  // The section owning the current route — recomputed on every navigation.
  const activeSectionKey = useMemo(() => {
    const hit = sections.find((s) => s.links.some((l) => isLinkActive(location.pathname, l.name)));
    return hit?.key;
  }, [sections, location.pathname]);

  // Sections open INDEPENDENTLY — any number can stand open at once, and opening one never closes
  // another. This replaced a strict one-at-a-time accordion, which made comparing two sections
  // impossible: every click folded away whatever you had just opened.
  //
  // The accordion existed to stop several headers reading as "you are here" at the same time.
  // That is now solved where it actually belongs, in the styling rather than the state: open is
  // drawn as a lift in ink, and the accent is reserved for `activeSectionKey` — the single section
  // holding the page you are on. So several groups can be expanded while exactly one is lit.
  const [openKeys, setOpenKeys] = useState<string[]>(() =>
    activeSectionKey ? [activeSectionKey] : [],
  );

  // Landing on a page opens its section without disturbing the ones the user opened by hand.
  useEffect(() => {
    if (!activeSectionKey) return;
    setOpenKeys((keys) => (keys.includes(activeSectionKey) ? keys : [...keys, activeSectionKey]));
  }, [activeSectionKey]);

  // The whole title row is the click target, not just the chevron.
  const toggleSection = useCallback((key: string) => {
    setOpenKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));
  }, []);

  const closeMobile = () => { if (!isDesktop) setActiveMenu(false); };

  if (!isDesktop && !activeMenu) return null;

  const sidebar = (
    <aside
      className="fixed left-0 top-0 z-40 flex h-dvh flex-col overflow-hidden"
      style={{
        width: collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W_EXPANDED,
        background: "linear-gradient(180deg, var(--nav-bg-2) 0%, var(--nav-bg) 34%)",
        borderRight: "1px solid var(--nav-border-2)",
        transition: "width 260ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      {/* ── Brand ──────────────────────────────────────────────────────── */}
      <Link
        to="/admin"
        onClick={closeMobile}
        className="flex h-16 shrink-0 items-center gap-3 overflow-hidden no-underline"
        style={{
          padding: collapsed ? 0 : "0 18px",
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        {/* The user's own reference image (assets/logo_sidebar.png — flame-in-front-of-a-brick-wall,
            the literal "firewall" pun), not a hand-drawn recreation of it. The wordmark beside it
            is still plain text on the theme-reactive nav ink tokens, so it keeps repainting with
            light/dark mode even though the mark itself is now a fixed asset. */}
        {collapsed ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[4px]">
            <img src={logoSidebar} alt="AutoWall" draggable={false} className="h-full w-full object-contain" />
          </span>
        ) : (
          <>
            <img src={logoSidebar} alt="" draggable={false} className="h-10 w-10 shrink-0 object-contain" />
            <span className="min-w-0 leading-tight">
              {/* A flat two-tone split — "Auto" in the resting ink, "Wall" in the user's own
                  accent — rather than a gradient-and-shadow treatment trying to fake relief out
                  of plain text. One small accent rule underneath is the only other ornament:
                  enough to read as a mark, not a logotype trying too hard. */}
              <span className="block truncate text-[20px] font-extrabold" style={{ letterSpacing: "0.1px" }}>
                <span style={{ color: "var(--nav-ink-strong)" }}>Auto</span>
                <span style={{ color: "var(--accent)" }}>Wall</span>
              </span>
              <span
                className="mt-1 block h-0.75 w-6 rounded-full"
                style={{ background: "var(--accent)" }}
              />
              <span
                className="mt-1 block truncate text-[8.5px] font-bold"
                style={{ color: "var(--nav-ink-3)", letterSpacing: "0.18em" }}
              >
                FIREWALL AUTOMATION
              </span>
            </span>
          </>
        )}
      </Link>

      {/* ── Nav ────────────────────────────────────────────────────────── */}
      <nav className="nav-scroll-thin flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-2">
        {collapsed ? (
          sections.map((section) => (
            <RailSection key={section.key} section={section} onNavigate={closeMobile} />
          ))
        ) : (
          sections.map((section) => (
            <Section
              key={section.key}
              section={section}
              open={openKeys.includes(section.key)}
              active={section.key === activeSectionKey}
              onToggle={() => toggleSection(section.key)}
              onNavigate={closeMobile}
            />
          ))
        )}
      </nav>

      {/* ── User profile + sign out ───────────────────────────────────────
          A direct port of the reference's sidebar footer: avatar + name + a role pill + the role
          itself on a second line, with sign-out as a plain icon button beside it rather than buried
          in the navbar's profile menu. The avatar is the same uploaded photo the navbar shows
          (`user.profile`), not a placeholder — only the navbar downscales it through a canvas
          thumbnail for crispness, which a 32px sidebar circle does not need. */}
      {user && (
        <div className="shrink-0 p-3">
          <div
            className="flex w-full items-center gap-2.5 rounded-[5px] p-2"
            style={{ background: "var(--nav-sunken)", justifyContent: collapsed ? "center" : undefined }}
          >
            <span className="relative shrink-0">
              <span
                className="grid size-8 place-items-center overflow-hidden rounded-full"
                style={{ background: "var(--nav-hover)", border: "1.5px solid var(--nav-border)" }}
              >
                {user.profile?.trim() && !avatarBroken ? (
                  <img
                    src={user.profile}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-cover"
                    onError={() => setAvatarBroken(true)}
                  />
                ) : (
                  <FiUser size={14} style={{ color: "var(--nav-ink-3)" }} />
                )}
              </span>
              <span
                className="absolute -bottom-0.5 -inset-e-0.5 size-2.5 rounded-full"
                style={{ background: "var(--flow-allow)", border: "2px solid var(--nav-bg)" }}
              />
            </span>

            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 text-left">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="block truncate text-[12.5px] font-semibold"
                      style={{ color: "var(--nav-ink-strong)" }}
                    >
                      {user.first_name} {user.last_name}
                    </span>
                    {isAdmin && (
                      <span
                        className="inline-flex shrink-0 items-center rounded px-1 py-px text-[8.5px] font-bold uppercase tracking-wide"
                        style={{
                          background: "color-mix(in srgb, var(--accent) 30%, transparent)",
                          color: "color-mix(in srgb, var(--accent) 80%, white)",
                        }}
                      >
                        Admin
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[10.5px] capitalize" style={{ color: "var(--nav-ink)" }}>
                    {user.role || "Viewer"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="shell-btn shell-btn--nav shrink-0"
                  style={{ width: 28, height: 28, borderRadius: 7 }}
                >
                  <FiLogOut size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );

  if (!isDesktop) {
    return (
      <>
        <div
          role="presentation"
          className="fixed inset-0 z-39"
          style={{ background: "rgba(2,6,23,0.6)", backdropFilter: "blur(2px)" }}
          onClick={() => setActiveMenu(false)}
        />
        {sidebar}
      </>
    );
  }

  return sidebar;
};

export default Sidebar;
