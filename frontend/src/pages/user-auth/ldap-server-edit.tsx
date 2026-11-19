import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import { UserAuthFormPage } from "./UserAuthFormPage";
import { ExchangeConnectorDrawer } from "./exchange-connector-drawer";
import { DeviceGetLDAPServer, DeviceUpdateLDAPServer } from "../../api/policyObject";
import { LDAPServerFields } from "./ldap-server-form";
import { useLDAPServerOptions, buildLDAPServerPayload, validateLDAPServerForm, ldapServerToForm, BLANK_LDAP_SERVER_FORM, type LDAPServerFormState } from "./ldap-server-form.logic";
import { LDAP_DOCS_HREF } from "./ldap-server-create";
import type { NetworkDevice } from "../../api/device";
import { apiErrorDetail } from "../../api/errorText";

const LDAPServerEditPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { deviceId } = useDeviceFromQuery();
  const originalName = searchParams.get("name") ?? "";

  const [loading, setLoading] = useState(true);
  const [unreadable, setUnreadable] = useState(false);
  const [form, setForm] = useState<LDAPServerFormState>(BLANK_LDAP_SERVER_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const set = <K extends keyof LDAPServerFormState>(k: K, v: LDAPServerFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const { options, loading: loadingOptions, reload } = useLDAPServerOptions(deviceId);

  useEffect(() => {
    if (!deviceId || !originalName) { setLoading(false); setUnreadable(true); return; }
    let live = true;
    (async () => {
      const s = await DeviceGetLDAPServer(deviceId, originalName).catch(() => null);
      if (!live) return;
      // A server we could not read is not a server we may overwrite with blank defaults — the
      // bind password alone would be enough to lock everyone out of authentication.
      if (!s) setUnreadable(true);
      else setForm(ldapServerToForm(s));
      setLoading(false);
    })();
    return () => { live = false; };
  }, [deviceId, originalName]);

  const submit = async (device: NetworkDevice, hostname: string) => {
    // isEdit relaxes the password rule: blank keeps the stored bind password.
    const errs = validateLDAPServerForm(form, { isEdit: true });
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    try {
      setSaving(true);
      await DeviceUpdateLDAPServer(device.id, originalName, buildLDAPServerPayload(form));
      message.success(`LDAP server "${form.name.trim()}" updated on ${hostname || device.name}`);
      navigate(`/admin/ldap-servers?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to update LDAP server"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <UserAuthFormPage
        noun="LDAP server"
        docsHref={LDAP_DOCS_HREF}
        name={originalName}
        loading={loading}
        unreadable={unreadable}
        saving={saving}
        submitLabel="Save"
        onSubmit={submit}
      >
        {() => (
          <LDAPServerFields form={form} set={set} errors={errors} options={options}
            loadingOptions={loadingOptions} currentColor={currentColor}
            onCreateExchange={() => setExchangeOpen(true)} isEdit />
        )}
      </UserAuthFormPage>

      <ExchangeConnectorDrawer
        open={exchangeOpen} deviceId={deviceId} currentColor={currentColor}
        onClose={() => setExchangeOpen(false)}
        onCreated={(name) => { set("exchangeServer", name); reload(); }}
      />
    </>
  );
};

export default LDAPServerEditPage;
