import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { DeviceFormPage } from "../../components/device/DeviceFormPage";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import { ProfileUnreadable } from "../security-profiles/ProfileLoadGuard";
import { UserAuthInfoPanel } from "./user-auth-panel";
import { DeviceGetInfo } from "../../api/policyObject";
import type { NetworkDevice } from "../../api/device";

/**
 * The shape every User & Authentication form page has: the fields on the left, the device panel
 * and the Fortinet guide on the right, Back above and Cancel/Save below.
 *
 * Six pages wrote this out — each with its own `?deviceId` effect, its own GET /devices, its own
 * hostname read, its own gradient Save button and its own spinner. What differs between them is
 * the fields and the two API calls, which is what is left here.
 *
 * `unreadable` is handled for them: an edit form that could not read its object renders the
 * refusal instead of blank defaults with an enabled Save (see ProfileLoadGuard).
 */
export const UserAuthFormPage: React.FC<{
  /** The object, lower case: "LDAP server", "user group". */
  noun: string;
  /** The Fortinet documentation this object has, shown in the side panel. */
  docsHref: string;
  /** The object's key when editing — absent on a create. */
  name?: string;
  /** True when the read of that object failed or found nothing. */
  unreadable?: boolean;
  /** Still reading. */
  loading?: boolean;
  saving?: boolean;
  submitLabel?: string;
  onSubmit: (device: NetworkDevice, hostname: string) => void | Promise<void>;
  /** Where Back and Cancel go. */
  backTo?: string;
  children: (ctx: { device: NetworkDevice; hostname: string }) => React.ReactNode;
  /** The fields' own card class — "panel panel-flush" where the fields draw their own padding. */
  panelClass?: string;
}> = ({
  noun, docsHref, name, unreadable, loading = false, saving = false,
  submitLabel = "OK", onSubmit, backTo, children, panelClass = "panel",
}) => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const { device, deviceId } = useDeviceFromQuery();
  const [hostname, setHostname] = useState("");

  // What the firewall calls itself, for the panel. The device row itself is not read here — it
  // comes from the inventory the app already holds.
  useEffect(() => {
    if (!deviceId) return;
    let live = true;
    DeviceGetInfo(deviceId)
      .then((info) => { if (live) setHostname(info.hostname || ""); })
      .catch(() => { /* the panel falls back to the inventory's name */ });
    return () => { live = false; };
  }, [deviceId]);

  const back = () => (backTo ? navigate(backTo) : navigate(-1));

  return (
    <DeviceFormPage
      noun={noun}
      onSubmit={(d) => onSubmit(d, hostname)}
      saving={saving}
      loading={loading}
      submitLabel={submitLabel}
      card={false}
      onCancel={back}
      unreadable={unreadable && !loading ? (
        <ProfileUnreadable noun={noun} name={name ?? null} deviceName={device?.name} onBack={back} />
      ) : undefined}
    >
      {(d) => (
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 270px" }}>
          <div className={panelClass}>{children({ device: d, hostname })}</div>
          <UserAuthInfoPanel device={d} hostname={hostname} currentColor={currentColor} docsHref={docsHref} />
        </div>
      )}
    </DeviceFormPage>
  );
};

export default UserAuthFormPage;
