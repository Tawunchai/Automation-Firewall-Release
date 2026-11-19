import React from "react";
import { FiHardDrive } from "react-icons/fi";
import DiffView from "../../components/ui/DiffView";
import PanelBoundary from "../../components/ui/PanelBoundary";
import SimulateSlot from "./SimulateSlot";
import WizardPanel, { type PolicyScope } from "./WizardPanel";
import { RESULT_DOT, type ActiveWizard, type ChatItem } from "./chat-model";
import type { FlowContext } from "./deviceFacts";
import type { AppliedObject, RestoreSnapshot } from "./applyViaREST";
import type { ConfigDeploy, NetworkDevice } from "../../api/device";

/**
 * The right-hand slot: whatever the page is currently showing beside the chat.
 *
 * One slot, three tenants, and they are mutually exclusive on purpose — a wizard reviewing a draft,
 * the Simulate panel for one message, or the output of the last deploy/query. Two of them on screen
 * at once would be two different claims about what the firewall is doing right now.
 *
 * Lifted out of the page component unchanged.
 */
export type ResultPanelProps = {
  currentColor: string;
  selectedDevice: NetworkDevice | null;
  isAdmin: boolean;

  items: ChatItem[];

  /** The wizard tenant. */
  activeWizard: ActiveWizard | null;
  setActiveWizard: React.Dispatch<React.SetStateAction<ActiveWizard | null>>;
  scopeForPolicy: (it: ChatItem, k: number) => PolicyScope;
  /** Placement is shared per (message, interface pair) so siblings follow the first one. */
  anchorForPolicy: (i: number, it: ChatItem, k: number) => number | null;
  groupAnchors: Map<string, number | null>;
  setGroupAnchors: React.Dispatch<React.SetStateAction<Map<string, number | null>>>;
  /** Which of this message's policies are already on the device. */
  appliedPolNames: (i: number) => Set<string>;

  /** The Simulate tenant. */
  simPanel: number | null;
  setSimPanel: React.Dispatch<React.SetStateAction<number | null>>;
  flowCtx: FlowContext;
  flowCtxLoading: boolean;

  /** The deploy/query tenant. */
  deploy: ConfigDeploy | null;
  running: boolean;

  /** What a wizard reports back when it has written to the firewall. */
  markWizardApplied: (i: number, kind: string) => void;
  pushSuccess: (text: string) => void;
  recordCreated: (i: number | undefined, objs: AppliedObject[]) => void;
  recordEdited: (
    i: number | undefined, kind: RestoreSnapshot["kind"], label: string, name: string, before: unknown,
  ) => void;
};

