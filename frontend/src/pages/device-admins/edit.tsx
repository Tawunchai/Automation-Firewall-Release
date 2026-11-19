import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FiUserCheck, FiChevronLeft, FiSave } from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import Modal from "../../components/ui/Modal";
import { ListDevices, type NetworkDevice } from "../../api/device";
import { DeviceListAdminUsers, DeviceUpdateAdminUser, type AccProfile, type AdminUser } from "../../api/systemSettings";
import { BLANK_ADMIN, buildPayload, draftFrom, locksOutAdmin, validateDraft, type AdminDraft } from "./model";
import { AdminFields } from "./admin-form";
import { lockoutMessage } from "./admin-form.logic";

const DeviceAdminEditPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const deviceId = Number(searchParams.get("deviceId")) || null;
  const name = searchParams.get("name") || "";
  const backTo = "/admin/device-admins";

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [profiles, setProfiles] = useState<AccProfile[]>([]);
  const [original, setOriginal] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [draft, setDraft] = useState<AdminDraft>(BLANK_ADMIN);
  const [formError, setFormError] = useState<string | null>(null);
  const [lockoutPrompt, setLockoutPrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof AdminDraft>(k: K, v: AdminDraft[K]) => setDraft((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!deviceId || !name) { setLoading(false); setNotFound(true); return; }
    (async () => {
      const [list, lists] = await Promise.all([
        ListDevices().catch(() => []),
        DeviceListAdminUsers(deviceId).catch(() => ({ admins: [], profiles: [], profiles_readable: true })),
      ]);
      setDevice(list.find((d) => d.id === deviceId) ?? null);
      setProfiles(lists.profiles);
      const found = lists.admins.find((a) => a.name === name);
      if (!found) setNotFound(true); else { setOriginal(found); setDraft(draftFrom(found)); }
      setLoading(false);
    })();
  }, [deviceId, name]);

  const wouldLockOut = locksOutAdmin(original, draft);

  const doSave = async (confirmLockout = false) => {
    if (!device) { setFormError("No device selected"); return; }
    setFormError(null);
    try {
      setSaving(true);
      await DeviceUpdateAdminUser(device.id, name, buildPayload(draft, confirmLockout));
      message.success(`${draft.name} updated on ${device.name}`);
      navigate(backTo);
    } catch (err: unknown) {
      setLockoutPrompt(false);
      setFormError(apiErrorText(err, "the device refused the change"));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateDraft(draft, false);
    if (problem) { setFormError(problem); return; }
    if (wouldLockOut) { setLockoutPrompt(true); return; }
    await doSave(false);
  };

  return (
    <div className="space-y-4">
      {/* PageHeader, not the removed PageHero — a bare title plus a Back button has no mood or
          verdict to carry, just the one thing this page's own masthead ever had: a way out. */}
      <PageHeader
        icon={<FiUserCheck />}
        title={`Edit Administrator — ${name}`}
        accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(backTo)} className="btn btn-ghost btn-sm">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {!loading && (notFound || !device) && (
        <div className="banner banner-danger">
          {notFound ? "This administrator could not be found on the device" : "No device selected"}
        </div>
      )}

      {!loading && device && !notFound && (
        <form onSubmit={handleSubmit}>
          <div className="panel">
            <AdminFields draft={draft} set={set} profiles={profiles} original={original}
                         formError={formError} wouldLockOut={wouldLockOut} />
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <button type="button" onClick={() => navigate(backTo)}
              className="h-10 px-5 rounded-[4px] border hairline text-[13px] font-semibold ink-2 surface-hover transition">Cancel</button>
            <button type="submit" disabled={saving}
              className="h-10 px-6 rounded-[4px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
              style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
              {saving ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</> : <><FiSave size={14} /> Save</>}
            </button>
          </div>
        </form>
      )}

      {lockoutPrompt && (
        <Modal
          open
          onClose={() => !saving && setLockoutPrompt(false)}
          width="max-w-lg"
          title="This can lock you out"
          footer={
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setLockoutPrompt(false)} disabled={saving}>Go back</button>
              <button className="btn btn-danger btn-sm" onClick={() => void doSave(true)} disabled={saving}>
                I understand — write it
              </button>
            </>
          }
        >
          <div className="space-y-2">
            <p className="m-0 text-[13px] ink">{lockoutMessage(draft)}</p>
            <p className="m-0 text-[13px] ink-2">
              The firewall applies this immediately. If the address you are connected from is not in
              that list, this account stops working for you the moment it is saved — including for
              undoing it.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default DeviceAdminEditPage;
