import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import { UserAuthFormPage } from "./UserAuthFormPage";
import { DeviceCreateUserGroup } from "../../api/policyObject";
import { UserGroupFields } from "./user-group-form";
import {
  useUserGroupOptions, buildUserGroupPayload, validateUserGroupForm,
  BLANK_USER_GROUP_FORM, type UserGroupFormState,
} from "./user-group-form.logic";
import type { NetworkDevice } from "../../api/device";
import { apiErrorDetail } from "../../api/errorText";

export const GROUP_DOCS_HREF =
  "https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/168933/user-groups";

const UserGroupCreatePage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const { deviceId } = useDeviceFromQuery();

  const [form, setForm] = useState<UserGroupFormState>(BLANK_USER_GROUP_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof UserGroupFormState>(k: K, v: UserGroupFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  const { options, loading: loadingOptions } = useUserGroupOptions(deviceId ?? undefined);

  const submit = async (device: NetworkDevice, hostname: string) => {
    const errs = validateUserGroupForm(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    try {
      setSaving(true);
      await DeviceCreateUserGroup(device.id, buildUserGroupPayload(form));
      message.success(`User group "${form.name.trim()}" created on ${hostname || device.name}`);
      navigate(`/admin/user-groups?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to create user group"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <UserAuthFormPage noun="user group" docsHref={GROUP_DOCS_HREF} onSubmit={submit} saving={saving}>
      {() => (
        <UserGroupFields form={form} set={set} errors={errors} options={options}
          loadingOptions={loadingOptions} currentColor={currentColor} />
      )}
    </UserAuthFormPage>
  );
};

export default UserGroupCreatePage;
