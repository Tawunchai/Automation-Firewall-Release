import type { FirewallPolicy } from "../../api/policyObject";

// The rule base as a grid: every source segment down the side, every destination across the top,
// and in each cell what is permitted between that pair.
//
// ── The question it answers ──────────────────────────────────────────────────
//
// "Is anything allowed from the guest network to the servers?" is a question about a PAIR, and the
// policy table is ordered by precedence, not by pair. Answering it from the list means reading
// every row and remembering which ones matched — which is exactly the reading people get wrong,
// and the reason an any/any rule left open after a trial survives for months.
//
// A matrix makes the absence visible. An empty cell is an answer ("nothing is permitted from here
// to there"), and an empty cell is the thing a list physically cannot show you.
//
// ── What a cell's severity means, and why it is computed this way ─────────────
//
// The cell takes the WORST thing true of any enabled policy on that pair, because that is what an
// attacker gets. Ordered by how much it actually widens exposure, not by how alarming it sounds:
//
//   wide-open      a rule on this pair with all-any source, destination AND service. Nothing
//                  else on the pair matters; this permits everything.
//   uninspected    permitted with no UTM profile attached at all. On an egress pair this is the
//                  finding the Audit page raises, and here it is visible as a shape.
//   permitted      at least one accept, with inspection.
//   deny-only      rules exist and all of them deny. Not an absence — somebody decided this.
//   none           no enabled rule names this pair. The empty cell.
//
// A DISABLED rule contributes nothing. It is still in the table and still worth cleaning up, which
// is Rule Lifecycle's job; it permits no traffic today, so drawing it here would show exposure
// that does not exist.

export type CellLevel = "none" | "deny-only" | "permitted" | "uninspected" | "wide-open";

export type MatrixCell = {
  src: string;
  dst: string;
  level: CellLevel;
  /** Enabled policies naming this pair. */
  count: number;
  /** Ids, so a click can filter the table to exactly this pair. */
  policyIds: number[];
  /** True when any permitting rule on the pair translates. */
  nat: boolean;
  /** Total 24h hits across the pair, when the caller supplies activity. */
  hits?: number;
};

export type PolicyMatrix = {
  sources: string[];
  destinations: string[];
  /** `${src}|${dst}` → cell. Absent means level "none". */
  cells: Map<string, MatrixCell>;
  /** How many pairs are at each level — the caption under the grid. */
  totals: Record<CellLevel, number>;
};

const ANY = new Set(["all", "any", "ALL", "ANY"]);

/** True when every one of source, destination and service is the catch-all. */
export const isWideOpen = (p: FirewallPolicy): boolean => {
  const anyList = (xs: string[]) => xs.length > 0 && xs.every((x) => ANY.has(x));
  return p.action === "accept"
    && anyList(p.src_addr_list ?? [])
    && anyList(p.dst_addr_list ?? [])
    && anyList(p.service_list ?? []);
};

/** True when a policy has any real UTM profile. Kept in step with topology/model.ts. */
export const hasInspection = (p: FirewallPolicy): boolean =>
  Boolean(p.av_profile || p.webfilter_profile || p.dnsfilter_profile || p.app_control
    || p.ips_sensor || p.file_filter_profile
    // certificate-inspection does not inspect anything; it just does not break TLS.
    || (p.ssl_ssh_profile && p.ssl_ssh_profile !== "certificate-inspection"));

/** Worse wins. */
const RANK: Record<CellLevel, number> = {
  none: 0, "deny-only": 1, permitted: 2, uninspected: 3, "wide-open": 4,
};

const worse = (a: CellLevel, b: CellLevel): CellLevel => (RANK[a] >= RANK[b] ? a : b);

export type BuildOpts = {
  /** policy id → 24h hit total, when the page has the activity map loaded. */
  hitsOf?: (policyId: number) => number | undefined;
};

/**
 * Builds the matrix.
 *
 * The axes come from the policies themselves, NOT from the interface list. Two reasons: a rule can
 * name a zone, which is not in the interface list; and an interface no rule mentions would add an
 * empty row and an empty column that say nothing. The grid is as big as the rule base makes it.
 */
export const buildMatrix = (policies: FirewallPolicy[], opts: BuildOpts = {}): PolicyMatrix => {
  const cells = new Map<string, MatrixCell>();
  const sources = new Set<string>();
  const destinations = new Set<string>();

  policies.forEach((p) => {
    if (!p.enabled) return;
    const srcs = p.src_intf_list?.length ? p.src_intf_list : [p.src_intf];
    const dsts = p.dst_intf_list?.length ? p.dst_intf_list : [p.dst_intf];

    const permits = p.action === "accept";
    const level: CellLevel = !permits ? "deny-only"
      : isWideOpen(p) ? "wide-open"
        : hasInspection(p) ? "permitted" : "uninspected";

    srcs.forEach((s) => dsts.forEach((d) => {
      if (!s || !d) return;
      sources.add(s);
      destinations.add(d);
      const key = `${s}|${d}`;
      const hit = opts.hitsOf?.(p.id);
      const prev = cells.get(key);
      if (!prev) {
        cells.set(key, {
          src: s, dst: d, level, count: 1, policyIds: [p.id],
          nat: permits && p.nat,
          hits: hit,
        });
        return;
      }
      prev.count += 1;
      prev.policyIds.push(p.id);
      prev.level = worse(prev.level, level);
      prev.nat = prev.nat || (permits && p.nat);
      if (hit !== undefined) prev.hits = (prev.hits ?? 0) + hit;
    }));
  });

  const totals: Record<CellLevel, number> = {
    none: 0, "deny-only": 0, permitted: 0, uninspected: 0, "wide-open": 0,
  };
  cells.forEach((c) => { totals[c.level] += 1; });
  // Every pair the grid shows that has no rule.
  totals.none = sources.size * destinations.size - cells.size;

  // "any" sorts first on both axes: it is the row and column that override the reading of every
  // other cell, so burying it alphabetically between two interface names hides the finding.
  const order = (xs: Set<string>) => [...xs].sort((a, b) => {
    const aAny = ANY.has(a) ? 0 : 1;
    const bAny = ANY.has(b) ? 0 : 1;
    return aAny - bAny || a.localeCompare(b);
  });

  return { sources: order(sources), destinations: order(destinations), cells, totals };
};

/** The one-line explanation a cell shows on hover, in words rather than a colour. */
export const describeCell = (c: MatrixCell | undefined, src: string, dst: string): string => {
  if (!c) return `${src} → ${dst}: no enabled rule names this pair`;
  const rules = `${c.count} ${c.count === 1 ? "rule" : "rules"}`;
  const nat = c.nat ? ", NAT" : "";
  switch (c.level) {
    case "wide-open":
      return `${src} → ${dst}: ${rules} — one permits ANY source to ANY destination on ANY service${nat}`;
    case "uninspected":
      return `${src} → ${dst}: ${rules} permitted with no security profile attached${nat}`;
    case "permitted":
      return `${src} → ${dst}: ${rules} permitted, inspected${nat}`;
    default:
      return `${src} → ${dst}: ${rules}, all of them deny`;
  }
};
