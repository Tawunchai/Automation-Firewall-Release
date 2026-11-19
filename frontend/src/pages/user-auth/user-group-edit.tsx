import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import { UserAuthFormPage } from "./UserAuthFormPage";
import { DeviceGetUserGroup, DeviceUpdateUserGroup } from "../../api/policyObject";
import { UserGroupFields } from "./user-group-form";
import {
  useUserGroupOptions, buildUserGroupPayload, validateUserGroupForm,
  userGroupToForm, BLANK_USER_GROUP_FORM, type UserGroupFormState,
} from "./user-group-form.logic";
import { GROUP_DOCS_HREF } from "./user-group-create";
import type { NetworkDevice } from "../../api/device";
import { apiErrorDetail } from "../../api/errorText";

const UserGroupEditPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { deviceId } = useDeviceFromQuery();
  // The group's name at load time — the PUT is keyed by this, so renaming in the form still
  // targets the right object (FortiOS accepts a rename on PUT and returns the new mkey).
  const originalName = searchParams.get("name") ?? "";

  const [loading, setLoading] = useState(true);
  const [unreadable, setUnreadable] = useState(false);
  const [form, setForm] = useState<UserGroupFormState>(BLANK_USER_GROUP_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof UserGroupFormState>(k: K, v: UserGroupFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  const { options, loading: loadingOptions } = useUserGroupOptions(deviceId);

  useEffect(() => {
    if (!deviceId || !originalName) { setLoading(false); setUnreadable(true); return; }
    let live = true;
    (async () => {
      const g = await DeviceGetUserGroup(deviceId, originalName).catch(() => null);
      if (!live) return;
      // A group we could not read is not a group we may overwrite with blank defaults.
      if (!g) setUnreadable(true);
      else setForm(userGroupToForm(g));
      setLoading(false);
    })();
    return () => { live = false; };
  }, [deviceId, originalName]);

  const submit = async (device: NetworkDevice, hostname: string) => {
    const errs = validateUserGroupForm(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    try {
      setSaving(true);
      await DeviceUpdateUserGroup(device.id, originalName, buildUserGroupPayload(form));
      message.success(`User group "${form.name.trim()}" updated on ${hostname || device.name}`);
      navigate(`/admin/user-groups?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to update user group"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <UserAuthFormPage
      noun="user group"
      docsHref={GROUP_DOCS_HREF}
      name={originalName}
      loading={loading}
      unreadable={unreadable}
      saving={saving}
      submitLabel="Save"
      onSubmit={submit}
    >
      {() => (
        <UserGroupFields form={form} set={set} errors={errors} options={options}
          loadingOptions={loadingOptions} currentColor={currentColor} isEdit />
      )}
    </UserAuthFormPage>
  );
};

export default UserGroupEditPage;
