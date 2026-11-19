import React from "react";

interface PageHeaderProps {
  icon: React.ReactNode;
  title: string;
  /**
   * Accent for the icon medallion. Callers pass either a plain colour or a CSS gradient string —
   * both were already in use across the 50 pages that mount this, so both are handled.
   */
  accent: string;
  /** One line on what the page is for. Optional — a self-evident page does not need one. */
  subtitle?: string;
  actions?: React.ReactNode;
}

/**
 * Page header — tinted icon medallion + title (and an optional one-line subtitle) on the left,
 * the page's actions on the right.
 *
 * Deliberately quiet: the navbar breadcrumb already establishes where you are, so this line only
 * has to name the page and hold its controls.
 *
 * The medallion is a round-*rect* (`.medallion`, matching the dashboard's KPI tiles) rather than a
 * rounded square with a coloured drop shadow, and a plain-colour accent renders as a tint rather
 * than a filled block. It repeats on every page in the console: at full saturation it stops
 * reading as "this page's mark" and starts reading as wallpaper, and it was competing with the
 * one thing on the line that should be loud — the primary action button.
 */
const PageHeader: React.FC<PageHeaderProps> = ({ icon, title, accent, subtitle, actions }) => {
  // color-mix cannot take a gradient, so a gradient accent keeps its fill and gets white ink;
  // a plain colour becomes a low-saturation tint of itself.
  const isGradient = accent.includes("gradient");

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="medallion h-9 w-9 text-[16px]"
          style={
            isGradient
              ? { background: accent, color: "#fff" }
              : {
                  background: `color-mix(in srgb, ${accent} 13%, transparent)`,
                  color: accent,
                }
          }
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h1 className="t-display m-0 truncate">{title}</h1>
          {subtitle && <p className="t-meta m-0 mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
};

export default PageHeader;
