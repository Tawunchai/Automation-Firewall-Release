import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FiMail, FiEdit2, FiSave, FiX, FiCheckCircle, FiShield,
  FiTool, FiKey, FiLock, FiPlus,
  FiUnlock, FiLogIn,
} from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { confirm } from "../../components/ui/confirm";
import {
  ListSendEmails, UpdateSendEmailByID, CreateSendEmail,
  type SendEmailResponse, type UpdateSendEmailPayload,
} from "../../api";
import {
  Toggle2FA, ToggleTwoStep, ToggleResetOTP, GetSecurityConfig,
  type SecurityConfigResponse,
} from "../../api/auth";
import {
  applyMasterToggle, applyTriggerToggle, flowsLostByDisabling,
  lockedHint, masterSummary, triggerRow,
} from "./otpSettings";
import { useFetch } from "../../hooks/useFetch";
import { GetMaintenanceStatus, ToggleMaintenance } from "../../api/maintenance";
import { GetTOTPGlobal, ToggleTOTPGlobal } from "../../api/totp";
import { useStateContext } from "../../contexts/ProviderContext.logic";

// ── Toggle switch ─────────────────────────────────────────────────────────────
// A switch, not a clickable box. `label` is required rather than optional: a toggle with no
// accessible name is announced as "switch, checked" and nothing else, and the only reliable way to
// stop that happening again is to make the compiler ask for the name.
// It had aria-label="toggle", which names it after its own widget type — every one of them
// announced identically. The caller says what this particular switch turns on.
const Toggle: React.FC<{
  enabled: boolean; loading?: boolean; color?: string; onToggle: () => void; label: string;
}> = ({ enabled, loading = false, color = "#10b981", onToggle, label }) => (
  <button type="button" onClick={onToggle} disabled={loading} role="switch" aria-checked={enabled} aria-label={label}
    className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    style={{ backgroundColor: enabled ? color : "#e2e8f0" }}>
    <span className={["pointer-events-none inline-block h-5 w-5 rounded-full surface-card shadow-lg transition-transform duration-200",
      enabled ? "translate-x-5" : "translate-x-0"].join(" ")} />
  </button>
);

