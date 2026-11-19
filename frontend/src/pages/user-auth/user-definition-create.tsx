import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { FiUser, FiChevronLeft, FiChevronRight, FiSave, FiAlertTriangle } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ListDevices, type NetworkDevice } from "../../api/device";
import { DeviceCreateUser, DeviceGetInfo } from "../../api/policyObject";
import { UserAuthInfoPanel, WizardSteps } from "./user-auth-panel";
import { WIZARD_STEP_COMPONENTS } from "./user-definition-steps";
import { WIZARD_STEPS, validateStep, useLocalUserOptions, buildLocalUserPayload, BLANK_LOCAL_USER_FORM, type LocalUserFormState } from "./user-definition-form.logic";
import { apiErrorDetail } from "../../api/errorText";

export const USER_DOCS_HREF =
  "https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/954635/local-users";

// The FortiGate "Users/Groups Creation Wizard", Local User branch: four steps, each validated
// on Next so a bad field is caught on the step that owns it.
const UserDefinitionCreatePage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [hostname, setHostname] = useState("");
  const [loadingDev, setLoadingDev] = useState(true);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<LocalUserFormState>(BLANK_LOCAL_USER_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof LocalUserFormState>(k: K, v: LocalUserFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  const { options, loading: loadingOptions } = useLocalUserOptions(device?.id);

  useEffect(() => {
    const id = searchParams.get("deviceId");
    if (!id) { setLoadingDev(false); return; }
    ListDevices().then(async (list) => {
      const found = list.find((d) => d.id === Number(id)) ?? null;
      setDevice(found);
      if (found) { const info = await DeviceGetInfo(found.id); setHostname(info.hostname || found.name); }
    }).finally(() => setLoadingDev(false));
  }, [searchParams]);

  const isLast = step === WIZARD_STEPS.length - 1;

  const goNext = () => {
    const errs = validateStep(step, form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  };

  const goBack = () => { setErrors({}); setStep((s) => Math.max(s - 1, 0)); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLast) { goNext(); return; }

    // Re-check every step: a user can edit an earlier step and come back.
    const errs: Record<string, string> = {};
    for (let i = 0; i < WIZARD_STEPS.length; i++) Object.assign(errs, validateStep(i, form));
    if (!device) errs.device = "No device selected";
    if (Object.keys(errs).length) {
      setErrors(errs);
      // Jump to the first step that has a problem so the user can see it.
      for (let i = 0; i < WIZARD_STEPS.length; i++) {
        if (Object.keys(validateStep(i, form)).length) { setStep(i); break; }
      }
      return;
    }
    try {
      setSaving(true);
      await DeviceCreateUser(device!.id, buildLocalUserPayload(form));
      message.success(`User "${form.name.trim()}" created on ${hostname || device!.name}`);
      navigate(`/admin/user-definition?deviceId=${device!.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to create user"));
    } finally {
      setSaving(false);
    }
  };

  const StepFields = WIZARD_STEP_COMPONENTS[step];
  const fieldsProps = { form, set, errors, options, loadingOptions, currentColor };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiUser />} title="Users/Groups Creation Wizard" accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[5px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {!loadingDev && !device && (
        <div className="banner banner-danger">
          <FiAlertTriangle size={14} className="shrink-0" /><span>No device — go back and select a device</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 270px" }}>
          <div className="panel min-h-105">
            {/* Done steps are clickable so the user can jump back to fix something. */}
            <WizardSteps steps={WIZARD_STEPS} current={step} currentColor={currentColor}
              onStep={(i) => { setErrors({}); setStep(i); }} />
            <div className="mt-2 border-t hairline-2">
              <StepFields {...fieldsProps} />
            </div>
          </div>

          <UserAuthInfoPanel device={device} hostname={hostname} currentColor={currentColor}
            docsHref={USER_DOCS_HREF} />
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button type="button" onClick={goBack} disabled={step === 0 || saving}
            className="h-10 px-5 rounded-[5px] border hairline text-[13px] font-semibold ink-2 surface-hover transition disabled:opacity-40">
            &lt; Back
          </button>
          <button type="submit" disabled={saving || !device}
            className="h-10 px-6 rounded-[5px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
            style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
            {saving ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</>
              : isLast ? <><FiSave size={14} /> Submit</>
              : <>Next <FiChevronRight size={14} /></>}
          </button>
          <button type="button" onClick={() => navigate(-1)} disabled={saving}
            className="h-10 px-5 rounded-[5px] border hairline text-[13px] font-semibold ink-2 surface-hover transition disabled:opacity-50">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default UserDefinitionCreatePage;
