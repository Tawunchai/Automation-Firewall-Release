import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import { UserAuthFormPage } from "./UserAuthFormPage";
import { sectionHdr } from "../fw-addresses/address-form";
import { DeviceGetUser, DeviceUpdateUser } from "../../api/policyObject";
import { USER_DOCS_HREF } from "./user-definition-create";
import { LoginCredentialsStep, ContactInfoStep, ExtraInfoStep } from "./user-definition-form";
import { validateLocalUserForm, useLocalUserOptions, buildLocalUserPayload, localUserToForm, BLANK_LOCAL_USER_FORM, type LocalUserFormState } from "./user-definition-form.logic";
import type { NetworkDevice } from "../../api/device";
import { apiErrorDetail } from "../../api/errorText";

// Editing a local user is NOT the four-step wizard the create page is: the wizard exists to walk
// someone through choices that only matter once (which kind of user, which groups), and on an
// existing user those are settled. So this is one page of the same fields. (The user type cannot
// change: a local user is a local user.)
const UserDefinitionEditPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { deviceId } = useDeviceFromQuery();
  // The name at load time — the PUT is keyed on it, so a rename still targets the right object.
  const originalName = searchParams.get("name") ?? "";

  const [loading, setLoading] = useState(true);
  const [unreadable, setUnreadable] = useState(false);
  const [form, setForm] = useState<LocalUserFormState>(BLANK_LOCAL_USER_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof LocalUserFormState>(k: K, v: LocalUserFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  const { options, loading: loadingOptions } = useLocalUserOptions(deviceId);

  useEffect(() => {
    if (!deviceId || !originalName) { setLoading(false); setUnreadable(true); return; }
    let live = true;
    (async () => {
      const u = await DeviceGetUser(deviceId, originalName).catch(() => null);
      if (!live) return;
      // A user we could not read is not a user we may overwrite with blank defaults.
      if (!u) setUnreadable(true);
      else setForm(localUserToForm(u));
      setLoading(false);
    })();
    return () => { live = false; };
  }, [deviceId, originalName]);

  const submit = async (device: NetworkDevice, hostname: string) => {
    // requirePassword=false: the device never returns the stored password, so a blank box
    // means "keep it".
    const errs = validateLocalUserForm(form, false);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    try {
      setSaving(true);
      await DeviceUpdateUser(device.id, originalName, buildLocalUserPayload(form));
      message.success(`User "${form.name.trim()}" updated on ${hostname || device.name}`);
      navigate(`/admin/user-definition?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to update user"));
    } finally {
      setSaving(false);
    }
  };

  const fieldsProps = { form, set, errors, options, loadingOptions, currentColor, isEdit: true };

  return (
    <UserAuthFormPage
      noun="user"
      docsHref={USER_DOCS_HREF}
      name={originalName}
      loading={loading}
      unreadable={unreadable}
      saving={saving}
      submitLabel="Save"
      onSubmit={submit}
      panelClass="panel panel-flush"
    >
      {() => (
        <>
          <LoginCredentialsStep {...fieldsProps} />
          <ContactInfoStep {...fieldsProps} />
          <div className={sectionHdr}>Extra Info</div>
          <ExtraInfoStep {...fieldsProps} />
        </>
      )}
    </UserAuthFormPage>
  );
};

export default UserDefinitionEditPage;
