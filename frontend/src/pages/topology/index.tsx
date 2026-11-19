import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiAlertTriangle, FiRefreshCw } from "react-icons/fi";
import { useDeviceData } from "../../hooks/useDeviceData";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { ErrorState, LoadingState, NoDeviceState } from "../../components/ui/StateBlock";
import {
  DeviceListSystemInterfaces, DeviceListStaticRoutes, DeviceListPolicies,
  type SystemInterface, type StaticRoute, type FirewallPolicy,
} from "../../api/policyObject";
import { DeviceListIPsecTunnels, type IPsecTunnel } from "../../api/vpn";
import { DeviceListZones, type Zone } from "../../api/objectGroups";
import { DeviceGetTopologyLive, type TopologyLive } from "../../api/topologyLive";
import { apiUrl } from "../../api/http";
import { withVDOM } from "../../api/deviceRequest";
import { useLiveStream } from "../../hooks/useLiveTopologyStream";
import { buildTopology } from "./model";
import { applyLiveOverlay, LIVE_POLL_MS } from "./liveOverlay";
import { buildStage } from "./stage/stageModel";
import { layoutStage, type PlacedNode } from "./stage/layout3d";
import { layoutUserDevices } from "./stage/userDevices";
import { PALETTE } from "./stage/palette";
import StageCanvas from "./stage/StageCanvas";
import TopologyKpis from "./stage/TopologyKpis";
import { ARC_CAP, rankEdges } from "./stage/paths";
import UserDevicePanel from "./UserDevicePanel";
import { ListTopologyDevices, RecheckTopologyDevices, type TopologyDevice } from "../../api/topologyDevices";

// Network ▸ Topology — what is connected to what, and what is allowed between them.
//
// The one question the policy table cannot answer by being read. Ten rows are legible as a list;
// the same config as "four segments, three paths between them, and one path with nothing
// inspecting it" is a different thought, and it is the thought people arrive with.
//
// Everything on screen is computed from five reads this console already does elsewhere — see
// ./model.ts for why it is a projection of the config rather than a second source of truth, and
// ./stage/stageModel.ts for how that projection becomes a device with real jacks instead of a ring
// of identical boxes.
//
// Clicking anything navigates to the page that owns it. A diagram you cannot act from is a poster.

const EMPTY_IF: SystemInterface[] = [];

type Sections = {
  interfaces: SystemInterface[];
  zones: Zone[];
  routes: StaticRoute[];
  tunnels: IPsecTunnel[];
  policies: FirewallPolicy[];
  unreadable: string[];
};

const NO_SECTIONS: Sections = {
  interfaces: EMPTY_IF, zones: [], routes: [], tunnels: [], policies: [], unreadable: [],
};

const TopologyPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentMode } = useStateContext();
  const [hover, setHover] = useState<string | null>(null);
  // Whether this browser can draw the scene at all — set once, the first (and only) time
  // StageCanvas reports it cannot (no WebGL, or the scene threw while mounting). There is no second
  // renderer to fall back to, so this swaps the scene for an explanation rather than a blank panel.
  const [unsupported, setUnsupported] = useState(false);

  /**
   * Loads all five sections at once.
   *
   * Each one is settled INDEPENDENTLY, and a section that fails contributes its label to
   * `unreadable` instead of failing the page. That is the difference that matters here: a firewall
   * whose IPsec table cannot be read still has interfaces and policies worth drawing, and a map
   * that refuses to render at all teaches nobody anything. What it must never do is draw the
   * missing section as *empty* — so the caption names it.
   *
   * The only fatal case is interfaces: without them there are no nodes, and a bare chassis with
   * nothing around it is not a map.
   */
  const load = useCallback(async (deviceId: number): Promise<Sections> => {
    const [ifaces, zones, routes, tunnels, policies] = await Promise.allSettled([
      DeviceListSystemInterfaces(deviceId, { strict: true }),
      DeviceListZones(deviceId, { strict: true }),
      DeviceListStaticRoutes(deviceId, { strict: true }),
      DeviceListIPsecTunnels(deviceId, { strict: true }),
      DeviceListPolicies(deviceId, { strict: true }),
    ]);

    if (ifaces.status === "rejected") throw ifaces.reason;

    const unreadable: string[] = [];
    const take = <T,>(r: PromiseSettledResult<T[]>, label: string): T[] => {
      if (r.status === "fulfilled") return r.value;
      unreadable.push(label);
      return [];
    };

    return {
      interfaces: ifaces.value,
      zones: take(zones, "zones"),
      routes: take(routes, "static routes"),
      tunnels: take(tunnels, "IPsec tunnels"),
      policies: take(policies, "firewall policies"),
      unreadable,
    };
  }, []);

  const { data: sections, loading, error: fatal, reload, device, viewState } =
    useDeviceData<Sections>(load, NO_SECTIONS);

  const topo = useMemo(
    () => buildTopology({ ...sections, deviceName: device?.name ?? "" }),
    [sections, device],
  );

  // The live overlay: link state and throughput, pushed from the backend over SSE (one shared poll
  // per device, fanned out to every tab watching it) with a polling fallback. It stays separate
  // from the five slow CMDB reads that decide the diagram's SHAPE — see backend
  // services/fortigate_topology.go. Tagged with the device it was read from, so a reading in flight
  // when the user switches devices can be told apart from one that belongs here. The PREVIOUS
  // reading is kept too: applyLiveOverlay needs two to turn a cumulative byte counter into a rate.
  type LiveReading = { data: TopologyLive; at: number };
  const [live, setLive] = useState<{ deviceId: number; current: LiveReading; previous: LiveReading | null } | null>(null);
  const deviceId = device?.id;

  const recordLive = useCallback((data: TopologyLive) => {
    if (deviceId == null) return;
    setLive((prev) => ({
      deviceId,
      current: { data, at: Date.now() },
      previous: prev && prev.deviceId === deviceId ? prev.current : null,
    }));
  }, [deviceId]);

  const pollLive = useCallback(() => {
    if (deviceId == null) return;
    DeviceGetTopologyLive(deviceId).then(recordLive).catch(() => {
      // Best-effort: the diagram already drew itself from the config reads, and a live overlay that
      // cannot be read should leave it exactly as it was — static, not wrong.
    });
  }, [deviceId, recordLive]);

  const streamUrl = useMemo(
    () => (deviceId == null ? null : withVDOM(`${apiUrl}/policy/device/${deviceId}/topology-live/stream`)),
    [deviceId],
  );

  useLiveStream<TopologyLive>({
    url: streamUrl,
    eventName: "topology-live",
    onMessage: recordLive,
    fallbackPoll: pollLive,
    fallbackPollMs: LIVE_POLL_MS,
  });

  const liveForDevice = live && device && live.deviceId === device.id ? live : null;

  // The live overlay owns the two things the stage needs from live data: the per-node `up`
  // override and the per-edge activity tier.
  const { nodes: liveNodes, activity, measured } = useMemo(() => applyLiveOverlay(
    topo,
    topo.nodes,
    liveForDevice?.current.data ?? null,
    liveForDevice?.previous?.data ?? null,
    liveForDevice?.previous ? (liveForDevice.current.at - liveForDevice.previous.at) / 1000 : 0,
  ), [topo, liveForDevice]);

  const stage = useMemo(
    () => buildStage({
      topo: { ...topo, nodes: liveNodes },
      interfaces: sections.interfaces,
      routes: sections.routes,
    }),
    [topo, liveNodes, sections.interfaces, sections.routes],
  );
  const layout = useMemo(() => layoutStage(stage), [stage]);
  const palette = PALETTE[currentMode === "Dark" ? "dark" : "light"];

  // ── The user's own pinned devices ──────────────────────────────────────────
  // Auxiliary devices (a switch, an access point, a server) this firewall pings on a schedule. They
  // are a layer ON TOP of the firewall-derived scene — see stage/userDevices.ts — and the list is
  // polled so the scheduler's fresh up/down readings reach the map without a manual refresh.
  const [userDevices, setUserDevices] = useState<TopologyDevice[]>([]);
  const [editRequestId, setEditRequestId] = useState<number | null>(null);

  // The only state write is inside the async `.then`, never synchronously in the effect — so the
  // list loads once and then every 15s (to pick up the scheduler's fresh up/down readings) without
  // setting state during render.
  const loadUserDevices = useCallback(() => {
    ListTopologyDevices()
      .then(setUserDevices)
      .catch(() => { /* best-effort: the firewall map still stands on its own */ });
  }, []);

  useEffect(() => {
    loadUserDevices();
    const id = window.setInterval(loadUserDevices, 15000);
    return () => window.clearInterval(id);
  }, [loadUserDevices]);

  // On open — and whenever the firewall in view changes — ask that firewall to re-ping every pinned
  // device NOW, so the map confirms what is actually up this second instead of showing a status left
  // over from the last scheduled sweep (which a user read as a device being down while it was still
  // up). Best-effort and non-blocking: the list has already rendered from its last-known readings, and
  // the fresh result just replaces them when the re-check lands.
  const [rechecking, setRechecking] = useState(false);
  useEffect(() => {
    if (deviceId == null) return;
    let cancelled = false;
    // Every state write lives inside this async callback, never synchronously in the effect body —
    // the same rule loadUserDevices follows above, so a device switch cannot set state during render.
    void (async () => {
      setRechecking(true);
      try {
        await RecheckTopologyDevices(deviceId);
        if (!cancelled) loadUserDevices();
      } catch { /* best-effort — the scheduled sweep still keeps the map current */ }
      finally { if (!cancelled) setRechecking(false); }
    })();
    return () => { cancelled = true; };
  }, [deviceId, loadUserDevices]);

  // Only the devices pinned to the firewall currently in view — the map is that firewall's.
  const myDevices = useMemo(
    () => userDevices.filter((d) => deviceId == null || d.device_id === deviceId),
    [userDevices, deviceId],
  );
  const userLayout = useMemo(() => layoutUserDevices(myDevices, layout), [myDevices, layout]);

  const hiddenPaths = Math.max(0, topo.edges.length - ARC_CAP);
  const ranked = useMemo(() => rankEdges(topo.edges, activity), [topo.edges, activity]);

  const openNode = (n: PlacedNode | { route: string }) => navigate(n.route);
  const openSocket = () => navigate("/admin/fw-interfaces");
  // A path leads to the rule base. It does not carry the pair through: the policy page's Matrix
  // view is where a pair is selected, and sending a filter across a route that cannot show the grid
  // it came from would leave the operator looking at a filtered table with no way back.
  const openEdge = () => navigate("/admin/firewall-policy");

  if (!device) return <NoDeviceState />;

  const busy = viewState(topo.nodes.length) === "loading" || loading;

  return (
    <div className="space-y-4">
      {!busy && !fatal && <TopologyKpis stage={stage} topo={topo} />}

      {/* The page title and breadcrumb come from the navbar, same as every other page since the
          Dastone pass. This row carries only the manual refresh. */}
      <div className="flex items-center justify-end gap-2">
        <button className="btn btn-soft btn-sm" onClick={() => void reload()} disabled={loading}>
          <FiRefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {busy ? (
        <div className="panel"><LoadingState what="topology" from={device.name} /></div>
      ) : fatal ? (
        <div className="panel">
          <ErrorState
            title={`Could not read the interfaces from ${device.name}`}
            detail={fatal}
            note="Without them there is nothing to draw — this is 'unreadable', not 'a firewall with no ports'"
            onRetry={() => void reload()}
          />
        </div>
      ) : (
        <>
          {topo.unreadable.length > 0 && (
            <div className="banner banner-warn">
              <FiAlertTriangle size={14} className="shrink-0" />
              <span>{`The map is missing its ${topo.unreadable.join(" and ")} — those could not be read. What is drawn is complete for everything else; the missing part is unknown, not absent.`}</span>
            </div>
          )}

          {stage.linkUnreadable && (
            <div className="banner banner-warn">
              <FiAlertTriangle size={14} className="shrink-0" />
              <span>
                Link state could not be read from this device — the ports below show how they are
                CONFIGURED, not whether a cable is in them.
              </span>
            </div>
          )}

          <div className="panel panel-flush overflow-hidden">
            {unsupported ? (
              <div className="p-4">
                <ErrorState
                  title="This browser can't render the 3D topology"
                  detail="WebGL is unavailable, or the 3D scene failed to start."
                  note="Try a different browser, or enable hardware acceleration in this one."
                />
              </div>
            ) : (
              <>
                <div className="h-[clamp(22rem,calc(100vh-26rem),38rem)]">
                  <StageCanvas
                    layout={{ ...layout, bounds: userLayout.bounds }}
                    edges={topo.edges}
                    palette={palette}
                    deviceName={device.name}
                    captions={stage.captions}
                    activity={activity}
                    hover={hover}
                    onHover={setHover}
                    onOpenNode={openNode}
                    onOpenSocket={openSocket}
                    onOpenEdge={openEdge}
                    userDevices={userLayout.nodes}
                    userAnchor={userLayout.anchor}
                    onOpenUserDevice={setEditRequestId}
                    onUnsupported={() => setUnsupported(true)}
                  />
                </div>

                {/* The scene is a WebGL canvas: nothing inside it is in the accessibility tree, and
                    a mesh has no keyboard focus. This list is the keyboard/screen-reader path into
                    exactly the same actions the scene's own tiles, jacks and paths expose. */}
                <div className="sr-only" aria-label={`Topology of ${device.name}, as a list`}>
                  {stage.nodes.map((n) => (
                    <button key={n.id} type="button" onClick={() => openNode(n)}>
                      {`${n.label} — ${n.detail}`}
                    </button>
                  ))}
                  {stage.sockets.map((s) => (
                    <button key={s.name} type="button" onClick={openSocket}>
                      {`Port ${s.name} — ${s.state === "up" ? "link up"
                        : s.state === "unknown" ? "link state not reported"
                          : s.unused ? "nothing configured" : "link down"}`}
                    </button>
                  ))}
                  {ranked.map((e) => {
                    const a = stage.nodes.find((n) => n.id === e.from);
                    const b = stage.nodes.find((n) => n.id === e.to);
                    if (!a || !b) return null;
                    return (
                      <button key={e.id} type="button" onClick={openEdge}>
                        {`${e.policies} ${e.policies === 1 ? "rule" : "rules"} between ${a.label} and ${b.label}${e.nat ? " · NAT" : ""}${e.uninspected ? " · no inspection" : ""}${measured.has(e.id) ? " · measured" : ""}`}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* The legend is HTML, not drawn into the scene: it has to be translated and to size
                itself, and it stays readable at any camera angle. */}
            {!unsupported && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t hairline-2 px-4 py-2.5">
                <span className="t-label m-0">Paths</span>
                <span className="flex items-center gap-1.5 t-meta">
                  <span style={{ width: 18, height: 2, background: "var(--flow-allow)" }} /> permitted
                </span>
                <span className="flex items-center gap-1.5 t-meta">
                  <span style={{ width: 18, height: 3, background: "var(--flow-warn)" }} /> nothing inspecting it
                </span>
                <span className="flex items-center gap-1.5 t-meta">
                  <span style={{ width: 18, height: 0, borderTop: "2px dashed var(--flow-deny)" }} /> deny only
                </span>
                {hiddenPaths > 0 && (
                  <span className="t-meta">
                    {`+${hiddenPaths} more not drawn — the ${ARC_CAP} shown are the ones with an issue or traffic`}
                  </span>
                )}
                <span className="t-label m-0 ml-2">Ports</span>
                <span className="flex items-center gap-1.5 t-meta">
                  <span className="h-2 w-2 rounded-full" style={{ background: "var(--flow-allow)" }} /> link up
                </span>
                <span className="t-meta">
                  {`${stage.ports.jacks} jacks · ${stage.fold.unused.length} with nothing configured`}
                  {stage.fold.system.length > 0 && ` · ${stage.fold.system.length} off-panel`}
                </span>
              </div>
            )}
          </div>

          {/* The user's own devices on this firewall — add one, and it is pinged on a schedule and
              drawn on the map above. */}
          <UserDevicePanel
            devices={myDevices}
            firewallId={device.id}
            firewallName={device.name}
            rechecking={rechecking}
            onChanged={loadUserDevices}
            editRequestId={editRequestId}
            onEditRequestHandled={() => setEditRequestId(null)}
          />
        </>
      )}
    </div>
  );
};

export default TopologyPage;
