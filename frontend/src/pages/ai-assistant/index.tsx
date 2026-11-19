import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiAlertTriangle, FiTrash2 } from "react-icons/fi";
import { useAuth } from "../../contexts/AuthContext.logic";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import { type ChatMessage } from "../../api/ai";
import { useAiJob } from "../../contexts/AiJobContext.logic";
import {
  CreateConfigDeploy, CreateConfigQuery, GetConfigDeploy,
  type ConfigDeploy,
} from "../../api/device";
import { type ParsedPolicy } from "./parsePolicyCLI";
import { canApplyViaREST, countRESTApplicable, applyViaREST,
  type AppliedObject, type RestoreSnapshot } from "./applyViaREST";
import { summarizeApplyImpact, type ApplyImpact } from "./applyImpact";
import ApplyConfirmModal from "./ApplyConfirmModal";
import { useAiConversation } from "./useAiConversation";
import { undoApply, restoreKeepsSecret } from "./undoApply";
import { takeSimReturn } from "./simulateHandoff";
import { hasFlowDrafts } from "./deviceFacts";
import { pairOf, useAnchorFor } from "./placement";
import { useFlowContext } from "./flowContext";
import { type PolicyScope } from "./WizardPanel";
import { useComposerInput } from "./useComposerInput";
// The undo/"already applied" kind vocabularies + their lookup tables. Extracted so they are built
// once at module load instead of on every one of this component's stream-driven re-renders.
import { wizKey } from "./undoKinds";

import { useVoiceInput } from "./useVoiceInput";

// The page's data model — transcript entries, the right-hand panel's shape, and the pure function
// that turns a finished suggestion into a chat item. See ./chat-model.ts.
//
// ChatItem is re-exported because other files import the type from here. buildAssistantItem is
// NOT: a value re-export makes this page export something that is not a component, and nothing
// imported it from here anyway — chat-model.ts is where it lives.
import {
  TERMINAL, MAX_CONTEXT_CHARS,
  buildAssistantItem,
  type ChatItem, type QueryContext, type ActiveWizard,
} from "./chat-model";

export type { ChatItem };

import { ChatTranscript } from "./ChatTranscript";
import { ChatComposer } from "./ChatComposer";
import { ResultPanel } from "./ResultPanel";
import { apiErrorDetail, apiErrorText } from "../../api/errorText";

