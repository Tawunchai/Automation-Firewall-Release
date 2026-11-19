import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import { UserAuthFormPage } from "./UserAuthFormPage";
import { ExchangeConnectorDrawer } from "./exchange-connector-drawer";
import { DeviceCreateLDAPServer } from "../../api/policyObject";
import { LDAPServerFields } from "./ldap-server-form";
import { useLDAPServerOptions, buildLDAPServerPayload, validateLDAPServerForm, BLANK_LDAP_SERVER_FORM, type LDAPServerFormState } from "./ldap-server-form.logic";
import type { NetworkDevice } from "../../api/device";
import { apiErrorDetail } from "../../api/errorText";

export const LDAP_DOCS_HREF =
  "https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/798165/configuring-an-ldap-server";

const LDAPServerCreatePage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const { deviceId } = useDeviceFromQuery();

  const [form, setForm] = useState<LDAPServerFormState>(BLANK_LDAP_SERVER_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const set = <K extends keyof LDAPServerFormState>(k: K, v: LDAPServerFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const { options, loading: loadingOptions, reload } = useLDAPServerOptions(deviceId ?? undefined);

  const submit = async (device: NetworkDevice, hostname: string) => {
    const errs = validateLDAPServerForm(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    try {
      setSaving(true);
      await DeviceCreateLDAPServer(device.id, buildLDAPServerPayload(form));
      message.success(`LDAP server "${form.name.trim()}" created on ${hostname || device.name}`);
      navigate(`/admin/ldap-servers?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to create LDAP server"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <UserAuthFormPage noun="LDAP server" docsHref={LDAP_DOCS_HREF} onSubmit={submit} saving={saving}>
        {() => (
          <LDAPServerFields form={form} set={set} errors={errors} options={options}
            loadingOptions={loadingOptions} currentColor={currentColor}
            onCreateExchange={() => setExchangeOpen(true)} />
        )}
      </UserAuthFormPage>

      {/* "+ Create" inside the Exchange server picker. On success the new connector is selected
          and the picker's datasource is refetched so it appears in the list. */}
      <ExchangeConnectorDrawer
        open={exchangeOpen} deviceId={deviceId} currentColor={currentColor}
        onClose={() => setExchangeOpen(false)}
        onCreated={(name) => { set("exchangeServer", name); reload(); }}
      />
    </>
  );
};

export default LDAPServerCreatePage;