export const ResultPanel: React.FC<ResultPanelProps> = (ctx) => {
  const {
    currentColor, selectedDevice, isAdmin, items,
    activeWizard, setActiveWizard, scopeForPolicy, anchorForPolicy,
    groupAnchors, setGroupAnchors, appliedPolNames,
    simPanel, setSimPanel, flowCtx, flowCtxLoading,
    deploy, running,
    markWizardApplied, pushSuccess, recordCreated, recordEdited,
  } = ctx;

  return (
    <>
        {/* ── Deploy/Query Result Panel — or the Policy Wizard when reviewing a draft ── */}
        <div className="overflow-hidden rounded-sm border hairline-2 surface-card shadow-sm"
          style={{ height: "620px" }}>

          {activeWizard && selectedDevice ? (
            <PanelBoundary what="the AI wizard">
              <WizardPanel
                device={selectedDevice}
                isAdmin={isAdmin}
                currentColor={currentColor}
                activeWizard={activeWizard}
                items={items}
                groupAnchors={groupAnchors}
                setGroupAnchors={setGroupAnchors}
                appliedPolNames={appliedPolNames}
                scopeForPolicy={scopeForPolicy}
                setActiveWizard={setActiveWizard}
                markWizardApplied={markWizardApplied}
                pushSuccess={pushSuccess}
                recordCreated={recordCreated}
                recordEdited={recordEdited}
              />
            </PanelBoundary>
          ) : simPanel != null && items[simPanel] && selectedDevice ? (
            // The panel and the page it expands into, one component: SimulateSlot resolves the
            // wizard's placement anchors and owns the navigation, so neither of them has to.
            <SimulateSlot itemIndex={simPanel} item={items[simPanel]} hostname={selectedDevice.name}
              ctx={flowCtx} enriching={flowCtxLoading} accent={currentColor}
              anchorFor={(k) => anchorForPolicy(simPanel, items[simPanel], k)}
              onClose={() => setSimPanel(null)} />
          ) : (
            <>
              <div className="flex items-center justify-between border-b hairline-2 px-5 py-3 shrink-0">
                <p className="text-[12px] font-bold uppercase tracking-wide ink-2">
                  {deploy?.mode === "query" ? "Query Result" : "Deploy Result"}
                </p>
                {deploy && (
                  <div className="flex items-center gap-2">
                    {deploy.mode === "query" && (
                      <span className="rounded-[5px] border border-purple-200 bg-purple-50 px-2 py-0.5 text-[9px] font-bold text-purple-700">QUERY</span>
                    )}
                    <span className="flex h-2 w-2 rounded-full" style={{ backgroundColor: RESULT_DOT[deploy.status] || "#94a3b8" }} />
                    <span className="text-[11px] font-semibold" style={{ color: RESULT_DOT[deploy.status] || "#94a3b8" }}>{deploy.status}</span>
                    {running && <span className="text-[11px] text-blue-500 animate-pulse">Running…</span>}
                  </div>
                )}
              </div>

              <div className="overflow-y-auto p-4" style={{ height: "calc(620px - 53px)" }}>
                {!deploy ? (
              <div className="flex flex-col items-center py-16 ink-3">
                <FiHardDrive size={28} className="mb-3 opacity-30" />
                <p className="text-[13px]">No job yet</p>
                <p className="mt-1 text-[11px] ink-3">Ask AI for commands, then click Apply or Fetch</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(deploy.results ?? []).map((r) => {
                  const dot = RESULT_DOT[r.status] || "#94a3b8";
                  return (
                    <div key={r.id} className="overflow-hidden rounded-[5px] border hairline">
                      <div className="flex items-center justify-between surface-sunken px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dot }} />
                          <span className="text-[12px] font-semibold ink">{r.device_name}</span>
                          <span className="text-[11px] font-semibold" style={{ color: dot }}>{r.status}</span>
                        </div>
                        {r.before_backup_id > 0 && (
                          <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-[5px]">
                            💾 rollback #{r.before_backup_id}
                          </span>
                        )}
                      </div>
                      <div className="p-3">
                        {r.status === "FAILED" ? (
                          <p className="text-[12px] text-red-500 font-mono">{r.error}</p>
                        ) : deploy.mode === "query" ? (
                          <pre className="max-h-48 overflow-auto bg-[#1a1a1a] rounded-[5px] p-3 text-[11px] leading-relaxed text-green-300 font-mono whitespace-pre-wrap">
                            {r.output || "(no output)"}
                          </pre>
                        ) : (
                          <div className="space-y-2">
                            <span className={`rounded-[5px] border px-2 py-0.5 text-[9px] font-bold ${r.changed ? "border-yellow-200 bg-yellow-50 text-yellow-700" : "hairline surface-sunken ink-2"}`}>
                              {r.changed ? "Config Changed" : "No Change"}
                            </span>
                            {r.diff && <DiffView text={r.diff} summaryOnly />}
                            {r.output && (
                              <pre className="max-h-32 overflow-auto bg-[#1a1a1a] rounded-[5px] p-3 text-[11px] leading-relaxed text-[#d4d4d4] font-mono whitespace-pre-wrap">
                                {r.output}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
              </div>
            </>
          )}
        </div>
    </>
  );
};
