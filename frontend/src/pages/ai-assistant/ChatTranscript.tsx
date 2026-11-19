import React from "react";
import Tooltip from "../../components/ui/Tooltip";
import {
  FiCpu, FiUser, FiPlay,
  FiAlertTriangle, FiHardDrive,
  FiRotateCcw, FiDatabase, FiShield, FiMapPin, FiZap, FiCheck, FiGitBranch, FiGlobe, FiClock,
  FiCornerUpLeft, FiFile, FiUsers, FiWifi, FiLock, FiKey, FiShare2, FiActivity,
  FiServer as FiServer2,
} from "react-icons/fi";
import aiAssistantIcon from "../../assets/ai_assistant_icon.jpg";
import { confirm } from "../../components/ui/confirm";
import { type AppliedObject } from "./applyViaREST";
import { hasFlowDrafts } from "./deviceFacts";
import { type ChatItem, type ActiveWizard } from "./chat-model";
import type { AiStreamView } from "../../contexts/AiJobContext";
import { AIImpactNote } from "./AIImpactNote";
import { StreamingAnswer } from "./StreamingAnswer";
import { sdwanObjectCount } from "./parseSDWANCLI";
import { EXAMPLE_PROMPTS, promptOf } from "./examplePrompts";
import { wizKey, type WizardBtnKind } from "./undoKinds";

/**
 * The transcript: every bubble in the AI chat, from the empty state's example prompts to the
 * amber Fallback lines that record what was taken back OFF the firewall.
 *
 * Lifted out of the page component unchanged — the body below is the block it came from, so a
 * diff of this split shows a move and nothing else. What it needed from the component's scope is
 * now this one props object rather than a closure, for the same reason the VPN wizard's panels
 * take a WizardCtx: naming the closure once means moving a field between the panel and the page
 * stays a one-line change, and no panel grows a second source of truth.
 *
 * It is deliberately a "dumb" component in one direction only: it reads a lot, and it writes
 * solely through the callbacks the page hands it (Apply, Fallback, open a wizard, open Simulate).
 * Nothing here decides anything about the device.
 */
export type TranscriptProps = {
  /** The accent gradient built from the signed-in user's colour, and the colour itself. */
  accentGrad: string;
  currentColor: string;

  /** Who is reading, for the avatar on their own bubbles. */
  userProfileSrc: string;
  userFullName: string;
  /** Only an admin may Apply or Fall back; everyone else reads the proposal. */
  isAdmin: boolean;

  /** The conversation, and the answer still streaming in under it. */
  items: ChatItem[];
  streamView: AiStreamView | null;
  asking: boolean;
  /** Scroll target kept at the bottom of the list. */
  bottomRef: React.RefObject<HTMLDivElement | null>;

  /** The device the conversation is about; null disables everything that would write. */
  deviceId: number | null;
  /** A deploy or query is in flight, so the Apply buttons are held. */
  deploying: boolean;

  /** What has already been put on the device, per message index. */
  appliedObjects: Map<number, AppliedObject[]>;
  appliedWizards: Set<string>;
  applyDone: (i: number) => boolean;
  messageApplied: (i: number, it: ChatItem) => boolean;
  appliedPolNames: (i: number) => Set<string>;
  allPoliciesDone: (i: number, it: ChatItem) => boolean;
  /** The message whose Fallback is running, so its buttons can say so. */
  undoingItem: number | null;

  /** Which message's Simulate panel is open in the right-hand slot. */
  simPanel: number | null;
  setSimPanel: React.Dispatch<React.SetStateAction<number | null>>;
  openSimPanel: (itemIndex: number) => void;
  setActiveWizard: React.Dispatch<React.SetStateAction<ActiveWizard | null>>;

  /** The three things a bubble can ask the page to do. */
  onSend: (overridePrompt?: string) => void;
  requestApply: (commands: string[], itemIndex: number) => void;
  runFallback: (itemIndex: number) => void;
};

/**
 * The avatar on a message the signed-in person sent — their own profile picture, so a conversation
 * reads as theirs rather than as a row of identical generic heads. Falls back to their initials, and
 * then to the generic icon, because `profile` is frequently empty and an image URL can fail to load.
 */
