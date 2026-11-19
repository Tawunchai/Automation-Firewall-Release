import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { message } from "../../components/ui/toast";
import { FiShield, FiSave, FiRefreshCw, FiCheck, FiClock, FiAlertTriangle } from "react-icons/fi";
import { GetPasswordPolicy, UpdatePasswordPolicy, type PasswordPolicy } from "../../api/passwordpolicy";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import { useNavigate } from "react-router-dom";
import { apiErrorDetail } from "../../api/errorText";

/** Section header strip: tinted medallion + title + subtitle, matching the rest of the console's panels. */
const CardHead: React.FC<{ icon: React.ReactNode; title: string; desc?: string; tintColor: string }> = ({
  icon, title, desc, tintColor,
}) => (
  <div className="flex items-start gap-2.5 border-b hairline-2 px-5 py-4">
    <span className="medallion h-8 w-8 shrink-0 text-[14px]" style={{ color: tintColor, background: `color-mix(in srgb, ${tintColor} 14%, transparent)` }}>
      {icon}
    </span>
    <div className="min-w-0">
      <h2 className="t-card font-semibold">{title}</h2>
      {desc && <p className="mt-0.5 text-[11px] ink-3">{desc}</p>}
    </div>
  </div>
);

const DEFAULT_POLICY: PasswordPolicy = {
  min_length: 8,
  require_uppercase: false,
  require_number: false,
  require_special: false,
  expiry_days: 0,
};