// ── Checkbox row ──────────────────────────────────────────────────────────────
//
// `locked` = สวิตช์ใหญ่ Two-Step Verification ปิดอยู่ แถวนี้จึงกดไม่ได้ (ฝั่ง server
// ก็ปฏิเสธด้วย 409 เหมือนกัน — ด่านบนหน้าจอมีไว้ให้ผู้ใช้เห็นเหตุผลก่อนกด ไม่ใช่แทนกัน)
// ป้ายมุมขวาเป็น "PAUSED" เมื่อช่องถูกติ๊กไว้แต่สวิตช์ใหญ่ปิด — ป้าย ON บน flow ที่ไม่ทำงาน
// คือการบอกว่าระบบกำลังส่ง OTP อยู่ทั้งที่ไม่ได้ส่ง
const CheckRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  locked?: boolean;
  badge?: "ON" | "PAUSED" | null;
  loading?: boolean;
  currentColor: string;
  onToggle: () => void;
}> = ({ icon, title, desc, checked, locked = false, badge, loading = false, currentColor, onToggle }) => {
  const tint = locked ? "#94a3b8" : currentColor;
  return (
    <div className={`flex items-center justify-between py-3 px-1 transition-opacity ${locked ? "opacity-55" : ""}`}>
      <div className="flex items-center gap-3 min-w-0">
        {/* Checkbox */}
        <button type="button" onClick={onToggle} disabled={loading || locked}
          aria-checked={checked} role="checkbox"
          title={locked ? "Turn on Two-Step Verification above first" : undefined}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-all disabled:cursor-not-allowed disabled:opacity-60"
          style={checked
            ? { borderColor: tint, backgroundColor: tint }
            : { borderColor: "#cbd5e1", backgroundColor: "white" }}>
          {checked && (
            <svg viewBox="0 0 12 10" fill="none" className="w-3 h-2.5">
              <path d="M1 5l3.5 4L11 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        {/* Icon */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] transition-colors"
          style={checked && !locked
            ? { backgroundColor: `${currentColor}15`, color: currentColor }
            : { backgroundColor: "#f1f5f9", color: "#9ca3af" }}>
          {icon}
        </div>

        <div className="min-w-0">
          <span className="text-[13px] font-semibold ink">{title}</span>
          <p className="text-[11px] ink-3">{desc}</p>
        </div>
      </div>

      {badge && (
        <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold"
          style={badge === "ON"
            ? { borderColor: `${currentColor}40`, backgroundColor: `${currentColor}10`, color: currentColor }
            : { borderColor: "#94a3b840", backgroundColor: "#94a3b810", color: "#64748b" }}>
          {badge}
        </span>
      )}
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
const ServicePage: React.FC = () => {
  const { t } = useTranslation();
  const { currentColor } = useStateContext();
  const { data: emails, loading, refetch } = useFetch(ListSendEmails);

  const [editingId, setEditingId]   = useState<number | null>(null);
  const [form, setForm]             = useState<UpdateSendEmailPayload>({ email: "", pass_app: "" });
  const [saving, setSaving]         = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<UpdateSendEmailPayload>({ email: "", pass_app: "" });
  const [creating, setCreating]     = useState(false);

  // 2FA / OTP states — เก็บเป็นก้อนเดียวเพื่อให้สวิตช์ใหญ่กับ trigger รายตัวคำนวณ
  // จากแหล่งเดียวกันเสมอ (ตอนแยกเป็น useState ละตัว มันเพี้ยนกันได้ และเคยเพี้ยนมาแล้ว:
  // หัวข้อบอก "disabled" แต่แถวข้างล่างขึ้น ON)
  const [sec, setSec] = useState<SecurityConfigResponse>({
    two_step: false, login_2fa: false, reset_otp: false,
    login_2fa_effective: false, reset_otp_effective: false,
  });
  const [totpEnabled, setTotpEnabled]       = useState(false);
  const [togglingMaster, setTogglingMaster] = useState(false);
  const [togglingLogin, setTogglingLogin]   = useState(false);
  const [togglingReset, setTogglingReset]   = useState(false);
  const [togglingTotp, setTogglingTotp]     = useState(false);

  const loginRow = triggerRow(sec, "login");
  const resetRow = triggerRow(sec, "reset");
  const hint     = lockedHint(sec);

  // Maintenance
  const [maintenanceEnabled, setMaintenanceEnabled]   = useState(false);
  const [togglingMaintenance, setTogglingMaintenance] = useState(false);

  const isMountedRef = useRef(true);
  const accentGradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 65%, #a855f7))`;

  useEffect(() => {
    GetMaintenanceStatus().then((s) => setMaintenanceEnabled(s.enabled));
    GetTOTPGlobal().then((s) => setTotpEnabled(s.enabled));
    GetSecurityConfig().then(setSec);
  }, []);


  // pass_app starts blank on edit — the backend never returns a stored app password (see
  // SendEmailResponse). Leaving it blank on save keeps the existing one; see handleSave.
  const startEdit = (item: SendEmailResponse) => { setEditingId(item.id); setForm({ email: item.email, pass_app: "" }); };
  const cancelEdit = () => { setEditingId(null); setForm({ email: "", pass_app: "" }); };

  const handleSave = async (id: number) => {
    // pass_app is optional here: the backend only updates it when non-blank, so leaving it empty
    // edits the email/other fields without forcing the app password to be retyped.
    if (!form.email.trim()) { message.error(t("service.fillRequired")); return; }
    try {
      setSaving(true);
      const res = await UpdateSendEmailByID(id, form);
      if (!res) { message.error(t("service.saveFail")); return; }
      message.success(t("service.saveSuccess")); cancelEdit(); void refetch();
    } catch { message.error(t("service.errorOccurred")); }
    finally { if (isMountedRef.current) setSaving(false); }
  };

  const handleCreate = async () => {
    if (!createForm.email.trim() || !createForm.pass_app.trim()) { message.error(t("service.fillRequired")); return; }
    try {
      setCreating(true);
      const res = await CreateSendEmail(createForm);
      if (!res) { message.error(t("service.createFail")); return; }
      message.success(t("service.createSuccess")); setShowCreateForm(false); setCreateForm({ email: "", pass_app: "" }); void refetch();
    } catch { message.error(t("service.errorOccurred")); }
    finally { if (isMountedRef.current) setCreating(false); }
  };

  // สวิตช์ใหญ่ — ปิดแล้ว OTP ทางอีเมลหยุดทั้งระบบจริง ๆ ไม่ใช่แค่เทาปุ่ม
  // จึงยืนยันก่อนปิด และบอกให้ชัดว่าอะไรจะหยุดทำงานบ้าง
  const handleToggleTwoStep = async () => {
    const lost = flowsLostByDisabling(sec);
    if (lost.length > 0) {
      const ok = await confirm({
        title: "Turn off Two-Step Verification?",
        content: `These flows stop working immediately: ${lost.join(" and ")}`,
        okText: "Turn off",
      });
      if (!ok) return;
    }
    try {
      setTogglingMaster(true);
      const res = await ToggleTwoStep();
      if (!res) { message.error(t("service.twoFaUpdateFail")); return; }
      setSec((prev) => applyMasterToggle(prev, res.two_step_enabled));
      message.success(res.two_step_enabled ? t("service.twoFaEnabled") : t("service.twoFaDisabled"));
    } catch { message.error(t("service.twoFaUpdateFail")); }
    finally { setTogglingMaster(false); }
  };

  const handleToggleLogin2FA = async () => {
    if (loginRow.locked) return;
    try {
      setTogglingLogin(true);
      const res = await Toggle2FA();
      if (!res) return;
      setSec((prev) => applyTriggerToggle(prev, "login", res.two_factor_enabled));
      message.success(res.two_factor_enabled ? t("service.twoFaEnabled") : t("service.twoFaDisabled"));
    } catch { message.error(t("service.twoFaUpdateFail")); }
    finally { setTogglingLogin(false); }
  };

  const handleToggleResetOTP = async () => {
    if (resetRow.locked) return;
    try {
      setTogglingReset(true);
      const res = await ToggleResetOTP();
      if (!res) return;
      setSec((prev) => applyTriggerToggle(prev, "reset", res.reset_otp_enabled));
      message.success(res.reset_otp_enabled ? t("service.resetOtpEnabled") : t("service.resetOtpDisabled"));
    } catch { message.error(t("service.resetOtpUpdateFail")); }
    finally { setTogglingReset(false); }
  };

  const handleToggleTotp = async () => {
    try {
      setTogglingTotp(true);
      const res = await ToggleTOTPGlobal();
      setTotpEnabled(res.enabled);
      message.success(res.enabled ? t("service.totpRequiredOnLogin") : t("service.totpNotRequired"));
    } catch { message.error(t("service.totpUpdateFail")); }
    finally { setTogglingTotp(false); }
  };

  const handleToggleMaintenance = async () => {
    setTogglingMaintenance(true);
    const res = await ToggleMaintenance();
    setMaintenanceEnabled(res.enabled);
    message.success(res.enabled ? t("service.maintenanceEnabled") : t("service.maintenanceDisabled"));
    setTogglingMaintenance(false);
  };

  const inputCls = `h-10 w-full rounded-[4px] border surface-card pl-9 pr-4 text-[13px] ink outline-none transition`;

  const onFocusInput = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = currentColor;
    e.currentTarget.style.boxShadow = `0 0 0 2px ${currentColor}20`;
  };
  const onBlurInput = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  };

  return (
    <div className="space-y-4">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass — this page has no functional hero controls to relocate. */}

      {/* ── Email & Security ── */}
      <div className="panel panel-flush">

        {/* Section header */}
        <div className="flex items-center gap-2.5 border-b px-6 py-4" style={{ borderColor: `${currentColor}18` }}>
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-[4px]" style={{ backgroundColor: `${currentColor}15` }}>
            <FiLock className="text-[16px]" style={{ color: currentColor }} />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold ink">{t("service.emailSecurityTitle")}</h2>
            <p className="text-[11px] ink-3">{t("service.emailSecuritySubtitle")}</p>
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="py-8 text-center text-[13px] ink-3">{t("service.loading")}</div>
          ) : !emails || emails.length === 0 ? (
            !showCreateForm ? (
              <div className="flex flex-col items-center gap-4 py-6">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-[4px]" style={{ backgroundColor: `${currentColor}15` }}>
                  <FiMail className="text-[22px]" style={{ color: currentColor }} />
                </div>
                <div className="text-center">
                  <p className="text-[13px] font-semibold ink">{t("service.noEmailConfig")}</p>
                  <p className="mt-1 text-[11px] ink-3">{t("service.noEmailConfigDesc")}</p>
                </div>
                <button type="button" onClick={() => setShowCreateForm(true)}
                  className="inline-flex items-center gap-1.5 rounded-[4px] px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90"
                  style={{ background: accentGradient }}>
                  <FiPlus className="text-[12px]" />{t("service.addEmailConfig")}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: currentColor }}>{t("service.newEmailConfig")}</p>
                  <button type="button" onClick={() => { setShowCreateForm(false); setCreateForm({ email: "", pass_app: "" }); }}
                    className="ink-3 hover-ink">
                    <FiX className="text-[14px]" />
                  </button>
                </div>
                {/* Sender Email */}
                <div>
                  <label htmlFor="sender-email" className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: currentColor }}>
                    SENDER EMAIL
                  </label>
                  <div className="relative">
                    <FiMail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px]" style={{ color: currentColor }} />
                    <input id="sender-email" type="email" value={createForm.email} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
                      placeholder="your@gmail.com" className={inputCls}
                      style={{ borderColor: `${currentColor}30` }}
                      onFocus={onFocusInput} onBlur={onBlurInput} />
                  </div>
                </div>
                {/* App Password */}
                <div>
                  <label htmlFor="app-password" className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: currentColor }}>
                    APP PASSWORD
                  </label>
                  <div className="relative">
                    <FiLock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px]" style={{ color: currentColor }} />
                    <input id="app-password" type="password" value={createForm.pass_app} onChange={(e) => setCreateForm((p) => ({ ...p, pass_app: e.target.value }))}
                      placeholder={t("service.appPasswordPlaceholder")} className={inputCls}
                      style={{ borderColor: `${currentColor}30` }}
                      onFocus={onFocusInput} onBlur={onBlurInput} />
                  </div>
                </div>
                <button type="button" onClick={handleCreate} disabled={creating}
                  className="inline-flex items-center gap-1.5 rounded-[4px] px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
                  style={{ background: accentGradient }}>
                  <FiSave className="text-[12px]" />{creating ? t("service.saving") : t("service.save")}
                </button>
              </div>
            )
          ) : (
            <div className="space-y-4">
              {emails.map((item) => (
                <div key={item.id}>
                  {/* Email display row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="inline-flex h-9 w-9 items-center justify-center rounded-[4px]" style={{ backgroundColor: `${currentColor}15`, color: currentColor }}>
                        <FiMail className="text-[15px]" />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold ink">{item.email}</p>
                        <div className="flex items-center gap-1">
                          <FiCheckCircle className="text-[10px] text-emerald-500" />
                          <p className="text-[11px] ink-3">{t("service.configured")}</p>
                        </div>
                      </div>
                    </div>
                    <button type="button" onClick={() => editingId === item.id ? cancelEdit() : startEdit(item)}
                      className="inline-flex items-center gap-1.5 rounded-[4px] border surface-card px-3 py-1.5 text-[12px] font-semibold transition"
                      style={{ borderColor: `${currentColor}30`, color: currentColor }}>
                      {editingId === item.id ? <><FiX className="text-[11px]" />{t("service.cancel")}</> : <><FiEdit2 className="text-[11px]" />{t("service.edit")}</>}
                    </button>
                  </div>

                  {/* Inline edit */}
                  {editingId === item.id && (
                    <div className="mt-3 rounded-[4px] border p-4 space-y-3" style={{ borderColor: `${currentColor}20`, backgroundColor: `${currentColor}05` }}>
                      <div>
                        <label htmlFor="sender-email-1" className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: currentColor }}>
                          SENDER EMAIL
                        </label>
                        <div className="relative">
                          <FiMail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px]" style={{ color: currentColor }} />
                          <input id="sender-email-1" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                            className={inputCls} style={{ borderColor: `${currentColor}30` }}
                            onFocus={onFocusInput} onBlur={onBlurInput} />
                        </div>
                      </div>
                      <div>
                        <label htmlFor="app-password-2" className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: currentColor }}>
                          APP PASSWORD
                        </label>
                        <div className="relative">
                          <FiLock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px]" style={{ color: currentColor }} />
                          <input id="app-password-2" type="password" value={form.pass_app} onChange={(e) => setForm((p) => ({ ...p, pass_app: e.target.value }))}
                            placeholder="Leave blank to keep the current password" className={inputCls}
                            style={{ borderColor: `${currentColor}30` }}
                            onFocus={onFocusInput} onBlur={onBlurInput} />
                        </div>
                      </div>
                      <button type="button" onClick={() => handleSave(item.id)} disabled={saving}
                        className="inline-flex items-center gap-1.5 rounded-[4px] px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
                        style={{ background: accentGradient }}>
                        <FiSave className="text-[12px]" />{saving ? t("service.saving") : t("service.save")}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Security Settings ── */}
      <div className="panel panel-flush">

        <div className="flex items-center gap-2.5 border-b px-6 py-4" style={{ borderColor: `${currentColor}18` }}>
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-[4px]" style={{ backgroundColor: `${currentColor}15` }}>
            <FiShield className="text-[16px]" style={{ color: currentColor }} />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold ink">{t("service.verificationTitle")}</h2>
            <p className="text-[11px] ink-3">{t("service.verificationSubtitle")}</p>
          </div>
        </div>

        <div className="px-6 pb-4">

          {/* Two-Step Verification — สวิตช์ใหญ่ ต้องเปิดก่อนถึงจะแตะ trigger ข้างล่างได้ */}
          <div className="flex items-center justify-between py-4 border-b" style={{ borderColor: `${currentColor}10` }}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] transition-colors"
                style={sec.two_step ? { backgroundColor: `${currentColor}15`, color: currentColor } : { backgroundColor: "#f1f5f9", color: "#9ca3af" }}>
                <FiShield size={15} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold ink">{t("service.twoStep")}</span>
                  {sec.two_step && (
                    <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
                      style={{ borderColor: `${currentColor}40`, backgroundColor: `${currentColor}10`, color: currentColor }}>
                      Enabled
                    </span>
                  )}
                  <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
                    style={{ borderColor: `${currentColor}30`, backgroundColor: `${currentColor}08`, color: currentColor }}>
                    Strong Access
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] ink-3">{masterSummary(sec)}</p>
              </div>
            </div>
            <Toggle label="Two-step verification for every account" enabled={sec.two_step} loading={togglingMaster} color={currentColor} onToggle={handleToggleTwoStep} />
          </div>

          {/* OTP Trigger Settings header */}
          <div className="pt-4 pb-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] ink-3">
              OTP Trigger Settings
            </p>
            <p className="text-[11px] ink-3 mt-0.5">
              Select which flows require OTP verification
            </p>
            {hint && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-1 text-[11px]"
                style={{ borderColor: "#94a3b830", backgroundColor: "#94a3b810", color: "#64748b" }}>
                <FiLock size={11} className="shrink-0" /> {hint}
              </p>
            )}
          </div>

          {/* Login OTP checkbox */}
          <div style={{ borderColor: `${currentColor}10` }} className="border-b">
            <CheckRow
              icon={<FiLogIn size={14} />}
              title="Login OTP"
              desc="Require OTP on every login"
              checked={loginRow.checked}
              locked={loginRow.locked}
              badge={loginRow.badge}
              loading={togglingLogin}
              currentColor={currentColor}
              onToggle={handleToggleLogin2FA}
            />
          </div>

          {/* Reset Password OTP checkbox
              (Register OTP ถูกถอดออก — ระบบนี้ไม่มีหน้าสมัครสมาชิก บัญชีถูกสร้างโดย admin
               ผ่านหน้า Users เท่านั้น endpoint ฝั่ง server ก็ถูกลบไปด้วยแล้ว) */}
          <div style={{ borderColor: `${currentColor}10` }} className="border-b">
            <CheckRow
              icon={<FiUnlock size={14} />}
              title="Reset Password OTP"
              desc="Require OTP when resetting password"
              checked={resetRow.checked}
              locked={resetRow.locked}
              badge={resetRow.badge}
              loading={togglingReset}
              currentColor={currentColor}
              onToggle={handleToggleResetOTP}
            />
          </div>

          {/* Authenticator App (TOTP) — toggle */}
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] transition-colors"
                style={totpEnabled ? { backgroundColor: "#e0f2fe", color: "#0891b2" } : { backgroundColor: "#f1f5f9", color: "#9ca3af" }}>
                <FiKey size={15} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold ink">{t("service.authenticatorTotp")}</span>
                  {totpEnabled && (
                    <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-bold text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300">
                      Enabled
                    </span>
                  )}
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                    Maximum Security
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] ink-3">
                  {totpEnabled ? t("service.totpOnDesc") : t("service.totpOffDesc")}
                </p>
              </div>
            </div>
            <Toggle label="Authenticator app (TOTP)" enabled={totpEnabled} loading={togglingTotp} color="#0891b2" onToggle={handleToggleTotp} />
          </div>

        </div>
      </div>

      {/* ── Maintenance Mode ── */}
      <div className="panel panel-flush">
        <div className="flex items-center gap-2.5 border-b px-6 py-4" style={{ borderColor: `${currentColor}18` }}>
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] bg-amber-50 dark:bg-amber-500/10">
            <FiTool className="text-[16px] text-amber-500" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold ink">{t("service.maintenanceMode")}</h2>
            <p className="text-[11px] ink-3">{t("service.maintenanceModeSubtitle")}</p>
          </div>
        </div>
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className={["inline-flex h-9 w-9 items-center justify-center rounded-[4px] transition-colors",
              maintenanceEnabled ? "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400" : "surface-sunken ink-3",
            ].join(" ")}>
              <FiTool className="text-[15px]" />
            </div>
            <div>
              <p className="text-[13px] font-semibold ink">
                {maintenanceEnabled ? t("service.systemInMaintenance") : t("service.systemOperational")}
              </p>
              <p className="text-[11px] ink-3">
                {maintenanceEnabled ? t("service.maintenanceOnDesc") : t("service.maintenanceOffDesc")}
              </p>
            </div>
          </div>
          <Toggle label="Maintenance mode" enabled={maintenanceEnabled} loading={togglingMaintenance} color="#f59e0b" onToggle={handleToggleMaintenance} />
        </div>
      </div>

    </div>
  );
};

export default ServicePage;