const AiAssistantPage: React.FC = () => {
  // isAdmin from the context: it trims and lower-cases, which `role === "admin"` did not.
  const { isAdmin, user } = useAuth();
  const userProfileSrc: string = user?.profile?.trim() || "";
  const userFullName: string = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  const { currentColor } = useStateContext();

  // Device — the console-wide selection from the navbar picker. This page used to hold its own
  // device dropdown, which meant the firewall the AI was reasoning about (and applying to) could
  // silently differ from the one every other page was showing.
  const { device: selectedDevice, devices, loading: loadingDevices } = useSelectedDevice();
  const deviceId = selectedDevice?.id ?? null;

  // Chat
  const [items, setItems]   = useState<ChatItem[]>([]);
  const [input, setInput]   = useState("");

  // ── Live stream of the in-flight answer ────────────────────────────────────
  // The model writes ~60 tokens/s, so a full proposal takes ~30s. We render the text as it
  // arrives instead of holding a spinner for the whole time. Deltas land ~30x/second, which is
  // far more often than the eye needs — they are accumulated in a ref and flushed to state on a
  // timer so a long chat isn't re-rendered on every fragment.
  //
  // This is DISPLAY ONLY. The deployable result is the ConfigSuggestion from the `done` event.
  // ── The in-flight request lives in AiJobProvider, not here ─────────────────
  //
  // A model answer takes ~30 seconds, and this page used to own the request: navigating away
  // unmounted the component and the finished answer landed nowhere. The job now runs above the
  // router (contexts/AiJobContext), so this page only STARTS one, mirrors it while it streams, and
  // claims the outcome — whether or not it was mounted when the model finished.
  const aiJob = useAiJob();

  /** The live answer, or null when nothing is in flight. Derived — never stored twice. */
  const streamView = aiJob.job?.status === "running" ? aiJob.job.stream : null;

  /** True while a request is running, including one started before this page was re-opened. */
  const asking = aiJob.job?.status === "running";

  // Deploy/Query
  const [deploying, setDeploying] = useState(false);
  const [deploy, setDeploy]       = useState<ConfigDeploy | null>(null);

  // Policy Wizard — takes over the right-hand panel when open
  const [activeWizard, setActiveWizard] = useState<ActiveWizard | null>(null);

  // ── Flow chart ─────────────────────────────────────────────────────────────
  //
  // A proposal arrives as CLI, and CLI does not show you that "Deny-LAN-to-WAN" stops 10.0.1.0/24
  // from reaching the Internet — the subnet, the interface and the direction are in three different
  // places. The charts are drawn from the SAME parsed drafts the wizards and Apply use, so the
  // picture cannot describe something other than what the button will build.
  //
  // `simPanel` is only WHICH message the right-hand panel is showing; the still frame in the chat
  // needs no state at all, because it is derived from the message it sits under.
  // Seeded from takeSimReturn(), so coming back from the Simulate page reopens the panel it left.
  const [simPanel, setSimPanel] = useState<number | null>(takeSimReturn);

  // The device facts that turn "LAN-Subnet" into "LAN-Subnet · 10.0.1.0/24" — an object the AI
  // REUSED has no value anywhere in the CLI. Read lazily: a conversation that never produces config
  // never touches the firewall for this.
  const needFlowCtx = useMemo(
    () => items.some((it) => it.role === "assistant" && hasFlowDrafts(it)),
    [items],
  );
  const { ctx: flowCtx, loading: flowCtxLoading } = useFlowContext(deviceId, needFlowCtx);

  // The three panel contents share one slot. A wizard opening while the simulation is up must clear
  // it, or cancelling the wizard would reveal a walk the user had already moved on from.
  useEffect(() => { if (activeWizard) setSimPanel(null); }, [activeWizard]);

  const openSimPanel = useCallback((itemIndex: number) => {
    setActiveWizard(null);
    setSimPanel(itemIndex);
  }, []);

  // The pending Apply, held while the confirmation dialog is open. Apply is one click away from
  // writing to a live firewall, so every path to it stops here first — see requestApply below.
  const [applyConfirm, setApplyConfirm] = useState<
    { itemIndex: number; commands: string[]; impact: ApplyImpact } | null
  >(null);
  // Which wizard buttons have been applied (keyed "itemIndex:kind") → turn green + checkmark
  // so the user can see, e.g., that the Address Wizard for a chat item was already created.
  const [appliedWizards, setAppliedWizards] = useState<Set<string>>(new Set());
  const markWizardApplied = (i: number, kind: string) => setAppliedWizards((s) => new Set(s).add(wizKey(i, kind)));
  // One green ✓ line in the chat per object that reached the device.
  const pushSuccess = useCallback((text: string) => setItems((prev) => [...prev, { role: "success", text }]), []);
  // One amber line per object Fallback removed again.
  const pushFallback = useCallback((text: string) => setItems((prev) => [...prev, { role: "fallback", text }]), []);

  // ── Fallback (undo) ────────────────────────────────────────────────────────
  // What each chat message actually put on the device — Apply's REST result and every object its
  // wizards created, keyed by the message it came from. This is the ONLY source Fallback deletes
  // from: an object that already existed (skipped by Apply, read-only in the wizards) or one that a
  // wizard merely UPDATED never lands here, so Fallback can only ever remove what we created.
  const [appliedObjects, setAppliedObjects] = useState<Map<number, AppliedObject[]>>(new Map());
  const [undoingItem, setUndoingItem]       = useState<number | null>(null);

  // recordEdited is the mirror of recordCreated for a wizard that UPDATED an object instead of
  // creating one. Deleting it would destroy config the user already had, so the entry carries the
  // pre-edit payload and Fallback writes that back instead.
  const recordEdited = useCallback(
    (i: number | undefined, kind: RestoreSnapshot["kind"], label: string, name: string, before: unknown) => {
      if (i == null || before == null) return;
      recordCreatedRef.current(i, [{
        kind, label: `${label} (edited)`, name,
        restore: { kind, payload: before } as RestoreSnapshot,
      }]);
    }, []);

  const recordCreated = useCallback((i: number | undefined, objs: AppliedObject[]) => {
    if (i == null || objs.length === 0) return;
    setAppliedObjects((prev) => {
      const next = new Map(prev);
      const cur = next.get(i) ?? [];
      // Same object twice (Apply then a wizard) is one thing on the device — one entry to remove.
      const seen = new Set(cur.map((o) => `${o.kind}:${o.name}`));
      next.set(i, [...cur, ...objs.filter((o) => !seen.has(`${o.kind}:${o.name}`))]);
      return next;
    });
  }, []);
  // recordEdited is declared above recordCreated (it reads better next to the undo bookkeeping),
  // so it reaches it through a ref instead of forcing a reorder of the whole callback block.
  const recordCreatedRef = useRef(recordCreated);
  recordCreatedRef.current = recordCreated;

  // Special "deploy" pseudo-kind marks that a message's CLI was Applied directly (not via a
  // wizard). Applying either way locks BOTH paths for that message so nothing is applied twice.
  const APPLY_KIND = "deploy";
  const applyDone   = (i: number) => appliedWizards.has(wizKey(i, APPLY_KIND));
  // The wizard kinds a given chat message offers (from its parsed drafts).
  const wizardKinds = (it: ChatItem): string[] => {
    const ks: string[] = [];
    if (it.policyDraft) ks.push("policy");
    if (it.avDraft)     ks.push("antivirus");
    if (it.webDraft)    ks.push("webfilter");
    if (it.dnsDraft)    ks.push("dnsfilter");
    if (it.vipDraft)    ks.push("virtualip");
    if (it.appDraft)    ks.push("appcontrol");
    if (it.addrDraft)   ks.push("address");
    if (it.svcDraft)    ks.push("service");
    if (it.routeDraft)  ks.push("route");
    if (it.schedDraft)  ks.push("schedule");
    if (it.ffDraft)     ks.push("filefilter");
    if (it.ugDraft)     ks.push("usergroup");
    if (it.ulDraft)     ks.push("userdef");
    if (it.ldapDraft)   ks.push("ldapserver");
    if (it.radDraft)    ks.push("radiusserver");
    if (it.sdwanDraft)  ks.push("sdwan");
    return ks;
  };
  // Apply is locked once this message has been acted on either way: its CLI was deployed, OR at
  // least one wizard object it offers was created (re-applying the CLI would then double-create /
  // conflict). The user finishes any remaining objects through their still-active wizard buttons.
  const messageApplied = (i: number, it: ChatItem) =>
    applyDone(i) || wizardKinds(it).some((k) => appliedWizards.has(wizKey(i, k)));

  // ── Multi-policy helpers ─────────────────────────────────────────────────────

  const policyNameOf = (p: ParsedPolicy) => p.form.name ?? p.target;
  // Names of THIS message's policies already on the device (from the undo ledger, which only holds
  // objects we actually created). Drives the dropdown ✓, per-policy read-only, and the Apply-ALL lock.
  const appliedPolNames = (i: number) =>
    new Set((appliedObjects.get(i) ?? []).filter((o) => o.kind === "policy").map((o) => o.name));
  const allPoliciesDone = (i: number, it: ChatItem) => {
    if (applyDone(i)) return true;
    const names = (it.policyDrafts ?? []).map(policyNameOf).filter(Boolean);
    if (!names.length) return false;
    const done = appliedPolNames(i);
    return names.every((n) => done.has(n));
  };

  // Shared placement anchor per (message, interface-pair): opening a sibling policy starts where the
  // first one was placed, and moving one moves the group (requirement: ตัวแรกเลือกแบบไหน ตัวสองตาม auto).
  const [groupAnchors, setGroupAnchors] = useState<Map<string, number | null>>(new Map());
  const anchorForPolicy = useAnchorFor(groupAnchors);

  // ── Conversation persistence ───────────────────────────────────────────────
  // Restore on arrival, save as it changes, flush on unmount, and empty it when the session ends:
  // all of that is ./useAiConversation. What stays here is the two things only this component can
  // do — put a snapshot back into its state, and empty that state.
  const { hasConversation, onClearChat } = useAiConversation({
    deviceId, loadingDevices, items, input, asking,
    appliedWizards, appliedObjects, groupAnchors,

    restore: (saved) => {
      setItems(saved.items);
      setInput(saved.input);
      setAppliedWizards(new Set(saved.appliedWizards));
      setAppliedObjects(new Map(saved.appliedObjects));
      setGroupAnchors(new Map(saved.groupAnchors));
    },

    // Everything derived from the transcript goes with it — an open wizard, a dry-run panel, a
    // deployment view and a parked background job all describe messages that are no longer on
    // screen, and leaving any of them behind puts a proposal back in front of someone who just
    // cleared it.
    reset: () => {
      aiJob.cancel();
      setItems([]);
      setInput("");
      setAppliedWizards(new Set());
      setAppliedObjects(new Map());
      setGroupAnchors(new Map());
      setActiveWizard(null);
      setDeploy(null);
      setSimPanel(null);
      setApplyConfirm(null);
      setQueryCtx(null);
      setUndoingItem(null);
    },
  });

  // scopeForPolicy prepares ONE policy of a multi-policy suggestion for its wizard.
  //
  // ROBUSTNESS: it hands the wizard the FULL set of prerequisite DEFINITIONS the whole suggestion
  // produced — every address / service / schedule / profile — NOT just the ones this policy happens to
  // reference. The wizard's ensureReferenced* only CREATES what the active policy actually points at, so
  // extra definitions cost nothing; but if we scoped them per-policy and a definition landed under the
  // "wrong" policy (a shared schedule the AI attached to the sibling, an ordering quirk), applying this
  // policy would fail with "…has no definition to create it". Full definitions make that impossible —
  // any policy can always build any object the suggestion defined, in any apply order.
  //
  // The Related-Objects dropdown is still narrowed to THIS policy's references inside PolicyWizard, so
  // the wider definition set never clutters the UI. `siblings` stays scoped to the same interface pair
  // for placement coordination.
  const scopeForPolicy = (it: ChatItem, k: number): PolicyScope => {
    const drafts = it.policyDrafts ?? [];
    const p = drafts[k];
    const myPair = pairOf(p.form);
    return {
      draft: p.form,
      target: p.target,
      selfOrder: k,
      pendingAddresses: it.addrDrafts ?? [],
      pendingServices:  it.svcDrafts  ?? [],
      pendingSchedules: it.schedDrafts ?? [],
      pendingProfiles:  it.prereqBlocks ?? [],
      pendingAV:  it.avDraft,
      pendingWeb: it.webDraft,
      pendingDNS: it.dnsDraft,
      pendingVIPs: it.vipDrafts ?? [],
      pendingApp: it.appDraft,
      pendingFF:  it.ffDraft,
      siblings: drafts
        .map((d, idx) => ({ name: policyNameOf(d), order: idx, pair: pairOf(d.form) }))
        .filter((s, idx) => idx !== k && s.pair === myPair)
        .map((s) => ({ name: s.name, order: s.order })),
    };
  };

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef  = useRef<HTMLDivElement | null>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  // Which chat item (if any) triggered the in-flight Apply deploy, so we can mark it applied on SUCCESS.
  const deployItemRef  = useRef<number | null>(null);
  const deployIsApplyRef = useRef(false);

  // ── Auto-Context Injection ──────────────────────────────────────────────────
  // Stores the last Fetch (query) output so the user can ask follow-up questions
  // about the actual device state. Cleared after first use.
  const [queryCtx, setQueryCtx]     = useState<QueryContext | null>(null);
  const pendingCmdsRef              = useRef<string[]>([]); // commands for current query

  // ── Auto-fetch ──────────────────────────────────────────────────────────────
  // When the model answers with read commands (mode="query"), the device used to be read only after
  // the user pressed "Fetch from Device" and then asked again. Now the console does both for them:
  // it runs those reads itself and feeds the output straight back for a final answer, in one go.
  //   · autoFetchReq   — a read the model just asked for, waiting to be run
  //   · pendingAutoAnswer — the ORIGINAL question to re-ask once the read output is captured
  //   · autoFetched    — questions already auto-read once, so a second read request cannot loop
  const [autoFetchReq, setAutoFetchReq] = useState<{ prompt: string; commands: string[] } | null>(null);
  const pendingAutoAnswerRef            = useRef<string | null>(null);
  const autoFetchedRef                  = useRef<Set<string>>(new Set());

  // ── Voice ──────────────────────────────────────────────────────────────────
  // Dictation, its three refusal paths and the Web Speech plumbing live in ./useVoiceInput.
  const { listening, voiceSupported, voiceSecure, toggleListening, stopListening } = useVoiceInput(input, setInput);

  // The poll that follows a running deploy is stopped on unmount here; the recogniser stops itself
  // inside the hook above. Two cleanups rather than one, so neither owns the other's lifetime.
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const accentGrad = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 65%, #a855f7))`;

  // Follow the conversation — including the answer being streamed in right now.
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [items, streamView]);

  // ── Capture query output → store as AI context ─────────────────────────────
  const captureQueryContext = useCallback((d: ConfigDeploy) => {
    if (d.mode !== "query" || d.status !== "SUCCESS") return;
    const rawOutput = (d.results ?? [])
      .map((r) => r.output?.trim())
      .filter(Boolean)
      .join("\n---\n");
    if (!rawOutput) return;

    const truncated = rawOutput.slice(0, MAX_CONTEXT_CHARS);
    const suffix    = rawOutput.length > MAX_CONTEXT_CHARS ? "\n[... output truncated]" : "";

    setQueryCtx({
      cmd:    pendingCmdsRef.current.join(" ; "),
      output: truncated + suffix,
      device: "", // will be filled in onSend using selectedDevice at that moment
    });
  }, []);

  // ── Terminal handler — capture query context + lock the Apply that started it ──
  const handleTerminal = useCallback((d: ConfigDeploy) => {
    captureQueryContext(d);
    // A successful direct Apply locks its chat message: the Apply button and all its wizard
    // buttons go green so nothing can be re-applied.
    if (d.mode !== "query" && d.status === "SUCCESS"
        && deployIsApplyRef.current && deployItemRef.current != null) {
      markWizardApplied(deployItemRef.current, APPLY_KIND);
    }
    if (TERMINAL.includes(d.status)) { deployIsApplyRef.current = false; deployItemRef.current = null; }
  }, [captureQueryContext]);

  // ── Polling ────────────────────────────────────────────────────────────────
  const startPolling = useCallback((id: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const d = await GetConfigDeploy(id);
        setDeploy(d);
        if (TERMINAL.includes(d.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          handleTerminal(d);
        }
      } catch { /* retry */ }
    }, 1500);
  }, [handleTerminal]);

  // ── Build history (truncated, max 16 items) ────────────────────────────────
  const buildHistory = useCallback((chatItems: ChatItem[]): ChatMessage[] => {
    const recent = chatItems.filter((it) => it.role !== "error").slice(-16);
    return recent.flatMap((it) => {
      let content = it.text || "";
      if (it.role === "assistant" && it.suggestion?.commands?.length) {
        content += `\nCLI commands:\n${it.suggestion.commands.join("\n")}`;
      }
      content = content.slice(0, 2000);
      if (!content) return [];
      return [{ role: it.role as "user" | "assistant", content }];
    });
  }, []);

  // ── Send message ───────────────────────────────────────────────────────────
  /**
   * Stop generating — abandon the answer in flight and KEEP the conversation.
   *
   * aiJob.cancel() aborts the request (which stops the model billing for tokens nobody will read)
   * and drops the job; it deliberately does not touch `items`, so the question the user asked is
   * still in the transcript and they can rephrase it with everything else intact. That separation
   * is the whole point: resetConversation calls the same cancel and then empties the page.
   */
  // ── The composer's own state: attachments and ↑/↓ history ──────────────────
  // Both are about the text box and nothing else, so they live in ./useComposerInput. Enter sends,
  // which is defined below this line — so it is reached through a ref, the same way recordCreated
  // is above.
  const onSendRef = useRef<(overridePrompt?: string) => void>(() => {});
  const {
    images, setImages, fileInputRef, addFiles, onPasteComposer, removeImage,
    histIdx, setHistIdx, onKeyDown,
  } = useComposerInput({ items, input, setInput, onSend: () => onSendRef.current() });

  const stopAnswer = useCallback(() => {
    aiJob.cancel();
    message.info("Stopped. The conversation is kept — ask again or rephrase.");
  }, [aiJob]);

  const onSend = useCallback(async (overridePrompt?: string) => {
    stopListening();
    const prompt = (overridePrompt ?? input).trim();
    if (!prompt) return;
    if (!deviceId) { message.warning("Pick a device first"); return; }

    // Images ride along only with a hand-typed send — a retry / example chip / auto-fetch re-ask
    // must not silently re-attach whatever is sitting in the composer.
    const attached = overridePrompt ? [] : images;

    const history = buildHistory(items);

    // ── Auto-Context Injection ──────────────────────────────────────────────
    // If there is a pending query context (from a recent "Fetch from Device"),
    // append it to the prompt so the AI can answer questions about real device state.
    let finalPrompt = prompt;
    let hasContext  = false;

    if (queryCtx) {
      const devLabel = devices.find((d) => d.id === deviceId)
        ? `${devices.find((d) => d.id === deviceId)!.name} (${devices.find((d) => d.id === deviceId)!.mgmt_ip})`
        : "FortiGate";
      const cmdLine  = queryCtx.cmd ? `Command: ${queryCtx.cmd}\n` : "";
      finalPrompt = `${prompt}\n\n---\n[Live CLI output from ${devLabel} — collected with Fetch from Device]\n${cmdLine}Output:\n${queryCtx.output}\n---`;
      hasContext  = true;
      setQueryCtx(null); // ← single-use: clear after injecting
    }

    // Add user message to chat (display shows original prompt, not the injected version)
    setItems((prev) => [...prev, {
      role: "user", text: prompt, hasContext,
      images: attached.length ? attached.map((im) => ({ dataUrl: im.dataUrl })) : undefined,
    }]);
    if (!overridePrompt) { setInput(""); setImages([]); }
    setHistIdx(-1);

    // Hand the request to the provider above the router and return immediately. Nothing is awaited
    // here any more: the answer is collected by the effect below, which runs whenever this page is
    // mounted — including a mount that happens minutes later, after the model has already finished.
    aiJob.start({
      deviceId, prompt, sentPrompt: finalPrompt, history,
      images: attached.length ? attached.map((im) => ({ media_type: im.media_type, data: im.data })) : undefined,
    });
  }, [input, deviceId, items, listening, buildHistory, queryCtx, devices, aiJob, images]);

  onSendRef.current = onSend;

  // ── Collect a finished job ─────────────────────────────────────────────────
  //
  // Runs on every render where a job is not running, which covers both cases that matter: the
  // answer arriving while the page is open, and the page being re-opened after it arrived.
  // `claim()` hands the job over exactly once, so a re-render cannot append the same reply twice.
  useEffect(() => {
    const pending = aiJob.job;
    if (!pending || pending.status === "running") return;

    const done = aiJob.claim();
    if (!done) return;

    // The device selector is app-wide, so it can have moved while the model was thinking. An answer
    // written about one firewall must never be filed under another's conversation.
    if (done.deviceId !== deviceId) {
      message.warning("The AI answer was for a different device and was discarded");
      return;
    }

    if (done.status === "error") {
      const errMsg = done.error || "The AI request failed";
      message.error(errMsg, 6);
      setItems((prev) => [...prev, { role: "error", text: errMsg, retryPrompt: done.prompt }]);
      // Put the question back only if the composer is empty — the user may have typed a new one
      // while this was running, and overwriting that would be worse than losing a retry shortcut.
      setInput((cur) => (cur.trim() ? cur : done.prompt));
      return;
    }
    if (done.result) {
      setItems((prev) => [...prev, buildAssistantItem(done.result!)]);
      // Auto-fetch: the model asked to READ the device (query mode with show/get commands). Run them
      // now and re-ask with the output, so the user gets a real answer without a "Fetch" click. Guard
      // on the original prompt so a model that asks to read a SECOND time cannot loop forever.
      const r = done.result;
      if (r.mode === "query" && r.commands && r.commands.length > 0
          && !autoFetchedRef.current.has(done.prompt)) {
        autoFetchedRef.current.add(done.prompt);
        setAutoFetchReq({ prompt: done.prompt, commands: r.commands });
      }
    }
  }, [aiJob, deviceId]);

  // ── Run Query — also captures output for AI context ───────────────────────
  const runQuery = useCallback(async (commands: string[]) => {
    if (!deviceId) return;
    pendingCmdsRef.current = commands; // store for context capture
    // The flow chart and the result panel share the right-hand slot, so anything still up would hide
    // the output this query is about to produce.
    setSimPanel(null);
    setDeploying(true);
    try {
      const res   = await CreateConfigQuery({ device_id: deviceId, command_text: commands.join("\n") });
      const first = await GetConfigDeploy(res.id);
      setDeploy(first);
      if (TERMINAL.includes(first.status)) {
        handleTerminal(first); // immediate result
      } else {
        startPolling(res.id); // will capture when done
      }
    } catch (e) {
      // A read we started ourselves for auto-fetch failed — drop the pending re-ask so a later,
      // unrelated query output cannot be mistaken for this one's.
      pendingAutoAnswerRef.current = null;
      message.error(apiErrorDetail(e, "Query failed"));
    }
    finally { setDeploying(false); }
  }, [deviceId, startPolling, handleTerminal]);

  // autoAnswer re-asks the model the ORIGINAL question with the freshly-read CLI output injected. It
  // does NOT add the question to the transcript again — it is already there; only the final answer is
  // appended, when the job it starts is collected above.
  const autoAnswer = useCallback((originalPrompt: string) => {
    if (!deviceId) return;
    const history = buildHistory(items);
    const dev = devices.find((d) => d.id === deviceId);
    const devLabel = dev ? `${dev.name} (${dev.mgmt_ip})` : "FortiGate";
    const cmdLine = queryCtx?.cmd ? `Command: ${queryCtx.cmd}\n` : "";
    const sentPrompt =
      `${originalPrompt}\n\n---\n[Live CLI output from ${devLabel} — read automatically to answer this]\n` +
      `${cmdLine}Output:\n${queryCtx?.output ?? ""}\n---`;
    setQueryCtx(null);
    aiJob.start({ deviceId, prompt: originalPrompt, sentPrompt, history });
  }, [items, devices, deviceId, queryCtx, buildHistory, aiJob]);

  // Step 1 — the model asked to read: run those reads now. pendingAutoAnswer records which question
  // we are reading FOR, so the capture below re-asks the right one.
  useEffect(() => {
    if (!autoFetchReq) return;
    pendingAutoAnswerRef.current = autoFetchReq.prompt;
    void runQuery(autoFetchReq.commands);
    setAutoFetchReq(null);
  }, [autoFetchReq, runQuery]);

  // Step 2 — the read output has been captured into queryCtx: re-ask for the final answer. The guard
  // on pendingAutoAnswer is what keeps this from firing on a MANUAL fetch (where it is never set).
  useEffect(() => {
    if (queryCtx && pendingAutoAnswerRef.current) {
      const p = pendingAutoAnswerRef.current;
      pendingAutoAnswerRef.current = null;
      autoAnswer(p);
    }
  }, [queryCtx, autoAnswer]);

  // runDeploy — the chat's "Apply" button.
  //
  // Fast path (canApplyViaREST): create every object over the REST device-proxy, exactly as the
  // wizards do. Measured on the lab FortiGate, a one-address suggestion took ~17s through the
  // SSH/worker pipeline (Redis queue → netmiko → two full-config snapshots for the diff) and
  // ~0.25s over REST. Same objects, same validation — only the transport changed.
  //
  // Fallback: a suggestion containing a section we have no REST endpoint for (VPN, SD-WAN, DHCP,
  // HA, system settings…) — or one that DELETES / UNSETS anything, which the object-by-object
  // applier cannot express — still goes through the config-deploy pipeline, unchanged.
  const runDeploy = useCallback(async (commands: string[], itemIndex?: number) => {
    if (!deviceId) return;
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    const cli = commands.join("\n");
    // Same slot as the simulation. Leaving it up would hide the SSH pipeline's own before/after diff
    // — the only feedback the fallback path gives.
    setSimPanel(null);
    setDeploying(true);

    // ── Fast path: REST, object by object ──
    if (canApplyViaREST(cli)) {
      try {
        const created = await applyViaREST(deviceId, cli, (o) =>
          pushSuccess(`Create ${o.label} "${o.name}" Success`));
        if (created.length === 0) {
          // Nothing landed — but WHY matters, and saying "already exists" for a CLI we simply
          // cannot build is how the delete bug read as success for so long.
          if (countRESTApplicable(cli) > 0) {
            message.info("Everything in this config already exists on the device");
          } else {
            message.warning("No creatable object was found in this config — nothing was sent to the device");
          }
        } else {
          message.success(`Applied ${created.length} object${created.length > 1 ? "s" : ""} to the device`);
        }
        // Remember them so this message's Fallback button can take exactly these back off again.
        recordCreated(itemIndex, created);
        if (itemIndex != null) markWizardApplied(itemIndex, APPLY_KIND);
      } catch (e) {
        message.error(apiErrorText(e, "Apply failed"));
      } finally {
        setDeploying(false);
      }
      return;
    }

    // ── Fallback: the SSH/worker pipeline (sections with no REST endpoint) ──
    deployIsApplyRef.current = true;
    deployItemRef.current    = itemIndex ?? null;
    try {
      const res   = await CreateConfigDeploy({ device_ids: [deviceId], command_text: cli });
      const first = await GetConfigDeploy(res.id);
      setDeploy(first);
      if (!TERMINAL.includes(first.status)) startPolling(res.id);
      else handleTerminal(first);
    } catch (e) {
      message.error(apiErrorDetail(e, "Job failed"));
    } finally { setDeploying(false); }
  }, [deviceId, isAdmin, startPolling, handleTerminal, pushSuccess, markWizardApplied, recordCreated]);

  // requestApply — the gate in front of runDeploy.
  //
  // Apply used to write to a live firewall on a single click. It now opens a confirmation that says
  // WHAT is about to be built and WHAT TRAFFIC that changes, because "are you sure?" on its own adds
  // a click and no information — people learn to click straight through it.
  //
  // The summary is computed from the CLI text alone (summarizeApplyImpact), so the dialog opens
  // instantly and cannot fail: it is deliberately the cheap half of the question. The precise half —
  // which of these objects the device ALREADY has, and where its copy differs — needs device reads
  // and stays where it was, behind Dry-run, which the dialog points at.
  //
  // Both routes to Apply come through here: the chat button and the Dry-run panel's own Apply.
  const requestApply = useCallback((commands: string[], itemIndex: number) => {
    if (!deviceId) return;
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    setApplyConfirm({
      itemIndex,
      commands,
      // The model states its own impact in the tool's `impact` field; the dialog shows it next to
      // ours, labelled as the model's claim rather than mixed in. The explanation is still passed
      // because a transcript restored from before that field existed carries the impact as prose.
      impact: summarizeApplyImpact(
        commands.join("\n"),
        items[itemIndex]?.text,
        items[itemIndex]?.suggestion?.impact,
      ),
    });
  }, [deviceId, isAdmin, items]);

  const confirmApply = useCallback(() => {
    if (!applyConfirm) return;
    const { commands, itemIndex } = applyConfirm;
    setApplyConfirm(null);
    void runDeploy(commands, itemIndex);
  }, [applyConfirm, runDeploy]);

  // runFallback — the chat's "Fallback" button.
  //
  // The user applied a suggestion, their network then misbehaved, and they want out. This removes
  // every object THIS message put on the device — policy first, then the objects it referenced —
  // and says so in the chat, one amber line per object, so there is a record of what was rolled back.
  const runFallback = useCallback(async (itemIndex: number) => {
    if (!deviceId) return;
    if (!isAdmin) { message.warning("Only admins can change config on the device"); return; }
    const objs = appliedObjects.get(itemIndex) ?? [];
    if (objs.length === 0) return;

    setUndoingItem(itemIndex);
    try {
      // A created object is DELETED; an edited one is RESTORED to how it was. Saying "เอาออก"
      // for a restore would be wrong — the object is still there, just back to its old settings.
      const { removed, failed } = await undoApply(deviceId, objs, (o) =>
        pushFallback(o.restore
          ? `Fallback: ${o.label} "${o.name}" — previous values restored`
          : `Fallback: ${o.label} "${o.name}"`));

      if (removed.length) {
        const restored = removed.filter((o) => o.restore);
        const deleted = removed.length - restored.length;
        const parts = [
          deleted ? `Removed ${deleted} object(s) from the firewall` : "",
          restored.length ? `Restored ${restored.length} object(s)` : "",
        ].filter(Boolean);
        message.success(`Fallback success — ${parts.join(" · ")}`);

        // The device never returns a stored password or shared secret, so a restore cannot put an
        // OLD one back. Say so instead of letting the user assume the rollback was total.
        const withSecrets = restored.filter(restoreKeepsSecret);
        if (withSecrets.length) {
          setItems((prev) => [...prev, {
            role: "assistant",
            text: `Note: ${withSecrets.map((o) => `"${o.name}"`).join(", ")} ` +
              "had every field restored except passwords and secrets — FortiGate never hands those back. " +
              "If the apply changed a password, set it again yourself in the wizard.",
          }]);
        }
      }
      if (failed.length) {
        // Partial rollback is the honest outcome to show: FortiGate refuses to delete an object
        // something else still uses (error -23), and we do not force it.
        failed.forEach((f) => setItems((prev) => [...prev,
          { role: "error", text: `Fallback failed for ${f.obj.label} "${f.obj.name}" — ${f.error}` }]));
        message.warning(`Fallback incomplete — ${failed.length} object(s) are still on the device`);
      }

      // Only the objects that are really gone leave the undo list. Whatever is still on the device
      // stays listed, so pressing Fallback again retries exactly those.
      const goneKeys = new Set(removed.map((o) => `${o.kind}:${o.name}`));
      const leftover = objs.filter((o) => !goneKeys.has(`${o.kind}:${o.name}`));
      setAppliedObjects((prev) => {
        const next = new Map(prev);
        if (leftover.length) next.set(itemIndex, leftover);
        else next.delete(itemIndex);
        return next;
      });
      if (!leftover.length) {
        // The device is back to where it was, so this message can be applied again.
        setAppliedWizards((s) => {
          const next = new Set(s);
          [...next].filter((k) => k.startsWith(`${itemIndex}:`)).forEach((k) => next.delete(k));
          return next;
        });
      }
    } catch (e) {
      message.error(apiErrorText(e, "Fallback failed"));
    } finally {
      setUndoingItem(null);
    }
  }, [deviceId, isAdmin, appliedObjects, pushFallback]);

  const running = deploy && !TERMINAL.includes(deploy.status);

  return (
    <div className="space-y-4">
      {/* Only the PROBLEM cases. Which firewall is selected is the navbar's job, and repeating it
          here just put the same two facts on screen twice. What the navbar cannot say is why there
          is nothing to talk to — an empty inventory needs a different action from an unmade
          choice, so those two keep a line. */}
      {!selectedDevice && (
        <div className="banner banner-warn">
          <FiAlertTriangle size={14} className="shrink-0 text-amber-500" />
          <span className="ink-2 font-semibold">
            {loadingDevices
              ? "Loading devices…"
              : devices.length === 0
              ? "No FortiGate has been added yet — add one on the Devices page first"
              : "Pick a FortiGate from the selector in the top bar to start"}
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">

        {/* ── Chat Panel ── */}
        <div className="flex flex-col overflow-hidden rounded-sm border hairline-2 surface-card shadow-sm"
          style={{ height: "620px" }}>

          <div className="flex shrink-0 items-center justify-between gap-3 border-b hairline-2 px-5 py-3">
            <p className="m-0 text-[12px] font-bold uppercase tracking-wide ink-2">AI Chat</p>
            {/* Clear sits here rather than under the composer because it acts on the transcript
                above it, and it is disabled — not hidden — on an empty chat: a control that comes
                and goes is harder to find again than one that greys out. */}
            <button type="button" onClick={() => void onClearChat()}
              disabled={!hasConversation}
              title={hasConversation
                ? (asking ? "Stop the answer and empty this conversation" : "Empty this conversation")
                : "Nothing to clear yet"}
              className="inline-flex items-center gap-1.5 rounded-[4px] border hairline px-2.5 py-1 text-[11px] font-semibold ink-2 transition surface-hover disabled:cursor-not-allowed disabled:opacity-40">
              <FiTrash2 size={12} /> Clear
            </button>
          </div>

          <ChatTranscript
            accentGrad={accentGrad} currentColor={currentColor}
            userProfileSrc={userProfileSrc} userFullName={userFullName} isAdmin={isAdmin}
            items={items} streamView={streamView} asking={asking} bottomRef={bottomRef}
            deviceId={deviceId} deploying={deploying}
            appliedObjects={appliedObjects} appliedWizards={appliedWizards}
            applyDone={applyDone} messageApplied={messageApplied}
            appliedPolNames={appliedPolNames} allPoliciesDone={allPoliciesDone}
            undoingItem={undoingItem}
            simPanel={simPanel} setSimPanel={setSimPanel} openSimPanel={openSimPanel}
            setActiveWizard={setActiveWizard}
            onSend={onSend} requestApply={requestApply} runFallback={runFallback}
          />

          <ChatComposer
            accentGrad={accentGrad} currentColor={currentColor}
            selectedDevice={selectedDevice} deviceId={deviceId}
            asking={asking}
            input={input} setInput={setInput} inputRef={inputRef}
            histIdx={histIdx} setHistIdx={setHistIdx} onKeyDown={onKeyDown}
            images={images} fileInputRef={fileInputRef} addFiles={addFiles}
            onPasteComposer={onPasteComposer} removeImage={removeImage}
            queryCtx={queryCtx} setQueryCtx={setQueryCtx}
            listening={listening} voiceSupported={voiceSupported} voiceSecure={voiceSecure}
            toggleListening={toggleListening}
            onSend={onSend} stopAnswer={stopAnswer}
          />
        </div>

        <ResultPanel
          currentColor={currentColor} selectedDevice={selectedDevice} isAdmin={isAdmin}
          items={items}
          activeWizard={activeWizard} setActiveWizard={setActiveWizard}
          scopeForPolicy={scopeForPolicy} anchorForPolicy={anchorForPolicy}
          groupAnchors={groupAnchors} setGroupAnchors={setGroupAnchors}
          appliedPolNames={appliedPolNames}
          simPanel={simPanel} setSimPanel={setSimPanel}
          flowCtx={flowCtx} flowCtxLoading={flowCtxLoading}
          deploy={deploy} running={!!running}
          markWizardApplied={markWizardApplied} pushSuccess={pushSuccess}
          recordCreated={recordCreated} recordEdited={recordEdited}
        />
      </div>

      {/* Apply confirmation — the last stop before anything reaches the firewall. */}
      <ApplyConfirmModal
        open={!!applyConfirm}
        impact={applyConfirm?.impact ?? null}
        deviceName={selectedDevice?.name}
        busy={deploying}
        onCancel={() => setApplyConfirm(null)}
        onConfirm={confirmApply}
      />
    </div>
  );
};

export default AiAssistantPage;
