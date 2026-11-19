import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiUsers } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceCreateUserGroup, DeviceUpdateUserGroup, DeviceGetUserGroup,
  type UserGroupPayload,
} from "../../api/policyObject";
import { UserGroupFields } from "../user-auth/user-group-form";
import {
  useUserGroupOptions, buildUserGroupPayload, validateUserGroupForm,
  userGroupToForm, type UserGroupFormState,
} from "../user-auth/user-group-form.logic";
import WizardShell from "./WizardShell";
import { objectApplyImpact } from "./wizardImpact";
import { apiErrorDetail } from "../../api/errorText";

const STEPS = ["User Group"];

// The AI User Group wizard — the same fields as the User Groups page, prefilled from the model's
// CLI. An existing group opens in edit mode, so "put alice in Office-Users" edits that group's
// member list instead of colliding with -5.
const UserGroupWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: UserGroupPayload;
  target?: string;    // current group name on the device (edit); empty = create
  readOnly?: boolean;
  currentColor: string;
  // The object as it stood on the device BEFORE this wizard changed it, handed over on an EDIT so
  // Fallback can write it back. It is the payload the existence check already fetched, so it costs
  // no extra round-trip and is by construction what the Update endpoint accepts.
  onApplied: (name: string, wasEdit: boolean, before?: UserGroupPayload) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, readOnly = false, currentColor, onApplied, onCancel }) => {
  const [form, setForm] = useState<UserGroupFormState>(() => userGroupToForm(draft));
  const [isEdit, setIsEdit] = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [before, setBefore] = useState<UserGroupPayload | null>(null);
  const [checking, setChecking] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { options, loading: loadingOptions } = useUserGroupOptions(device.id);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    const lookup = target || draft.name;
    if (!lookup) { setChecking(false); return; }
    DeviceGetUserGroup(device.id, lookup).then((existing) => {
      if (cancelled || !existing) return;
      setIsEdit(true);
      setOriginalName(existing.name);
      setBefore(existing);
      // Merge the AI's changes over the live group. Members are unioned rather than replaced: the
      // model is told to re-emit the whole member line, but a forgotten name would otherwise
      // silently remove someone who is already in the group.
      const mergedMembers = Array.from(new Set([...(existing.members ?? []), ...(draft.members ?? [])]));
      setForm(userGroupToForm({ ...existing, ...draft, members: mergedMembers }));
    }).catch(() => { /* treat as create */ }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, draft, target]);

  const set = <K extends keyof UserGroupFormState>(k: K, v: UserGroupFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleApply = async () => {
    const errs = validateUserGroupForm(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    setErrors({});
    try {
      setSaving(true);
      const payload = buildUserGroupPayload(form);
      if (isEdit) await DeviceUpdateUserGroup(device.id, originalName || form.name, payload);
      else        await DeviceCreateUserGroup(device.id, payload);
      message.success(`${isEdit ? "Update" : "Create"} user group "${form.name}" Success`);
      onApplied(form.name, isEdit, before ?? undefined);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} user group`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <WizardShell
      title="AI User Group Wizard" icon={<FiUsers size={12} />}
      device={device} hostname={hostname} currentColor={currentColor}
      stepLabels={STEPS} step={0} onStep={() => {}}
      isEdit={isEdit} checking={checking}
      checkingLabel="Checking device for an existing group…"
      readOnly={readOnly} saving={saving}
      canApply={isAdmin}
      applyDisabledReason={!isAdmin ? "Only admins can apply config changes" : undefined}
      onApply={handleApply} onCancel={onCancel}
      buildImpact={() => objectApplyImpact({
        kind: "user-group", label: "User Group", name: form.name, isEdit,
        facts: [
          `Type ${form.groupType}` +
          (form.members.length ? ` · ${form.members.length} member(s) (${form.members.slice(0, 3).join(", ")}${form.members.length > 3 ? " …" : ""})` : " · no members yet"),
        ],
        // FortiOS replaces the member list on write; it does not append. A name missing from the
        // form is a member silently dropped from a group that may be in use right now.
        warnings: isEdit && form.members.length ? [
          "The member list is replaced wholesale — anyone not in this list is removed from the group",
        ] : [],
      })}>

      <UserGroupFields form={form} set={set} errors={errors} options={options}
        loadingOptions={loadingOptions} currentColor={currentColor} isEdit={isEdit} />
    </WizardShell>
  );
};

export default UserGroupWizard;
