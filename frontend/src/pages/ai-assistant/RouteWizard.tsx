import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiCheck, FiChevronLeft, FiChevronRight, FiGitBranch, FiHardDrive, FiX } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import { DeviceListStaticRoutes, DeviceCreateStaticRoute, DeviceUpdateStaticRoute } from "../../api/policyObject";
import { RouteFieldsDestination, RouteFieldsSettings, type RouteFieldsProps } from "../static-routes/route-form";
import { useRouteOptions, buildRoutePayload, validateRouteForm, routeToForm, type RouteFormState } from "../static-routes/route-form.logic";
import { routeDraftToForm } from "./parseRouteCLI";
import WizardApplyButton from "./WizardApplyButton";
import { objectApplyImpact } from "./wizardImpact";
import { apiErrorDetail } from "../../api/errorText";

type StepDef = { key: string; label: string; Component: React.FC<RouteFieldsProps> };

const STEPS: StepDef[] = [
  { key: "destination", label: "Destination & Gateway", Component: RouteFieldsDestination },
  { key: "settings",    label: "Route Settings",        Component: RouteFieldsSettings },
];

// A human label for the route, for success messages ("172.16.0.0/24 via dmz").
function routeLabel(f: RouteFormState): string {
  const dst = f.dstType === "internet-service" ? (f.internetServiceName || `Internet Service ${f.internetService ?? ""}`) : (f.dst || "route");
  const via = f.device === "blackhole" ? "Blackhole" : (f.device ? `via ${f.device}` : (f.gateway ? `via ${f.gateway}` : ""));
  return `${dst}${via ? " " + via : ""}`.trim();
}

const RouteWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: Partial<RouteFormState>;
  target?: string;    // current seq-num on the device (edit); empty/undefined = create
  readOnly?: boolean; // true = already applied → review only
  currentColor: string;
  onApplied: (label: string, wasEdit: boolean) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, readOnly = false, currentColor, onApplied, onCancel }) => {
  const [form, setForm]     = useState<RouteFormState>(() => routeDraftToForm(draft));
  const [isEdit, setIsEdit] = useState(false);
  const [editSeq, setEditSeq] = useState<number | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep]     = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { interfaces, services, loadingSvc } = useRouteOptions(device.id);
  const set = <K extends keyof RouteFormState>(k: K, v: RouteFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  // Detect whether the AI-proposed route already exists so Apply becomes an update.
  // Match by seq-num first (the `edit <n>` key), then fall back to an identical
  // destination — the wizard prefills from the live route and overlays the AI's changes.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    DeviceListStaticRoutes(device.id).then((routes) => {
      if (cancelled) return;
      const bySeq = target && /^\d+$/.test(target) ? routes.find((r) => r.seq_num === Number(target)) : undefined;
      const byDst = !bySeq && draft.dst ? routes.find((r) => r.dst_type === "subnet" && r.dst === draft.dst) : undefined;
      const existing = bySeq || byDst;
      if (existing) {
        setIsEdit(true);
        setEditSeq(existing.seq_num);
        setForm(routeDraftToForm(draft, routeToForm(existing)));
      }
    }).catch(() => { /* treat as create */ }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, draft, target]);

  const isLastStep = step === STEPS.length - 1;
  const StepComponent = STEPS[step].Component;
  const fieldsProps: RouteFieldsProps = { form, set, errors, interfaces, services, loadingSvc, currentColor };

  const goNext = () => {
    // Step 1 must at least identify a destination before advancing.
    if (step === 0) {
      const errs: Record<string, string> = {};
      if (form.dstType === "internet-service") { if (!form.internetService) errs.internetService = "Select an Internet Service"; }
      else if (!form.dst.trim()) errs.dst = "Destination subnet is required";
      if (Object.keys(errs).length) { setErrors(errs); return; }
      setErrors({});
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleApply = async () => {
    const errs = validateRouteForm(form);
    if (Object.keys(errs).length) {
      setErrors(errs);
      setStep(errs.dst || errs.internetService || errs.gateway ? 0 : 1);
      message.error("Please fix the highlighted fields");
      return;
    }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    setErrors({});
    try {
      setSaving(true);
      const payload = buildRoutePayload(form);
      if (isEdit && editSeq != null) await DeviceUpdateStaticRoute(device.id, editSeq, payload);
      else                          await DeviceCreateStaticRoute(device.id, payload);
      message.success(`${isEdit ? "Update" : "Create"} Static Route ${routeLabel(form)} Success`);
      onApplied(routeLabel(form), isEdit);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} route`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b hairline-2 px-4 py-2.5 shrink-0">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: currentColor }}>
          <FiGitBranch size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold ink">
            AI Static Route Wizard
            {!checking && (
              <span className="ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                style={{ background: isEdit ? "#f59e0b20" : `${currentColor}20`, color: isEdit ? "#b45309" : currentColor }}>
                {isEdit ? `EDIT #${editSeq}` : "CREATE NEW"}
              </span>
            )}
          </p>
          <p className="flex items-center gap-1 truncate text-[10px] ink-3">
            <FiHardDrive size={9} /> {hostname || device.name}
          </p>
        </div>
        <button type="button" onClick={onCancel}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] ink-3 surface-hover hover-ink transition">
          <FiX size={13} />
        </button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 px-4 py-2.5 border-b hairline-2 shrink-0 overflow-x-auto">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && <div className="h-px w-3 shrink-0" style={{ background: i <= step ? currentColor : "#e2e8f0" }} />}
            <button type="button" onClick={() => i < step && setStep(i)} disabled={i > step}
              className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold transition disabled:cursor-default"
              style={{
                background: i === step ? currentColor : i < step ? `${currentColor}15` : "transparent",
                color: i === step ? "white" : i < step ? currentColor : "#94a3b8",
              }}>
              <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                style={{
                  background: i === step ? "rgba(255,255,255,.25)" : i < step ? `${currentColor}22` : "#e2e8f0",
                  color: i === step ? "white" : i < step ? currentColor : "#94a3b8",
                }}>
                {i + 1}
              </span>
              {i === step && <span className="pr-0.5">{s.label}</span>}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto">
        {readOnly && (
          <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
            <FiCheck size={12} /> Already applied — review only (read-only)
          </div>
        )}
        {checking
          ? <div className="flex items-center gap-2 px-6 py-8 text-[12px] ink-3">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 hairline border-t-transparent" />
              Checking device for an existing route…
            </div>
          : <div style={readOnly ? { pointerEvents: "none", opacity: 0.7 } : undefined}><StepComponent {...fieldsProps} /></div>}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-2 border-t hairline-2 px-4 py-3 shrink-0">
        <button type="button" onClick={() => step === 0 ? onCancel() : setStep((s) => s - 1)}
          className="flex items-center gap-1.5 rounded-[4px] border hairline px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
          <FiChevronLeft size={13} /> {step === 0 ? (readOnly ? "Close" : "Cancel") : "Back"}
        </button>

        <span className="text-[10px] ink-3">Step {step + 1} of {STEPS.length}</span>

        {isLastStep ? (
          readOnly ? (
            <button type="button" disabled
              className="flex items-center gap-1.5 rounded-[4px] px-4 py-1.5 text-[12px] font-semibold text-white cursor-default"
              style={{ background: "#16a34a" }}>
              <FiCheck size={13} /> Applied
            </button>
          ) : (
            <WizardApplyButton
              isEdit={isEdit} saving={saving} disabled={!isAdmin || checking}
              title={!isAdmin ? "Only admins can apply config changes" : ""}
              deviceName={hostname || device.name}
              onApply={handleApply}
              buildImpact={() => {
                const dst = form.dstType === "internet-service" ? form.internetServiceName : form.dst;
                return objectApplyImpact({
                  kind: "static-route", label: "Static Route", name: dst || "route", isEdit,
                  facts: [`distance ${form.distance} · priority ${form.priority}`],
                  effects: [
                    form.device === "blackhole"
                      ? `All traffic to ${dst} is dropped (blackhole)`
                      : `Traffic to ${dst} leaves through ${form.device || "the chosen interface"}` +
                        (form.gateway ? ` via gateway ${form.gateway}` : ""),
                  ],
                  // 0.0.0.0/0 is the default route: this does not add a path, it decides where
                  // everything the firewall does not otherwise know about goes.
                  warnings: /^0\.0\.0\.0(\/0)?/.test(form.dst) ? [
                    "This is the default route (0.0.0.0/0) — changing it affects every packet with no more specific route",
                  ] : [],
                });
              }}
            />
          )
        ) : (
          <button type="button" onClick={goNext} disabled={checking}
            className="flex items-center gap-1.5 rounded-[4px] px-4 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50"
            style={{ background: currentColor }}>
            Next <FiChevronRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
};

export default RouteWizard;
