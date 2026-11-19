import React, { useMemo, useRef } from "react";
import { Outlet } from "react-router-dom";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { DeviceProvider } from "../../contexts/DeviceContext";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import { Navbar, Sidebar, ThemeSettings } from "./path";
import MaintenanceCountdown from "../MaintenanceCountdown";
import AiJobNotice from "../ai/AiJobNotice";
import { SIDEBAR_W_EXPANDED, SIDEBAR_W_COLLAPSED } from "./sidebar/index";
import "./main.css";

const DESKTOP_BREAKPOINT = 900;

/**
 * The routed page, remounted whenever the selected VDOM changes.
 *
 * Switching tenant is not a filter — it is a different set of policies, objects, routes and
 * interfaces, which happen to be reachable at the same URLs. Everything on screen from the
 * previous VDOM is therefore wrong the instant the pick happens: rows, open drawers, and any form
 * half-filled with objects that do not exist in the tenant it would now submit to.
 *
 * A `key` is the whole mechanism, and it is here rather than in each page for the reason the
 * request interceptor is one function and not 200 call sites. Of the 37 device pages, 18 load
 * through useDeviceData and the other 19 run their own effects keyed on the device; threading a
 * VDOM dependency through all of them would be 19 chances to forget, and the page that forgot
 * would show one tenant's configuration under another tenant's name with nothing to say so.
 *
 * It is NOT keyed on the device id: pages already handle a device change themselves, and adding it
 * here would change behaviour that works today.
 */
const VDOMScopedOutlet: React.FC = () => {
  const { vdom } = useSelectedDevice();
  return <Outlet key={vdom || "root"} />;
};

const MainLayout: React.FC = () => {
  const { activeMenu, themeSettings, screenSize, setIsClicked } = useStateContext();

  const scrollLockRef = useRef(false);

  const isDesktop = typeof screenSize === "number" ? screenSize > DESKTOP_BREAKPOINT : true;

  // On mobile the sidebar overlays — no margin shift needed
  const contentMarginLeft = useMemo(() => {
    if (!isDesktop) return 0;
    return activeMenu ? SIDEBAR_W_EXPANDED : SIDEBAR_W_COLLAPSED;
  }, [activeMenu, isDesktop]);

  const isInsideScrollablePopup = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest('[data-allow-popup-scroll="true"]'));
  };

  const closeNavbarPopups = (event?: React.SyntheticEvent) => {
    if (scrollLockRef.current) return;
    if (isInsideScrollablePopup(event?.target ?? null)) return;
    scrollLockRef.current = true;
    setIsClicked((prev) => {
      if (!prev.notification && !prev.userProfile) return prev;
      return { ...prev, notification: false, userProfile: false };
    });
    window.requestAnimationFrame(() => { scrollLockRef.current = false; });
  };

  return (
    // The navbar carries the dashboard's device picker, so the selection has to live above both
    // the navbar and the routed page — see contexts/DeviceContext.
    <DeviceProvider>
      <div className="min-h-dvh">
        <div
          className="relative min-h-dvh overflow-x-hidden"
          style={{ background: "var(--shell-canvas)" }}
          onScrollCapture={closeNavbarPopups}
          onWheelCapture={closeNavbarPopups}
          onTouchMoveCapture={closeNavbarPopups}
        >
          <Sidebar />

          <div
            className="relative z-10 min-h-dvh transform-gpu will-change-[margin-left] transition-[margin-left] duration-260 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ marginLeft: contentMarginLeft, backfaceVisibility: "hidden" }}
          >
            <Navbar />
            {themeSettings && <ThemeSettings />}
            <main className="relative mx-auto w-full max-w-430 px-3 pb-8 pt-4 sm:px-4 md:px-7 md:pb-12 md:pt-6">
              <VDOMScopedOutlet />
            </main>
          </div>
        </div>
        <MaintenanceCountdown />
        {/* An AI request outlives the page that asked for it, so the answer can land while the
            user is somewhere else entirely. This is what tells them. It lives here rather than in
            the AI page for the same reason the job does: the page is not mounted when it fires. */}
        <AiJobNotice />
      </div>
    </DeviceProvider>
  );
};

export default MainLayout;
