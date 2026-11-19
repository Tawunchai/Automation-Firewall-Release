import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  FiKey, FiPlus, FiEdit2, FiTrash2, FiRefreshCw, FiHardDrive,
  FiAlertTriangle, FiInfo, FiEye, FiEyeOff, FiUser, FiLock, FiClock, FiX,
} from "react-icons/fi";
import Modal from "../../../components/ui/Modal";
import MinimalSelect from "../../../components/ui/MinimalSelect";
import DeviceMascot from "../../../components/ui/DeviceMascot";
import { message } from "../../../components/ui/toast";
import { useStateContext } from "../../../contexts/ProviderContext.logic";
import { ListDevices, type NetworkDevice } from "../../../api/device";
import {
  ListMyDeviceCredentials,
  CreateMyDeviceCredential,
  UpdateMyDeviceCredential,
  TestMyDeviceCredential,
  DeleteMyDeviceCredential,
  credentialError,
  type DeviceCredential,
} from "../../../api/deviceCredential";
import KeyMascot from "./KeyMascot";
import { HEALTH_LOOK, availableDevices, credentialHealth, timeAgo } from "./format";

// Device Credentials — my own account on each firewall.
//
// ── Why this card exists, and why it is HERE ─────────────────────────────────
// The console reaches every device with one credential stored on the device row, which is normally
// `admin`. Everything anyone does therefore lands in the firewall's own event log as `admin`, and
// the device cannot tell three engineers apart. The app's Change Ledger knows who did what, but the
// FIREWALL does not — and the firewall's log is the one an incident review reaches for.
//
// A row here maps one person to one device with that person's own FortiGate account. From then on
// everything they drive — policy and object writes, security profiles, VPN, the SSH diagnostics,
// the Config Deploy shell — logs in as them, and the device records their name.
//
// It replaced the Activity feed on this page, and it sits on the PROFILE rather than in an admin
// section on purpose: this is not "the passwords the console stores", it is "my account", which is
// the same category of thing as the photo and the TOTP secret beside it. It grants nothing either —
// whatever the mapped account can do on the firewall, its owner could already do over SSH.
//
// Background work (scheduled backups, compliance runs, Notify alerts) runs as ONE account somebody
// nominates here with "use for scheduled work" — see entity.NetworkDevice.AutomationCredentialID.
// It cannot borrow whoever happens to be signed in, because nobody is
// behind a cron job, and borrowing someone's name for one would make the log worse, not better.
//
// ── Layout ───────────────────────────────────────────────────────────────────
// The card grows with its content and never scrolls internally. It inherited `lg:absolute
// lg:inset-0` + an inner scroller from the activity feed it replaced, which was right for an
// unbounded history and wrong here: this list is capped by the number of devices in the inventory,
// so the scrollbar only ever appeared to hide two or three rows behind a gesture.


type FormState = {
  /** The row being edited, or null when adding. */
  editing: DeviceCredential | null;
  deviceID: number;
  username: string;
  password: string;
  /** Nominate this account for the device's unattended work — backups, compliance, alerts. */
  automation: boolean;
};

const EMPTY_FORM: FormState = {
  editing: null, deviceID: 0, username: "", password: "", automation: false,
};