const PasswordPolicyPage: React.FC = () => {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const { currentColor } = useStateContext();

  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_POLICY);
  const [draft, setDraft] = useState<PasswordPolicy>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => { if (!isAdmin) navigate("/admin", { replace: true }); }, [isAdmin, navigate]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await GetPasswordPolicy();
      setPolicy(data); setDraft(data); setHasChanges(false);
    } catch { message.error(t("passwordPolicy.loadFailed")); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const updateDraft = <K extends keyof PasswordPolicy>(key: K, value: PasswordPolicy[K]) => {
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      setHasChanges(JSON.stringify(next) !== JSON.stringify(policy));
      return next;
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await UpdatePasswordPolicy(draft);
      setPolicy(res.data); setDraft(res.data); setHasChanges(false);
      message.success(t("passwordPolicy.updateSuccess"));
    } catch (err) {
      message.error(apiErrorDetail(err, t("passwordPolicy.saveFailed")));
    } finally { setSaving(false); }
  };

  const ToggleRow: React.FC<{ label: string; desc: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, desc, value, onChange }) => (
    <div className="flex items-center justify-between gap-4 rounded-[4px] border hairline-2 surface-sunken px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold ink">{label}</p>
        <p className="mt-0.5 text-[11px] ink-3">{desc}</p>
      </div>
      {/* A real <button>, not a div wearing role="switch".
          
          The div carried the role and the aria-checked but nothing that made it reachable: no
          tabIndex, no key handler. So the toggles on this page — the ones that decide whether
          everyone's password has to contain a symbol — could be operated with a mouse and by no
          other means. A button is focusable, fires on Enter and Space, and announces its state
          from the role already present; the only thing that changes visually is the focus ring. */}
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={[
          "relative h-6 w-11 shrink-0 cursor-pointer overflow-hidden rounded-full transition-colors duration-200",
          "outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          !value ? "surface-sunken" : "",
        ].join(" ")}
        style={{ backgroundColor: value ? currentColor : undefined }}
      >
        <span
          className={[
            "absolute left-0 top-0.5 block h-5 w-5 rounded-full surface-card shadow-sm transition-transform duration-200",
            value ? "translate-x-5.5" : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-60 items-center justify-center">
        <FiRefreshCw className="animate-spin text-[22px]" style={{ color: currentColor }} />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass — this row keeps only the hero's two functional controls. */}
      <div className="flex items-center justify-end gap-2">
        <button onClick={() => void load()} disabled={loading} className="btn btn-soft btn-sm">
          <FiRefreshCw className="text-[13px]" />{t("passwordPolicy.reset")}
        </button>
        <button onClick={() => void handleSave()} disabled={saving || !hasChanges} className="btn btn-accent btn-sm">
          {saving ? <FiRefreshCw className="animate-spin text-[13px]" /> : <FiSave className="text-[13px]" />}
          {saving ? t("passwordPolicy.saving") : t("passwordPolicy.saveChanges")}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

        {/* ── Complexity Rules ── */}
        <div className="shell-card p-0! overflow-hidden">
          <CardHead icon={<FiShield size={14} />} title={t("passwordPolicy.complexityRules")}
            desc={t("passwordPolicy.complexityDesc")} tintColor={currentColor} />
          <div className="space-y-2.5 p-5">
            {/* Min Length */}
            <div className="rounded-[4px] border hairline-2 surface-sunken px-4 py-3.5">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold ink">{t("passwordPolicy.minLength")}</p>
                  <p className="mt-0.5 text-[11px] ink-3">{t("passwordPolicy.minLengthDesc")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => updateDraft("min_length", Math.max(6, draft.min_length - 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-[4px] border hairline surface-card ink-2 transition"
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.borderColor = currentColor; (e.target as HTMLElement).style.color = currentColor; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.borderColor = ""; (e.target as HTMLElement).style.color = ""; }}>
                    −
                  </button>
                  <input type="number" min={6} max={128} value={draft.min_length}
                    onChange={(e) => updateDraft("min_length", Math.min(128, Math.max(6, parseInt(e.target.value) || 6)))}
                    className="h-7 w-14 rounded-[4px] border surface-card px-0 text-center text-[13px] font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    style={{ borderColor: `${currentColor}40`, color: currentColor }} />
                  <button type="button" onClick={() => updateDraft("min_length", Math.min(128, draft.min_length + 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-[4px] border hairline surface-card ink-2 transition"
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.borderColor = currentColor; (e.target as HTMLElement).style.color = currentColor; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.borderColor = ""; (e.target as HTMLElement).style.color = ""; }}>
                    +
                  </button>
                </div>
              </div>
            </div>

            <ToggleRow label={t("passwordPolicy.requireUppercase")} desc={t("passwordPolicy.requireUppercaseDesc")} value={draft.require_uppercase} onChange={(v) => updateDraft("require_uppercase", v)} />
            <ToggleRow label={t("passwordPolicy.requireNumber")} desc={t("passwordPolicy.requireNumberDesc")} value={draft.require_number} onChange={(v) => updateDraft("require_number", v)} />
            <ToggleRow label={t("passwordPolicy.requireSpecial")} desc={t("passwordPolicy.requireSpecialDesc")} value={draft.require_special} onChange={(v) => updateDraft("require_special", v)} />
          </div>
        </div>

        {/* ── Expiry + Preview ── */}
        <div className="space-y-5">
          {/* Expiry */}
          <div className="shell-card p-0! overflow-hidden">
            <CardHead icon={<FiClock size={14} />} title={t("passwordPolicy.passwordExpiry")}
              desc={t("passwordPolicy.expiryDesc")} tintColor="#D97706" />
            <div className="p-5">
              <div className="flex items-center gap-3">
                <input type="number" min={0} max={365} value={draft.expiry_days}
                  onChange={(e) => updateDraft("expiry_days", Math.min(365, Math.max(0, parseInt(e.target.value) || 0)))}
                  className="h-10 w-24 rounded-[4px] border surface-card px-0 text-center text-[15px] font-bold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  style={{ borderColor: `${currentColor}40`, color: currentColor }}
                  onFocus={(e) => { e.target.style.boxShadow = `0 0 0 2px ${currentColor}20`; }}
                  onBlur={(e) => { e.target.style.boxShadow = ""; }} />
                <span className="text-[12px] ink-2">{t("passwordPolicy.days")}</span>
                {draft.expiry_days === 0 && (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-300">
                    {t("passwordPolicy.noExpiry")}
                  </span>
                )}
                {draft.expiry_days > 0 && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-300">
                    {t("passwordPolicy.expiresEvery", { count: draft.expiry_days })}
                  </span>
                )}
              </div>
              {draft.expiry_days > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-[4px] border border-amber-200/60 bg-amber-50/60 px-3 py-2.5 dark:border-amber-400/20 dark:bg-amber-500/8">
                  <FiAlertTriangle className="mt-0.5 shrink-0 text-[11px] text-amber-500" />
                  <p className="text-[11px] text-amber-700 dark:text-amber-200">{t("passwordPolicy.expiryWarning", { count: draft.expiry_days })}</p>
                </div>
              )}
            </div>
          </div>

          {/* Preview */}
          <div className="shell-card p-0! overflow-hidden">
            <CardHead icon={<FiCheck size={14} />} title={t("passwordPolicy.policyPreview")}
              desc={t("passwordPolicy.policyPreviewDesc")} tintColor="#1e9e6b" />
            <div className="space-y-2 p-5">
              {[
                { label: t("passwordPolicy.minLengthRule", { count: draft.min_length }), active: true },
                { label: t("passwordPolicy.hasUppercase"), active: draft.require_uppercase },
                { label: t("passwordPolicy.hasNumber"), active: draft.require_number },
                { label: t("passwordPolicy.hasSpecial"), active: draft.require_special },
                { label: draft.expiry_days > 0 ? t("passwordPolicy.expiresEveryRule", { count: draft.expiry_days }) : t("passwordPolicy.noExpiryRule"), active: true },
              ].map((rule) => (
                <div key={rule.label}
                  className={["flex items-center gap-2 rounded-[4px] px-3 py-2 text-[11px]", rule.active ? "font-medium" : "surface-sunken ink-3 line-through"].join(" ")}
                  style={rule.active ? { backgroundColor: `${currentColor}10`, color: currentColor } : undefined}>
                  <FiCheck className={`text-[11px] ${rule.active ? "" : "ink-3"}`} style={rule.active ? { color: currentColor } : undefined} />
                  {rule.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PasswordPolicyPage;