const ChatUserAvatar: React.FC<{ src?: string; name?: string }> = ({ src, name }) => {
  const [failed, setFailed] = React.useState(false);
  const initials = (name ?? "")
    .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  const box = "flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[5px] surface-sunken ink-2 mt-0.5";
  if (src && !failed) {
    return (
      <div className={box}>
        <img src={src} alt={name || "You"} draggable={false} onError={() => setFailed(true)}
          className="h-full w-full object-cover" />
      </div>
    );
  }
  return (
    <div className={box}>
      {initials
        ? <span className="text-[10px] font-bold leading-none">{initials}</span>
        : <FiUser size={12} />}
    </div>
  );
};

export const ChatTranscript: React.FC<TranscriptProps> = (ctx) => {
  const {
    accentGrad, currentColor, userProfileSrc, userFullName, isAdmin,
    items, streamView, asking, bottomRef, deviceId, deploying,
    appliedObjects, appliedWizards, applyDone, messageApplied, appliedPolNames,
    allPoliciesDone, undoingItem, simPanel, setSimPanel, openSimPanel, setActiveWizard,
    onSend, requestApply, runFallback,
  } = ctx;

  return (
    <>
          {/* Scrollable messages — scroll-none, so the transcript scrolls with no bar drawn.
              The bar sat hard against the card's right edge and read as part of the frame; this is
              a column of bubbles you read rather than a list you point at. Overflow still works. */}
          <div className="flex-1 overflow-y-auto scroll-none p-4 space-y-3">
            {items.length === 0 && (
              <div className="m-auto w-full max-w-sm text-center ink-3 pt-4">
                <FiCpu size={32} className="mx-auto mb-3 opacity-30" />
                <p className="text-[13px] font-semibold ink-2">Ask anything about this FortiGate</p>
                <p className="mt-1 mb-4 text-[11px] ink-3">Type a request, or pick one of the examples below</p>
                {/* One chip per capability, every one of them something a wizard can actually build
                    (examplePrompts.ts). The chip shows a short label and SENDS a more specific
                    prompt — the tooltip shows which — because a vague prompt makes the model ask
                    for details instead of proposing config. Read-only examples keep the plain
                    style, so a click that writes never looks like one that reads. */}
                <div className="flex flex-wrap justify-center gap-1.5">
                  {EXAMPLE_PROMPTS.map((ex) => (
                    <button key={ex.label} type="button"
                      title={promptOf(ex)}
                      onClick={() => deviceId && onSend(promptOf(ex))}
                      disabled={!deviceId}
                      className={`rounded-[5px] border px-2.5 py-1 text-[11px] transition disabled:opacity-40 ${
                        ex.kind === "query"
                          ? "hairline surface-card ink-2 surface-hover"
                          : "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-300"
                      }`}>
                      {ex.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {items.map((it, i) => {

              // ── Error bubble ──
              if (it.role === "error") {
                return (
                  <div key={i} className="flex justify-start">
                    <div className="flex items-start gap-2 max-w-[90%]">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] bg-red-100 text-red-500 mt-0.5">
                        <FiAlertTriangle size={12} />
                      </div>
                      <div className="rounded-[4px] rounded-tl-sm border border-red-200 bg-red-50 px-3.5 py-2.5 dark:border-red-500/20 dark:bg-red-500/8">
                        <p className="text-[12px] text-red-600 dark:text-red-400">{it.text}</p>
                        {it.retryPrompt && (
                          <button type="button"
                            onClick={() => onSend(it.retryPrompt)}
                            disabled={asking}
                            className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-red-500 hover:text-red-700 transition disabled:opacity-50">
                            <FiRotateCcw size={11} /> Try again
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              // ── Success bubble — one per object created on the device ──
              if (it.role === "success") {
                return (
                  <div key={i} className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-sm border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-500/25 dark:bg-emerald-500/10">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <FiCheck size={12} strokeWidth={3} />
                      </span>
                      <p className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">{it.text}</p>
                    </div>
                  </div>
                );
              }

              // ── Fallback bubble — one per object taken back OFF the device ──
              if (it.role === "fallback") {
                return (
                  <div key={i} className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/25 dark:bg-amber-500/10">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
                        <FiCornerUpLeft size={12} strokeWidth={3} />
                      </span>
                      <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-400">{it.text}</p>
                    </div>
                  </div>
                );
              }

              // ── Normal chat bubble ──
              return (
                <div key={i} className={`flex gap-2 ${it.role === "user" ? "justify-end" : "justify-start"}`}>
                  {it.role === "assistant" && (
                    <img src={aiAssistantIcon} alt="AI assistant"
                      className="mt-0.5 h-7 w-7 shrink-0 rounded-[5px] object-cover" />
                  )}

                  <div className={`max-w-[85%] rounded-[4px] px-3.5 py-2.5 text-[13px] leading-relaxed ${
                    it.role === "user"
                      ? "rounded-tr-sm text-white"
                      : "rounded-tl-sm border hairline-2 surface-sunken ink"
                  }`} style={it.role === "user" ? { background: accentGrad } : {}}>
                    {/* Attached images the user sent with this message. Shown above the text, as a
                        compact grid of thumbnails — a live preview that survives until reload (the
                        data URLs are stripped from the persisted session, see session.ts). */}
                    {it.images && it.images.length > 0 && (
                      <div className={`flex flex-wrap gap-1.5 ${it.text ? "mb-2" : ""}`}>
                        {it.images.map((im, k) => (
                          <img key={k} src={im.dataUrl} alt={`attachment ${k + 1}`}
                            className="h-20 w-20 rounded-[6px] border border-white/25 object-cover" draggable={false} />
                        ))}
                      </div>
                    )}
                    {it.text && <p className="whitespace-pre-wrap">{it.text}</p>}

                    {/* The model's impact analysis. It arrives as three tool fields now, not as a
                        section of the explanation, so it has to be drawn — see AIImpactNote. */}
                    {it.role === "assistant" && it.suggestion?.impact && (
                      <AIImpactNote impact={it.suggestion.impact} />
                    )}

                    {/* Context injected indicator — shown on user bubble */}
                    {it.role === "user" && it.hasContext && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-[5px] bg-white/20 px-2 py-0.5 text-[9px] font-semibold text-white/80">
                          <FiDatabase size={8} /> Using CLI output
                        </span>
                      </div>
                    )}

                    {/* CLI command block + action buttons */}
                    {it.suggestion && it.suggestion.commands.length > 0 && (
                      <div className="mt-2 space-y-2">
                        <div className="code-surface overflow-hidden rounded-[5px] border hairline">
                          <div className="code-surface-head">
                            <FiHardDrive size={10} className="text-green-400" />
                            <span className="text-[10px] font-semibold text-green-400">FortiOS CLI</span>
                          </div>
                          <pre className="max-h-52 overflow-auto p-3 text-[11px] leading-relaxed text-green-300 font-mono">
                            {it.suggestion.commands.join("\n")}
                          </pre>
                        </div>
                        {it.suggestion.warning && (
                          <div className="flex items-start gap-1.5 rounded-[5px] border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/8 dark:text-amber-300">
                            <FiAlertTriangle size={12} className="mt-0.5 shrink-0" />
                            {it.suggestion.warning}
                          </div>
                        )}

                        {/* Nothing about the simulation is drawn here. It used to render a still
                            frame under every proposal, which is a picture nobody asked for in a
                            list that re-renders on every streamed token — and it pushed the Apply
                            row off the screen. The Simulate button below opens it on request. */}

                        <div className="flex items-center gap-2">
                          {it.suggestion.mode === "query" ? (
                            // Read commands are run automatically (see the auto-fetch effects) and the
                            // answer is appended below, so there is no "Fetch from Device" button to
                            // press. The CLI above shows what was read; the thinking indicator shows it
                            // is in progress.
                            null
                          ) : (
                            <>
                              {(() => {
                                // States:
                                //   idle    → red "Apply" / "Apply ALL (N)"
                                //   running → BLUE "Running…" + spinner, disabled
                                //   done    → green "Applied ✓", disabled
                                //   partial → GREY, disabled — one policy was already created individually,
                                //             so running "Apply ALL" now would be redundant/confusing. The
                                //             user finishes the remaining policies from the Policy Wizard.
                                // "Apply ALL" creates every policy + referenced object in one pass; it is
                                // only offered as the FIRST action (nothing of this message on the device yet).
                                const nPol = it.policyDrafts?.length ?? 0;
                                const isPol = nPol > 0;
                                const appliedCount = isPol ? appliedPolNames(i).size : 0;
                                const allDone = isPol ? allPoliciesDone(i, it) : messageApplied(i, it);
                                const partial = isPol && appliedCount > 0 && !allDone;
                                const blocked = allDone || partial;
                                const running = deploying && !blocked;
                                const label   = running ? "Running…" : allDone ? "Applied ✓" : nPol >= 2 ? `Apply ALL (${nPol})` : "Apply";
                                return (
                                  <Tooltip title={
                                    !isAdmin ? "Only admins can apply config changes"
                                      : allDone ? "Already applied — nothing to re-apply"
                                      : partial ? "Partly applied — create the remaining policies from the Policy Wizard so objects are not duplicated"
                                      : running ? "Applying to the device…"
                                      : nPol >= 2 ? "Create every policy and the objects they need, in one go" : ""
                                  }>
                                    <button onClick={() => { if (!blocked && !running && isAdmin) requestApply(it.suggestion!.commands, i); }}
                                      disabled={running || !isAdmin || blocked}
                                      className={`flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[11px] font-semibold text-white transition ${blocked || running ? "cursor-default" : "disabled:opacity-50"}`}
                                      style={{
                                        background: allDone ? "var(--flow-allow)"
                                          : partial ? "#94a3b8"                                    // grey = locked-out (partial)
                                          : running ? "linear-gradient(135deg,#2563eb,#3b82f6)"     // blue = working
                                          : "linear-gradient(135deg,#ef4444,#f43f5e)",
                                        opacity: 1,
                                      }}>
                                      {running ? <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                        : allDone ? <FiCheck size={12} /> : <FiPlay size={11} />}
                                      {label}
                                    </button>
                                  </Tooltip>
                                );
                              })()}
                              {(() => {
                                // ── Simulate ──
                                // Walks the proposal down the device's own rule table and reports
                                // which policies stop working. Read-only, so it stays available
                                // before AND after Apply.
                                if (!hasFlowDrafts(it)) return null;
                                const showing = simPanel === i;
                                return (
                                  <Tooltip title="Walk a packet down the rule table and see which policies this one kills">
                                    <button type="button"
                                      onClick={() => (showing ? setSimPanel(null) : openSimPanel(i))}
                                      className="flex items-center gap-1.5 rounded-[5px] border px-3 py-1.5 text-[11px] font-semibold transition"
                                      style={{
                                        borderColor: `${currentColor}55`,
                                        color: currentColor,
                                        background: showing ? `${currentColor}14` : "transparent",
                                      }}>
                                      <FiActivity size={11} /> Simulate
                                    </button>
                                  </Tooltip>
                                );
                              })()}
                              {(() => {
                                // ── Fallback ──
                                // Only shown once this message actually put something on the device,
                                // and it lists exactly what it will remove — on a live firewall the
                                // user should see the six objects before they vanish, not after.
                                const undoable = appliedObjects.get(i) ?? [];
                                if (undoable.length === 0) return null;
                                const undoing = undoingItem === i;
                                return (
                                  // Fallback removes real objects from a live firewall, so it
                                  // confirms first — and the confirmation LISTS what will go, in
                                  // the order it will go, because the reverse-dependency order is
                                  // the part a reader cannot guess.
                                  <Tooltip title={isAdmin ? "" : "Only admins can change config on the device"}>
                                    <button
                                      disabled={undoing || !isAdmin}
                                      onClick={async () => {
                                        const ok = await confirm({
                                          title: "Fallback — remove the objects this apply just created",
                                          content: (
                                            <>
                                              <p className="mb-1 text-[11px] ink-2">
                                                This removes {undoable.length} object(s) from the device — policies first, then the objects they referenced:
                                              </p>
                                              <div className="shell-scroll max-h-40 overflow-y-auto">
                                                {undoable.map((o, k) => (
                                                  <p key={k} className="m-0 text-[11px] font-semibold ink">
                                                    • {o.label} “{o.name}”
                                                  </p>
                                                ))}
                                              </div>
                                            </>
                                          ),
                                          okText: "Fallback",
                                          cancelText: "Cancel",
                                        });
                                        if (ok) runFallback(i);
                                      }}
                                      className="flex items-center gap-1.5 rounded-[5px] border px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-60"
                                      style={{ borderColor: "var(--flow-warn)", color: "var(--flow-warn)", background: "var(--flow-warn-bg)" }}>
                                      {undoing
                                        ? <div className="h-3 w-3 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                                        : <FiCornerUpLeft size={11} />}
                                      {undoing ? "Rolling back…" : `Fallback (${undoable.length})`}
                                    </button>
                                  </Tooltip>
                                );
                              })()}
                              {(() => {
                                // A wizard button: green + checkmark once applied ("created"), so the
                                // user can see the Address (or other object) already exists before
                                // moving on to the Policy Wizard.
                                const WizBtn = (kind: WizardBtnKind,
                                  label: string, icon: React.ReactNode, open: () => void) => {
                                  // Green + check when this wizard was applied OR the CLI was Applied
                                  // directly (which creates everything) — preventing a double create.
                                  const applied = appliedWizards.has(wizKey(i, kind)) || applyDone(i);
                                  return (
                                    <button onClick={open}
                                      className="flex items-center gap-1.5 rounded-[5px] border px-3 py-1.5 text-[11px] font-semibold transition"
                                      style={applied
                                        ? { borderColor: "var(--flow-allow)", color: "var(--flow-allow)", background: "var(--flow-allow-bg)" }
                                        : { borderColor: `${currentColor}40`, color: currentColor }}>
                                      {applied ? <FiCheck size={12} /> : icon}
                                      {label}{applied ? " ✓" : ""}
                                    </button>
                                  );
                                };
                                const ro = (kind: WizardBtnKind) => appliedWizards.has(wizKey(i, kind)) || applyDone(i);

                                // Users, groups and the two remote auth servers are NOT policy
                                // children — a policy references a group at most, and none of them is
                                // created from the policy form — so they keep their own buttons in
                                // both branches. LDAP/RADIUS sit beside the group they authenticate,
                                // because a user group can list an auth server as its member.
                                //
                                // A File Filter profile IS a policy child (set file-filter-profile),
                                // like AntiVirus / Web Filter / App Control: when the suggestion has
                                // a policy it belongs in the Policy Wizard's Related Objects, not
                                // beside it. Only a standalone profile gets a top-level button.
                                const UserWizBtns = (
                                  <>
                                    {it.ulDraft && WizBtn("userdef", `User Wizard${(it.ulDrafts?.length ?? 0) > 1 ? ` (${it.ulDrafts!.length})` : ""}`, <FiUser size={11} />,
                                      () => setActiveWizard({ kind: "userdef", drafts: it.ulDrafts?.length ? it.ulDrafts : [it.ulDraft!], itemIndex: i, readOnly: ro("userdef") }))}
                                    {it.ugDraft && WizBtn("usergroup", `User Group Wizard${(it.ugDrafts?.length ?? 0) > 1 ? ` (${it.ugDrafts!.length})` : ""}`, <FiUsers size={11} />,
                                      () => setActiveWizard({ kind: "usergroup", drafts: it.ugDrafts?.length ? it.ugDrafts : [it.ugDraft!], itemIndex: i, readOnly: ro("usergroup") }))}
                                    {it.ldapDraft && WizBtn("ldapserver", `LDAP Server Wizard${(it.ldapDrafts?.length ?? 0) > 1 ? ` (${it.ldapDrafts!.length})` : ""}`, <FiServer2 size={11} />,
                                      () => setActiveWizard({ kind: "ldapserver", drafts: it.ldapDrafts?.length ? it.ldapDrafts : [it.ldapDraft!], itemIndex: i, readOnly: ro("ldapserver") }))}
                                    {it.radDraft && WizBtn("radiusserver", `RADIUS Server Wizard${(it.radDrafts?.length ?? 0) > 1 ? ` (${it.radDrafts!.length})` : ""}`, <FiKey size={11} />,
                                      () => setActiveWizard({ kind: "radiusserver", drafts: it.radDrafts?.length ? it.radDrafts : [it.radDraft!], itemIndex: i, readOnly: ro("radiusserver") }))}
                                  </>
                                );
                                const FileFilterWizBtn = it.ffDraft && WizBtn("filefilter", "File Filter Wizard", <FiFile size={11} />,
                                  () => setActiveWizard({ kind: "filefilter", draft: it.ffDraft!.form, target: it.ffDraft!.target, itemIndex: i, readOnly: ro("filefilter") }));
                                // SD-WAN is not a policy child — a policy may name an SD-WAN zone as
                                // its outgoing interface, but the zone is not created FROM the policy
                                // form — so it keeps its own button in both branches, like Static Route.
                                const SDWANWizBtn = it.sdwanDraft && WizBtn("sdwan",
                                  `SD-WAN Wizard (${sdwanObjectCount(it.sdwanDraft)})`, <FiShare2 size={11} />,
                                  () => setActiveWizard({ kind: "sdwan", parsed: it.sdwanDraft!, itemIndex: i, readOnly: ro("sdwan") }));
                                // When the suggestion includes a Policy, show ONLY the Policy Wizard
                                // (the main one) — its every related object (Address / Service /
                                // AntiVirus / Web Filter / App Control) is reachable from the Policy
                                // Wizard's own "Related Objects" dropdown. Static Route isn't a policy
                                // child, so it still gets its own button. Suggestions WITHOUT a policy
                                // keep the individual per-object wizard buttons.
                                return (it.policyDrafts?.length ?? 0) > 0 ? (
                                  <>
                                    {/* One "Policy Wizard" button. For 2+ policies it opens the first one
                                        not yet on the device; switching between policies happens INSIDE the
                                        wizard, from the "Policy n/m" selector next to its Objects button.
                                        Every related object (Address / Service / Schedule / AV / Web / App)
                                        is reachable from each policy's own "Related Objects" dropdown. */}
                                    {(() => {
                                      const drafts = it.policyDrafts!;
                                      const applied = appliedPolNames(i);
                                      const doneCount = drafts.filter((d) => applied.has(d.form.name ?? d.target)).length;
                                      const firstOpen = drafts.findIndex((d) => !applied.has(d.form.name ?? d.target));
                                      const openIdx = firstOpen < 0 ? 0 : firstOpen;
                                      const allDone = doneCount === drafts.length;
                                      const multi = drafts.length >= 2;
                                      return (
                                        <button type="button"
                                          onClick={() => setActiveWizard({ kind: "policy", itemIndex: i, policyIdx: openIdx })}
                                          className="flex items-center gap-1.5 rounded-[5px] border px-3 py-1.5 text-[11px] font-semibold transition"
                                          style={allDone
                                            ? { borderColor: "var(--flow-allow)", color: "var(--flow-allow)", background: "var(--flow-allow-bg)" }
                                            : { borderColor: `${currentColor}40`, color: currentColor }}>
                                          {allDone ? <FiCheck size={12} /> : <FiShield size={11} />} Policy Wizard
                                          {multi && (
                                            <span className="rounded-[5px] px-1 text-[9px] font-bold"
                                              style={{ background: allDone ? "color-mix(in srgb, var(--flow-allow) 20%, transparent)" : `${currentColor}18`, color: allDone ? "var(--flow-allow)" : currentColor }}>
                                              {doneCount}/{drafts.length}
                                            </span>
                                          )}
                                          {allDone ? " ✓" : ""}
                                        </button>
                                      );
                                    })()}
                                    {/* A static route is NOT a policy child, so it keeps its own button. */}
                                    {it.routeDraft && WizBtn("route", "Static Route Wizard", <FiGitBranch size={11} />,
                                      () => setActiveWizard({ kind: "route", draft: it.routeDraft!.form, target: it.routeDraft!.target, itemIndex: i, readOnly: ro("route") }))}
                                    {/* No File Filter button here — with a policy present it is a
                                        child of it, reachable from the Policy Wizard's Related
                                        Objects dropdown (same as AntiVirus / Web Filter / App Control). */}
                                    {SDWANWizBtn}
                                    {UserWizBtns}
                                  </>
                                ) : (
                                  <>
                                    {/* A whole VPN tunnel (Site-to-Site / Remote Access / Hub-and-Spoke): reviewed in
                                        the chat like every other wizard and created over REST — no longer a jump to a
                                        separate page. */}
                                    {it.vpnDraft && WizBtn("vpn",
                                      `VPN Wizard · ${it.vpnDraft.kind === "hub-spoke" ? "Hub-Spoke" : it.vpnDraft.kind === "remote-access" ? "Remote" : "S2S"}`,
                                      <FiLock size={11} />,
                                      () => setActiveWizard({ kind: "vpn", draft: it.vpnDraft!.payload, vpnKind: it.vpnDraft!.kind, target: "", itemIndex: i, readOnly: ro("vpn") }))}
                                    {it.avDraft && WizBtn("antivirus", "AntiVirus Wizard", <FiShield size={11} />,
                                      () => setActiveWizard({ kind: "antivirus", draft: it.avDraft!.form, target: it.avDraft!.target, itemIndex: i, readOnly: ro("antivirus") }))}
                                    {it.webDraft && WizBtn("webfilter", "Web Filter Wizard", <FiGlobe size={11} />,
                                      () => setActiveWizard({ kind: "webfilter", draft: it.webDraft!.form, target: it.webDraft!.target, itemIndex: i, readOnly: ro("webfilter") }))}
                                    {it.dnsDraft && WizBtn("dnsfilter", "DNS Filter Wizard", <FiWifi size={11} />,
                                      () => setActiveWizard({ kind: "dnsfilter", draft: it.dnsDraft!.form, target: it.dnsDraft!.target, itemIndex: i, readOnly: ro("dnsfilter") }))}
                                    {it.vipDraft && WizBtn("virtualip", "Virtual IP Wizard", <FiGlobe size={11} />,
                                      () => setActiveWizard({ kind: "virtualip", draft: it.vipDraft!.form, target: it.vipDraft!.target, itemIndex: i, readOnly: ro("virtualip") }))}
                                    {it.appDraft && WizBtn("appcontrol", "App Control Wizard", <FiCpu size={11} />,
                                      () => setActiveWizard({ kind: "appcontrol", parsed: it.appDraft!, target: it.appDraft!.target, itemIndex: i, readOnly: ro("appcontrol") }))}
                                    {/* One button per KIND, not per object: a suggestion that defines ten
                                        addresses opens a single wizard whose "Addresses 3/10" dropdown
                                        pages through them (see MultiObjectWizard). */}
                                    {it.addrDraft && WizBtn("address", `Address Wizard${(it.addrDrafts?.length ?? 0) > 1 ? ` (${it.addrDrafts!.length})` : ""}`, <FiMapPin size={11} />,
                                      () => setActiveWizard({ kind: "address", drafts: it.addrDrafts?.length ? it.addrDrafts : [it.addrDraft!], itemIndex: i, readOnly: ro("address") }))}
                                    {it.svcDraft && WizBtn("service", `Service Wizard${(it.svcDrafts?.length ?? 0) > 1 ? ` (${it.svcDrafts!.length})` : ""}`, <FiZap size={11} />,
                                      () => setActiveWizard({ kind: "service", drafts: it.svcDrafts?.length ? it.svcDrafts : [it.svcDraft!], itemIndex: i, readOnly: ro("service") }))}
                                    {it.schedDraft && WizBtn("schedule", `Schedule Wizard${(it.schedDrafts?.length ?? 0) > 1 ? ` (${it.schedDrafts!.length})` : ""}`, <FiClock size={11} />,
                                      () => setActiveWizard({ kind: "schedule", drafts: it.schedDrafts?.length ? it.schedDrafts : [it.schedDraft!], itemIndex: i, readOnly: ro("schedule") }))}
                                    {it.routeDraft && WizBtn("route", "Static Route Wizard", <FiGitBranch size={11} />,
                                      () => setActiveWizard({ kind: "route", draft: it.routeDraft!.form, target: it.routeDraft!.target, itemIndex: i, readOnly: ro("route") }))}
                                    {/* No policy in this suggestion ⇒ the profile stands alone and
                                        needs its own way in. */}
                                    {FileFilterWizBtn}
                                    {SDWANWizBtn}
                                    {UserWizBtns}
                                  </>
                                );
                              })()}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {it.role === "user" && (
                    <ChatUserAvatar src={userProfileSrc} name={userFullName} />
                  )}
                </div>
              );
            })}

            {/* Live answer — the model's text as it is written (preview only; the deployable CLI
                arrives with the `done` event and replaces this bubble with a real chat item). */}
            {asking && (
              <StreamingAnswer view={streamView} />
            )}
            <div ref={bottomRef} />
          </div>
    </>
  );
};