const CredentialsCard: React.FC = () => {
  const { currentColor } = useStateContext();

  const [creds, setCreds] = useState<DeviceCredential[]>([]);
  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  /** Ids with a test in flight — the button spins per row, not for the whole card. */
  const [testing, setTesting] = useState<Set<number>>(new Set());
  // The credential whose removal is being confirmed, and whether the delete is in flight.
  const [removeTarget, setRemoveTarget] = useState<DeviceCredential | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoadError("");
      const [rows, devs] = await Promise.all([ListMyDeviceCredentials(), ListDevices()]);
      setCreds(rows);
      setDevices(devs);
    } catch (err) {
      // An empty list and a failed read look identical on screen, and on a card about credentials
      // "you have none" is a dangerous thing to invent — it invites adding a duplicate.
      setLoadError(credentialError(err, "Could not load your device credentials"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const deviceChoices = useMemo(
    () => availableDevices(devices, creds, form?.editing?.network_device_id),
    [devices, creds, form],
  );
  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === form?.deviceID) ?? null,
    [devices, form],
  );
  const unmappedCount = Math.max(0, devices.length - creds.length);
  const allMapped = devices.length > 0 && unmappedCount === 0;

  const openAdd = () => {
    setFormError("");
    setShowPassword(false);
    const first = availableDevices(devices, creds)[0];
    setForm({ ...EMPTY_FORM, deviceID: first?.id ?? 0 });
  };

  const openEdit = (c: DeviceCredential) => {
    setFormError("");
    setShowPassword(false);
    // The password box starts empty because the browser was never given the stored one. Leaving it
    // empty on save keeps the existing password — see the placeholder text in the dialog.
    setForm({
      editing: c, deviceID: c.network_device_id, username: c.username, password: "",
      automation: c.used_for_automation,
    });
  };

  const closeForm = () => { if (!saving) { setForm(null); setFormError(""); } };

  const handleSave = async () => {
    if (!form) return;
    const username = form.username.trim();
    if (!form.deviceID) { setFormError("Choose a device first."); return; }
    if (!username) { setFormError("Enter the username of your account on the firewall."); return; }
    if (!form.editing && !form.password) { setFormError("Enter the password for that account."); return; }

    setSaving(true);
    setFormError("");
    try {
      let saved;
      if (form.editing) {
        saved = await UpdateMyDeviceCredential(form.editing.id, {
          username,
          // Only send a password when one was typed; the server reads "" as "keep what you have".
          ...(form.password ? { password: form.password } : {}),
          use_for_automation: form.automation,
        });
        message.success("Credential updated");
      } else {
        saved = await CreateMyDeviceCredential({
          network_device_id: form.deviceID, username, password: form.password,
          use_for_automation: form.automation,
        });
        message.success("Linked — the firewall will record your name from now on");
      }
      // The credential saved; the nomination for scheduled work is a separate decision that can be
      // refused on its own (a credential that failed its last test does not get the job). Saying so
      // as a warning is the only way the person learns their backups are still unowned.
      if (saved.warning) message.warning(saved.warning);
      setForm(null);
      await load();
    } catch (err) {
      // The server refuses a password the firewall rejected and accepts one it merely could not
      // reach, and the reason it gives is the difference. Showing it inside the dialog keeps the
      // typed values on screen to correct.
      setFormError(credentialError(err, "Could not save the credential"));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (c: DeviceCredential) => {
    setTesting((s) => new Set(s).add(c.id));
    try {
      const res = await TestMyDeviceCredential(c.id);
      if (res.ok) message.success(`${c.device_name || "Device"}: signed in as ${c.username}`);
      else message.error(res.error || "Sign-in failed");
      await load();
    } catch (err) {
      message.error(credentialError(err, "Could not run the test"));
    } finally {
      setTesting((s) => { const next = new Set(s); next.delete(c.id); return next; });
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    try {
      setRemoving(true);
      setRemoveError("");
      await DeleteMyDeviceCredential(removeTarget.id);
      message.success("Credential removed");
      setRemoveTarget(null);
      await load();
    } catch (err) {
      setRemoveError(credentialError(err, "Could not remove the credential"));
    } finally {
      setRemoving(false);
    }
  };

  const header = (
    <header className="card-head">
      <h2 className="card-title t-card">
        <span
          className="medallion h-6 w-6 text-[12px]"
          style={{ color: currentColor, background: `color-mix(in srgb, ${currentColor} 13%, transparent)` }}
        >
          <FiKey />
        </span>
        <span className="truncate">Device Credentials</span>
      </h2>

      {!loading && (
        <button
          type="button"
          onClick={openAdd}
          disabled={allMapped}
          title={allMapped ? "Every device already has your account linked" : "Link your account to a device"}
          className="btn btn-accent btn-sm"
        >
          <FiPlus className="text-[11px]" />
          Add
        </button>
      )}
    </header>
  );

  if (loading) {
    return (
      <section className="shell-card flex h-full flex-col overflow-hidden">
        {header}
        <div className="space-y-3 px-4 py-3.5">
          {[1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="shell-skeleton h-9 w-9 shrink-0 rounded-[4px]" />
              <div className="flex-1 space-y-2 py-1">
                <div className="shell-skeleton h-3 w-2/3" />
                <div className="shell-skeleton h-2.5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="shell-card flex h-full flex-col overflow-hidden">
      {header}

      <div className="px-4 py-3">
        {loadError ? (
          <div className="banner banner-warn items-start">
            <FiAlertTriangle className="mt-0.5 shrink-0 text-[15px]" />
            <div className="min-w-0">
              <p className="m-0 text-[12.5px] font-semibold">Could not load your credentials</p>
              <p className="m-0 mt-0.5 wrap-break-word text-[11.5px] opacity-90">{loadError}</p>
              <button type="button" onClick={() => void load()} className="btn btn-ghost btn-sm mt-2">
                <FiRefreshCw className="text-[11px]" />
                Try again
              </button>
            </div>
          </div>
        ) : creds.length === 0 ? (
          /* Empty state, not an error: nobody has a credential until they add one, and the card
             has to explain what adding one BUYS or it reads as another form to fill in. */
          <div className="py-2 text-center">
            <KeyMascot className="mx-auto h-24 w-full max-w-44" />
            <p className="mt-3 text-[13px] font-semibold ink">No firewall account linked yet</p>
            <p className="mx-auto mt-1.5 max-w-84 text-[11.5px] leading-relaxed ink-3">
              A device carries no login of its own — you reach a firewall with your own account on
              it. Link one and its pages open, with the device recording your name against every
              change.
            </p>
            <button type="button" onClick={openAdd} className="btn btn-accent btn-sm mt-3.5">
              <FiPlus className="text-[11px]" />
              Link an account
            </button>
          </div>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {creds.map((c) => {
              const look = HEALTH_LOOK[credentialHealth(c)];
              const busy = testing.has(c.id);
              return (
                <li key={c.id} className="rounded-[4px] border hairline-2 surface-sunken px-3 py-2.5">
                  <div className="flex items-start gap-2.5">
                    <span
                      className="medallion mt-0.5 h-8 w-8 shrink-0 text-[14px]"
                      style={{ color: look.dot, background: `color-mix(in srgb, ${look.dot} 14%, transparent)` }}
                    >
                      <FiHardDrive />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[12.5px] font-semibold ink">
                          {c.device_name || `Device #${c.network_device_id}`}
                        </span>
                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${look.tone}`}>
                          {look.label}
                        </span>
                        {c.used_for_automation && (
                          <span
                            className="chip chip-accent"
                            title="Scheduled backups, compliance checks and Notify alerts on this device run as this account"
                          >
                            <FiClock size={9} /> runs scheduled work
                          </span>
                        )}
                      </div>

                      <p className="m-0 mt-0.5 truncate text-[11.5px] ink-2">
                        <span className="t-mono">{c.username}</span>
                        <span className="ink-3"> @ {c.device_ip || "—"}</span>
                      </p>

                      <p className="m-0 mt-1 text-[10.5px] ink-3">
                        Last used {timeAgo(c.last_used_at)} · last checked {timeAgo(c.last_tested_at)}
                      </p>

                      {/* The device's own words for why it refused. Without this the badge says
                          "Rejected" and gives no way to act on it. */}
                      {c.last_test_status === "fail" && c.last_test_error && (
                        <p className="m-0 mt-1.5 wrap-break-word rounded-[4px] bg-red-500/8 px-2 py-1 text-[10.5px] text-red-600 dark:text-red-400">
                          {c.last_test_error}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button" onClick={() => void handleTest(c)} disabled={busy}
                        className="btn-icon" aria-label="Check" title="Sign in to the firewall to check this account"
                      >
                        <FiRefreshCw size={13} className={busy ? "animate-spin" : ""} />
                      </button>
                      <button
                        type="button" onClick={() => openEdit(c)}
                        className="btn-icon" aria-label="Edit" title="Edit"
                      >
                        <FiEdit2 size={13} />
                      </button>
                      <button
                        type="button" onClick={() => { setRemoveError(""); setRemoveTarget(c); }}
                        className="btn-icon text-red-500" aria-label="Remove" title="Remove"
                      >
                        <FiTrash2 size={13} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}

            {/* Which devices you have no account for. Without it the card only shows what IS
                mapped, and "am I covered everywhere?" needs counting by hand. */}
            {unmappedCount > 0 && (
              <li className="flex items-start gap-2 rounded-[4px] border border-dashed hairline px-3 py-2.5">
                <FiInfo className="mt-0.5 shrink-0 text-[13px] ink-3" />
                <p className="m-0 text-[11px] leading-relaxed ink-3">
                  You have no account on {unmappedCount} other{" "}
                  {unmappedCount === 1 ? "device" : "devices"} you can reach — link one to open{" "}
                  {unmappedCount === 1 ? "its pages" : "their pages"}.
                </p>
              </li>
            )}
          </ul>
        )}
      </div>

      {/* ════════════════════ ADD / EDIT ════════════════════ */}
      <Modal
        open={form !== null}
        onClose={closeForm}
        width="max-w-md"
        bodyClassName="p-0"
        footer={
          <>
            <button type="button" onClick={closeForm} disabled={saving} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={saving} className="btn btn-accent btn-sm">
              {saving && (
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              )}
              {saving ? "Checking with the firewall…" : form?.editing ? "Save changes" : "Link account"}
            </button>
          </>
        }
      >
        {form && (
          <div>
            {/* Clean white header with a soft accent badge, matching the TOTP sheet. */}
            <div className="relative flex items-center gap-3 overflow-hidden border-b border-slate-100 px-5 py-4 dark:border-white/8">
              <span className="pointer-events-none absolute -right-6 -top-10 h-24 w-24 rounded-full"
                style={{ background: `color-mix(in srgb, ${currentColor} 9%, transparent)` }} />
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px]"
                style={{ color: currentColor, background: `color-mix(in srgb, ${currentColor} 12%, transparent)` }}>
                <FiKey className="text-[16px]" />
              </span>
              <h3 className="relative m-0 min-w-0 flex-1 truncate text-[14px] font-bold ink">
                {form.editing ? "Edit firewall account" : "Link your firewall account"}
              </h3>
              <button type="button" onClick={closeForm} aria-label="Cancel" className="btn-icon relative shrink-0">
                <FiX className="text-[15px]" />
              </button>
            </div>
            <div className="space-y-4 p-5">
            {/* ── Device ── */}
            <div>
              <label className="field-label" htmlFor="cred-device">Device</label>
              {/* The device is fixed once saved: pointing a credential at a different firewall is
                  a different mapping, not an edit of this one. */}
              <MinimalSelect
                id="cred-device"
                ariaLabel="Device"
                className="w-full"
                value={String(form.deviceID)}
                disabled={!!form.editing || saving}
                onChange={(v) => setForm({ ...form, deviceID: Number(v) })}
                options={[
                  ...(deviceChoices.length === 0 ? [{ value: "0", label: "No devices left to link" }] : []),
                  ...deviceChoices.map((d) => ({ value: String(d.id), label: `${d.name} — ${d.mgmt_ip}` })),
                ]}
              />
              {selectedDevice && (
                <p className="field-hint flex flex-wrap items-center gap-x-1.5">
                  <FiHardDrive className="text-[11px]" />
                  <span className="t-mono">{selectedDevice.mgmt_ip}</span>
                  <span>· {selectedDevice.vendor}</span>
                  {form.editing && <span>· locked to this credential</span>}
                </p>
              )}
            </div>

            {/* ── Account ── */}
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="field-label" htmlFor="cred-username">Username on the firewall</label>
                <div className="relative">
                  <FiUser className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] ink-3" />
                  <input
                    id="cred-username"
                    className="shell-input t-mono pl-8"
                    value={form.username}
                    disabled={saving}
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    spellCheck={false}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="e.g. tawunchai"
                  />
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="cred-password">Password</label>
                <div className="relative">
                  <FiLock className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] ink-3" />
                  <input
                    id="cred-password"
                    type={showPassword ? "text" : "password"}
                    className="shell-input pl-8 pr-9"
                    value={form.password}
                    disabled={saving}
                    // Not "new-password": that value is what tells Chrome this is an account-signup
                    // field, which is what makes it pop its "Suggest strong password" + saved-logins
                    // picker open on every focus — stealing the field back from whatever the person
                    // was typing. This password is an EXISTING FortiGate account's password, not a
                    // new one being created here, so "off" is the correct semantic value too.
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={form.editing ? "Leave blank to keep the current password" : ""}
                  />
                  {/* A reveal toggle, because a password that is refused once costs one of the three
                      attempts the firewall allows before it locks the account. */}
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 ink-3 hover-ink"
                  >
                    {showPassword ? <FiEyeOff className="text-[13px]" /> : <FiEye className="text-[13px]" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Who runs the work nobody is watching.
                The device stores a POINTER to this credential, not a copy of the password, so
                changing the password above changes it for the scheduler at the same moment. */}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-[4px] border hairline px-3 py-2.5 transition surface-hover">
              <input
                type="checkbox"
                checked={form.automation}
                disabled={saving}
                onChange={(e) => setForm({ ...form, automation: e.target.checked })}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-current"
              />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold ink">
                  Use this account for scheduled work on this device
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed ink-3">
                  Automatic backups, compliance checks and Notify alerts have nobody signed in behind
                  them, so they run as one nominated account. Without one, this device's schedules
                  cannot run at all.
                  {form.editing?.automation_taken_by && !form.editing.used_for_automation && (
                    <> Currently held by <b>{form.editing.automation_taken_by}</b> — ticking this takes it over.</>
                  )}
                </span>
              </span>
            </label>

            {formError && (
              <div className="banner banner-danger items-start">
                <FiAlertTriangle className="mt-0.5 shrink-0 text-[14px] text-red-500" />
                <p className="m-0 wrap-break-word text-[11.5px] ink-2">{formError}</p>
              </div>
            )}
            </div>
          </div>
        )}
      </Modal>

      {/* Remove-credential confirm — the same virus-headed card as the user-management delete. */}
      {removeTarget && createPortal(
        <div className="fixed inset-0 z-9999 flex items-center justify-center p-3 sm:p-4">
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => !removing && setRemoveTarget(null)} />
          <div className="relative z-10 w-full max-w-[380px] overflow-hidden rounded-[6px] surface-card ring-1 ring-black/5 dark:ring-white/10">
            <button type="button" onClick={() => !removing && setRemoveTarget(null)} disabled={removing} aria-label="Cancel"
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-[4px] ink-3 surface-hover transition-colors focus:outline-none disabled:opacity-60">
              <FiX className="text-[16px]" />
            </button>
            <div className="px-6 pb-6 pt-7 text-center">
              <DeviceMascot className="mx-auto mb-3 h-24 w-24" title={`Remove ${removeTarget.device_name || "credential"}`} />
              <h3 className="truncate text-[17px] font-bold leading-tight ink">{removeTarget.device_name || `Device #${removeTarget.network_device_id}`}</h3>
              <p className="mx-auto mt-1.5 max-w-[17rem] text-[12px] leading-5 ink-3">
                {removeTarget.used_for_automation
                  ? "This device's backups, checks and alerts run as this account — they'll stop until you link another."
                  : "You'll lose access to this device's pages until you link an account again."}
              </p>

              {removeError && <div className="mt-4 rounded-[4px] border border-red-200 bg-red-50 px-3 py-2 text-left text-[10.5px] text-red-600 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300">{removeError}</div>}

              <button type="button" onClick={confirmRemove} disabled={removing}
                className={["mt-5 flex w-full items-center justify-center gap-2 rounded-[4px] py-2.5 text-[12.5px] font-semibold text-white transition",
                  removing ? "cursor-not-allowed bg-red-300 dark:bg-red-900/50" : "bg-linear-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400",
                ].join(" ")}>
                {removing
                  ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                  : <FiTrash2 className="text-[13px]" />}
                {removing ? "Removing…" : "Remove"}
              </button>
              <button type="button" onClick={() => !removing && setRemoveTarget(null)} disabled={removing}
                className="mt-2 w-full rounded-[4px] py-2 text-[12px] font-medium ink-3 transition surface-hover disabled:opacity-60">
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
};

export default CredentialsCard;
