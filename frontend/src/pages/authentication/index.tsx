import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FiCheck, FiKey, FiLock, FiMail } from "react-icons/fi";

import { message } from "../../components/ui/toast";
import {
  CheckUserEmail,
  Login,
  SendOTP,
  VerifyLoginOTP,
} from "../../api/auth";
import { GetPasswordPolicy, type PasswordPolicy } from "../../api/passwordpolicy";
import { DEFAULT_POLICY, firstPolicyViolation, policyRules } from "../../lib/passwordPolicy";
import { VerifyTOTPLogin } from "../../api/totp";
import { VerifyBackupCode } from "../../api/backupCodes";
import { GetPublicMaintenanceStatus } from "../../api/maintenance";
import { useAuth } from "../../contexts/AuthContext.logic";
import OtpModal from "../../components/ui/OtpModal";
import firewallLogo from "../../assets/logo_sidebar.png";
import HeroArt from "./HeroArt";
import { errorStatus, errorText } from "./auth-errors";
import {
  INPUT_CLS, PRIMARY_BTN, Field, InputShell, RevealBtn, ErrorBox, BackToSignIn,
} from "./auth-controls";
import CodeView, { type CodeViewProps } from "./auth-code-view";


// The sign-in screen.
//
// One column of form on the left, one panel of product on the right — the layout every console
// people already use looks like, and the one the design this was built from specifies.
//
// What this page is NOT, deliberately:
//
//   · There is no sign-up. Accounts on this console are issued by an administrator from
//     Security › Users; a firewall console is not a service anyone should be able to open an
//     account on from its front door. The backend's registration endpoints still exist — they are
//     what the admin page and the OTP flow use — but nothing here offers them.
//   · There are no social sign-in buttons. Google/GitHub/LINE authenticate a person against a
//     third party; the accounts that may drive a firewall are the ones in this system's own user
//     table, and offering four ways in means four ways to get the mapping wrong.
//
// What it still has to carry, because login is not one step: a password can be answered by a
// second factor (authenticator app, emailed code, or a recovery code) and any of those can be the
// step that actually signs you in. Those views replace the form in place rather than living on
// their own route, so the browser's back button can never strand a half-finished login.
//
// ── Colour ───────────────────────────────────────────────────────────────────
// The blue below is fixed, not the console's `--accent`. The accent is a per-user preference
// applied after sign-in; on this page there is no user yet, so it would paint the button whatever
// the last person to use this browser happened to pick. A front door should look the same to
// everyone who arrives at it.

/** localStorage key for the "remember me" address. Namespaced like every other console pref. */
const REMEMBER_KEY = "auth:remembered_email";

/** Cleared on every successful sign-in — see AuthContext; a stale flag logs the new session out. */
const FORCE_LOGOUT_KEY = "auth:maintenance_logout";

type ViewMode = "login" | "forgot" | "reset" | "totp" | "email_otp" | "backup_code";

// ── Page ──────────────────────────────────────────────────────────────────────

const Index: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { refreshMe, isAuthed } = useAuth();

  // Navigate only AFTER the auth state has been applied, so setUser()'s re-render cannot race the
  // route guard reading a context that has not updated yet.
  const shouldNavigateRef = useRef(false);
  useEffect(() => {
    if (isAuthed && shouldNavigateRef.current) {
      shouldNavigateRef.current = false;
      navigate("/admin", { replace: true });
    }
  }, [isAuthed, navigate]);

  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const [viewMode, setViewMode] = useState<ViewMode>("login");

  // ── Sign in ────────────────────────────────────────────────────────────────
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");

  // "Remember me" saves the ADDRESS, never the password. There is no server-side long session to
  // ask for — /auth/login takes an email and a password and nothing else — so the honest thing for
  // the checkbox to do is fill the field in next time, which is what its own caption promises.
  const [remember, setRemember] = useState(false);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setLoginEmail(saved);
        setRemember(true);
      }
    } catch { /* private mode: a missing preference is not an error */ }
  }, []);

  // ── Second factor ──────────────────────────────────────────────────────────
  const [totpPendingToken, setTotpPendingToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpSubmitting, setTotpSubmitting] = useState(false);
  const [totpError, setTotpError] = useState("");

  const [backupCode, setBackupCode] = useState("");
  const [backupSubmitting, setBackupSubmitting] = useState(false);
  const [backupError, setBackupError] = useState("");

  const [emailOtpPendingToken, setEmailOtpPendingToken] = useState("");
  const [emailOtpMasked, setEmailOtpMasked] = useState("");
  const [emailOtpCode, setEmailOtpCode] = useState("");
  const [emailOtpSubmitting, setEmailOtpSubmitting] = useState(false);
  const [emailOtpError, setEmailOtpError] = useState("");

  // ── Password recovery ──────────────────────────────────────────────────────
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotError, setForgotError] = useState("");

  const [verifiedResetEmail, setVerifiedResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showConfirmResetPassword, setShowConfirmResetPassword] = useState(false);
  const [resetPasswordFocused, setResetPasswordFocused] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [openResetOTPModal, setOpenResetOTPModal] = useState(false);

  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy>(DEFAULT_POLICY);

  // Fetched only when a password is about to be SET — the sign-in form has no rules to show.
  useEffect(() => {
    if (viewMode !== "reset") return;
    GetPasswordPolicy()
      .then((p) => { if (isMountedRef.current) setPasswordPolicy(p); })
      .catch(() => {});
  }, [viewMode]);

  const passwordStrength = useMemo(() => {
    let score = 0;
    if (newPassword.length >= 8) score += 25;
    if (/[A-Z]/.test(newPassword)) score += 20;
    if (/[a-z]/.test(newPassword)) score += 20;
    if (/[0-9]/.test(newPassword)) score += 15;
    if (/[^A-Za-z0-9]/.test(newPassword)) score += 20;
    return Math.min(score, 100);
  }, [newPassword]);

  const passwordStrengthLabel = useMemo(() => {
    if (passwordStrength >= 80) return t("auth.strengthStrong");
    if (passwordStrength >= 50) return t("auth.strengthMedium");
    if (passwordStrength > 0) return t("auth.strengthWeak");
    return t("auth.strengthNotSet");
  }, [passwordStrength, t]);

  // checklist และตัวตรวจตอนกดส่ง มาจาก policyRules ชุดเดียวกัน (src/lib/passwordPolicy.ts)
  // ของเดิมเขียนกฎซ้ำสองรอบในไฟล์นี้ + อีกชุดในหน้า Create User ที่ไม่ตรงกับ policy เลย
  const resetRules = useMemo(
    () => policyRules(newPassword, passwordPolicy).map((r) => ({
      label: r.count === undefined ? t(r.i18nKey) : t(r.i18nKey, { count: r.count }),
      ok: r.ok,
    })),
    [newPassword, passwordPolicy, t],
  );

  const goToLogin = () => {
    setViewMode("login");
    setLoginError("");
  };

  // ── Handlers ───────────────────────────────────────────────────────────────

  /** Records the just-signed-in session and hands over to the route guard. */
  const finishSignIn = async () => {
    // A stale maintenance-logout flag would make refreshMe() revoke the session we just created.
    sessionStorage.removeItem(FORCE_LOGOUT_KEY);
    shouldNavigateRef.current = true;
    try { await refreshMe(true); } catch { /* the effect above will not fire; the guard re-checks */ }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");

    if (!loginEmail.trim() || !loginPassword.trim()) {
      setLoginError("Please enter Email and Password");
      return;
    }

    try {
      setLoginSubmitting(true);

      // The backend decides — an admin signs in during maintenance, a user gets a 503.
      const res = await Login({ email: loginEmail, password: loginPassword });

      // The password was right but it is not the last step. Both branches hand back a pending
      // token rather than a session, so nothing is signed in until the code is verified.
      if (res?.requires_totp && res?.pending_token) {
        setTotpPendingToken(res.pending_token);
        setTotpCode("");
        setTotpError("");
        setViewMode("totp");
        return;
      }
      if (res?.requires_2fa && res?.pending_token) {
        setEmailOtpPendingToken(res.pending_token);
        setEmailOtpMasked(res.masked_email ?? "");
        setEmailOtpCode("");
        setEmailOtpError("");
        setViewMode("email_otp");
        return;
      }

      const role = (res?.user?.role ?? "").toLowerCase();
      if (role !== "admin" && role !== "user") {
        setLoginError("This account does not have access");
        return;
      }

      try {
        if (remember) window.localStorage.setItem(REMEMBER_KEY, loginEmail.trim());
        else window.localStorage.removeItem(REMEMBER_KEY);
      } catch { /* private mode */ }

      if (role !== "admin") {
        const maint = await GetPublicMaintenanceStatus();
        if (maint.enabled) {
          const secs = maint.seconds_remaining > 0 ? maint.seconds_remaining : 0;
          message.warning({
            content: secs > 0
              ? `System is under maintenance — you will be signed out in ${secs}s.`
              : "System is under maintenance. Access is restricted.",
            duration: 5,
          });
        } else {
          message.success({ content: t("auth.loginSuccess"), duration: 2 });
        }
      } else {
        message.success({ content: t("auth.loginSuccess"), duration: 2 });
      }

      await finishSignIn();
    } catch (err: unknown) {
      if (errorStatus(err) === 503) setLoginError("System is under maintenance, login unavailable");
      else setLoginError(errorText(err, "Login failed, please try again"));
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleEmailOTPSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailOtpCode.length !== 6) { setEmailOtpError("Please enter a 6-digit code"); return; }
    setEmailOtpError("");
    try {
      setEmailOtpSubmitting(true);
      const res = await VerifyLoginOTP({ pending_token: emailOtpPendingToken, otp: emailOtpCode });
      if (!res?.user) { setEmailOtpError("Verification failed"); return; }
      message.success({ content: t("auth.loginSuccess"), duration: 2 });
      await finishSignIn();
    } catch (err: unknown) {
      setEmailOtpError(errorText(err, "Invalid code, please try again"));
    } finally {
      setEmailOtpSubmitting(false);
    }
  };

  const handleTOTPSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totpCode.length !== 6) { setTotpError("Please enter a 6-digit code"); return; }
    setTotpError("");
    try {
      setTotpSubmitting(true);
      const res = await VerifyTOTPLogin(totpPendingToken, totpCode);
      if (!res?.user) { setTotpError("Verification failed"); return; }
      message.success({ content: t("auth.loginSuccess"), duration: 2 });
      await finishSignIn();
    } catch (err: unknown) {
      setTotpError(errorText(err, "Invalid code, please try again"));
    } finally {
      setTotpSubmitting(false);
    }
  };

  const handleBackupCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = backupCode.replace(/-/g, "").trim();
    if (normalized.length !== 8) { setBackupError("Enter your 8-character backup code"); return; }
    setBackupError("");
    try {
      setBackupSubmitting(true);
      const res = await VerifyBackupCode(totpPendingToken, backupCode);
      if (!res?.user) { setBackupError("Invalid backup code"); return; }
      message.success({ content: t("auth.loginSuccess"), duration: 2 });
      await finishSignIn();
    } catch (err: unknown) {
      setBackupError(errorText(err, "Invalid backup code"));
    } finally {
      setBackupSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError("");

    const trimmed = forgotEmail.trim();
    if (!trimmed) { setForgotError("Please enter your email"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setForgotError("Invalid email format"); return; }

    try {
      setForgotSubmitting(true);
      // The reply is deliberately the same whether or not the address is registered, so there is
      // nothing to branch on: an unknown address advances to the next screen exactly like a known
      // one and simply never receives a code. Telling the two apart here would put the
      // account-enumeration oracle back on the login page, in the browser this time.
      const res = await CheckUserEmail({ email: trimmed });
      if (!res) { setForgotError("Unable to reach the server, please try again"); return; }
      if (res.error) { setForgotError(res.error); return; }

      setVerifiedResetEmail(trimmed);
      setResetError("");
      setNewPassword("");
      setConfirmPassword("");
      setViewMode("reset");
    } catch (err: unknown) {
      setForgotError(errorText(err, "An error occurred while verifying email"));
    } finally {
      setForgotSubmitting(false);
    }
  };

  const validateResetPassword = () => {
    if (!newPassword.trim()) return t("auth.newPasswordRequired");
    const bad = firstPolicyViolation(newPassword, passwordPolicy);
    if (bad) return bad.count === undefined ? t(bad.i18nKey) : t(bad.i18nKey, { count: bad.count });
    if (!confirmPassword.trim()) return t("auth.confirmPasswordRequired");
    if (newPassword !== confirmPassword) return t("auth.passwordMismatch");
    return "";
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError("");

    const passwordError = validateResetPassword();
    if (passwordError) { setResetError(passwordError); return; }

    try {
      setResetSubmitting(true);

      const sendRes = await SendOTP({ email: verifiedResetEmail });
      if (sendRes && !sendRes.error) {
        message.success(sendRes.message || "OTP sent to your email");
        setOpenResetOTPModal(true);
        return;
      }

      // There is no path past this point that resets a password without the mailed code.
      //
      // This used to fall through to a direct reset whenever the backend reported the OTP path
      // switched off — carrying a token that /check-user-email had handed to anyone who asked, so
      // the fallback checked nothing at all. With email OTP off, a reset is an administrator's job,
      // and saying so is more honest than a screen that quietly changes the password.
      const isOtpDisabled = sendRes?.error === "OTP password reset is disabled";
      setResetError(
        isOtpDisabled
          ? "Password reset by email is turned off. Ask an administrator to set a new password for you."
          : sendRes?.error || "Failed to send OTP, please try again"
      );
    } catch (err: unknown) {
      setResetError(errorText(err, "An error occurred while sending OTP"));
    } finally {
      setResetSubmitting(false);
    }
  };

  const handleResetVerified = () => {
    setOpenResetOTPModal(false);
    setVerifiedResetEmail("");
    setForgotEmail("");
    setNewPassword("");
    setConfirmPassword("");
    setResetError("");
    setShowResetPassword(false);
    setShowConfirmResetPassword(false);
    setViewMode("login");
    message.success("Password changed successfully");
  };

  // ── Views ──────────────────────────────────────────────────────────────────

  // The three second-factor screens differ only in their props, so they are one component
  // (auth-code-view.tsx) called three times.
  const codeView = (opts: CodeViewProps) => <CodeView {...opts} />;

  const loginView = (
    <form onSubmit={handleLoginSubmit} className="mt-9">
      <ErrorBox text={loginError} />

      <div className={loginError ? "mt-4 space-y-4" : "space-y-4"}>
        <Field label={t("auth.emailLabel")}>
          <InputShell icon={<FiMail />}>
            <input
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="admin@network.local"
              autoComplete="email"
              autoFocus
              className={INPUT_CLS}
            />
          </InputShell>
        </Field>

        <Field label={t("auth.password")}>
          <InputShell
            icon={<FiKey />}
            trailing={
              <RevealBtn
                shown={showLoginPassword}
                onToggle={() => setShowLoginPassword((v) => !v)}
              />
            }
          >
            <input
              type={showLoginPassword ? "text" : "password"}
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              className={INPUT_CLS}
            />
          </InputShell>
        </Field>
      </div>

      <div className="mt-5 flex items-start justify-between gap-3">
        {/* A real checkbox, visually hidden, with the label wrapping both — so the whole block is
            clickable and a screen reader still hears a checkbox. The tick is rendered from state
            rather than a `peer-checked:` rule, because the tick is a DESCENDANT of the box and the
            sibling combinator that variant compiles to would never reach it. */}
        <label htmlFor="auth-remember" className="flex cursor-pointer select-none items-start gap-2.5">
          <input
            id="auth-remember"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="sr-only"
          />
          <span
            aria-hidden
            className={[
              "mt-px flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-[5px] border-2 transition",
              remember ? "auth-check-on" : "border-slate-300 bg-white dark:border-white/25 dark:bg-transparent",
            ].join(" ")}
          >
            {remember && <FiCheck className="text-[12px] text-white" strokeWidth={3.5} />}
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-slate-800 dark:text-white/85">
              {t("auth.rememberMe")}
            </span>
            <span className="mt-0.5 block text-[12px] leading-4 text-slate-500 dark:text-white/50">
              {t("auth.rememberMeHint")}
            </span>
          </span>
        </label>

        {/* Not in the design, kept anyway: without it the only way back from a forgotten password
            is asking an administrator to reset it by hand. */}
        <button
          type="button"
          onClick={() => {
            setForgotError("");
            setForgotEmail(loginEmail.trim());
            setViewMode("forgot");
          }}
          className="auth-link shrink-0 pt-px text-[12px] font-semibold transition"
        >
          {t("auth.forgotPassword")}
        </button>
      </div>

      <button type="submit" disabled={loginSubmitting} className={`${PRIMARY_BTN} mt-6`}>
        {loginSubmitting ? t("auth.loggingIn") : t("auth.signIn")}
      </button>
    </form>
  );


  const emailOtpView = codeView({
    icon: <FiMail className="text-[22px]" />,
    title: t("auth.checkEmail"),
    subtitle: (
      <>
        {t("auth.codeSentTo")}
        {emailOtpMasked && (
          <>
            <br />
            <span className="auth-link font-semibold">{emailOtpMasked}</span>
          </>
        )}
      </>
    ),
    error: emailOtpError,
    onSubmit: handleEmailOTPSubmit,
    label: t("auth.verificationCode"),
    value: emailOtpCode,
    onChange: (v) => { setEmailOtpCode(v.replace(/\D/g, "").slice(0, 6)); setEmailOtpError(""); },
    placeholder: "000000",
    hint: t("auth.codeExpires"),
    submitting: emailOtpSubmitting,
    submitLabel: t("auth.verifySignIn"),
    disabled: emailOtpCode.length !== 6,
    extra: (
      <BackToSignIn
        label={t("auth.useDifferentAccount").replace("← ", "")}
        onClick={() => { goToLogin(); setEmailOtpCode(""); setEmailOtpError(""); }}
      />
    ),
  });

  const totpView = codeView({
    icon: <FiKey className="text-[22px]" />,
    title: t("auth.twoFactorAuth"),
    subtitle: t("auth.totpPrompt"),
    error: totpError,
    onSubmit: handleTOTPSubmit,
    label: t("auth.authenticatorCode"),
    value: totpCode,
    onChange: (v) => { setTotpCode(v.replace(/\D/g, "").slice(0, 6)); setTotpError(""); },
    placeholder: "000000",
    hint: t("auth.codeChanges"),
    submitting: totpSubmitting,
    submitLabel: t("auth.verifySignIn"),
    disabled: totpCode.length !== 6,
    extra: (
      <>
        <button
          type="button"
          onClick={() => { setBackupCode(""); setBackupError(""); setViewMode("backup_code"); }}
          className="auth-link mt-4 w-full text-center text-[12px] font-semibold underline underline-offset-2"
        >
          {t("auth.useBackupCode")}
        </button>
        <BackToSignIn
          label={t("auth.useDifferentAccount").replace("← ", "")}
          onClick={() => { goToLogin(); setTotpCode(""); setTotpError(""); }}
        />
      </>
    ),
  });

  const backupCodeView = codeView({
    icon: <FiKey className="text-[22px]" />,
    title: t("auth.backupCodeTitle"),
    subtitle: t("auth.backupCodePrompt"),
    error: backupError,
    onSubmit: handleBackupCodeSubmit,
    label: t("auth.recoveryCode"),
    value: backupCode,
    onChange: (v) => {
      setBackupCode(v.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 9));
      setBackupError("");
    },
    placeholder: "XXXX-XXXX",
    hint: t("auth.codeOnce"),
    submitting: backupSubmitting,
    submitLabel: t("auth.signInBackup"),
    disabled: backupCode.replace(/-/g, "").length !== 8,
    extra: (
      <>
        <button
          type="button"
          onClick={() => { setViewMode("totp"); setBackupCode(""); setBackupError(""); }}
          className="auth-link mt-4 w-full text-center text-[12px] font-semibold"
        >
          {t("auth.backToAuthCode")}
        </button>
        <BackToSignIn
          label={t("auth.useDifferentAccount").replace("← ", "")}
          onClick={() => { goToLogin(); setBackupCode(""); setBackupError(""); }}
        />
      </>
    ),
  });

  const forgotView = (
    <div className="mt-9">
      <div className="text-center">
        <h2 className="m-0 text-[22px] font-extrabold tracking-tight text-slate-900 dark:text-white">
          {t("auth.forgotPasswordTitle")}
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-5 text-slate-500 dark:text-white/55">
          {t("auth.forgotDesc")}
        </p>
      </div>

      <ErrorBox text={forgotError} />

      <form onSubmit={handleForgotSubmit} className="mt-5">
        <Field label={t("auth.emailLabel")}>
          <InputShell icon={<FiMail />}>
            <input
              type="email"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              placeholder="admin@network.local"
              autoComplete="email"
              autoFocus
              className={INPUT_CLS}
            />
          </InputShell>
        </Field>

        <button type="submit" disabled={forgotSubmitting} className={`${PRIMARY_BTN} mt-5`}>
          {forgotSubmitting ? t("auth.checking") : t("auth.continueBtn")}
        </button>
      </form>

      <BackToSignIn label={t("auth.signIn")} onClick={goToLogin} />
    </div>
  );

  const resetView = (
    <div className="mt-9">
      <div className="text-center">
        <h2 className="m-0 text-[22px] font-extrabold tracking-tight text-slate-900 dark:text-white">
          {t("auth.resetTitle")}
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-5 text-slate-500 dark:text-white/55">
          {t("auth.setNewPasswordFor")}{" "}
          <span className="font-semibold text-slate-700 dark:text-white/85">
            {verifiedResetEmail || t("auth.yourAccount")}
          </span>
        </p>
      </div>

      <ErrorBox text={resetError} />

      <form onSubmit={handleResetSubmit} className="mt-5 space-y-4">
        <Field label={t("auth.newPassword")}>
          <InputShell
            icon={<FiKey />}
            trailing={
              <RevealBtn
                shown={showResetPassword}
                onToggle={() => setShowResetPassword((v) => !v)}
              />
            }
          >
            <input
              type={showResetPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              onFocus={() => setResetPasswordFocused(true)}
              onBlur={() => setResetPasswordFocused(false)}
              placeholder={t("auth.setNewPasswordPh")}
              autoComplete="new-password"
              className={INPUT_CLS}
            />
          </InputShell>
        </Field>

        {/* The rules, while the field has focus and something still fails them. Shown inline rather
            than in a popover so it cannot cover the field it is describing. */}
        {resetPasswordFocused && !resetRules.every((r) => r.ok) && (
          <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-white/10 dark:bg-white/4">
            <p className="m-0 mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-white/40">
              {t("passwordPolicy.requirementsTitle")}
            </p>
            <div className="space-y-1">
              {resetRules.map((r) => (
                <div key={r.label} className="flex items-center gap-2">
                  <span
                    className={[
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-black",
                      r.ok
                        ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                        : "bg-rose-50 text-rose-500 dark:bg-rose-500/15 dark:text-rose-400",
                    ].join(" ")}
                  >
                    {r.ok ? "✓" : "✗"}
                  </span>
                  <span
                    className={[
                      "text-[11.5px]",
                      r.ok ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-white/55",
                    ].join(" ")}
                  >
                    {r.label}
                  </span>
                </div>
              ))}
            </div>
            {newPassword.length > 0 && (
              <div className="mt-2.5 border-t border-slate-200 pt-2 dark:border-white/10">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium text-slate-400 dark:text-white/40">
                    {t("auth.passwordStrength")}
                  </span>
                  <span
                    className="text-[10px] font-semibold"
                    style={{
                      color:
                        passwordStrength >= 80 ? "#10b981"
                          : passwordStrength >= 50 ? "#f59e0b" : "#ef4444",
                    }}
                  >
                    {passwordStrengthLabel}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${passwordStrength}%`,
                      backgroundColor:
                        passwordStrength >= 80 ? "#10b981"
                          : passwordStrength >= 50 ? "#f59e0b" : "#ef4444",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <Field label={t("auth.confirmPassword")}>
          <InputShell
            icon={<FiLock />}
            trailing={
              <RevealBtn
                shown={showConfirmResetPassword}
                onToggle={() => setShowConfirmResetPassword((v) => !v)}
              />
            }
          >
            <input
              type={showConfirmResetPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("auth.confirmPasswordPh")}
              autoComplete="new-password"
              className={INPUT_CLS}
            />
          </InputShell>
        </Field>

        <button type="submit" disabled={resetSubmitting} className={PRIMARY_BTN}>
          {resetSubmitting ? t("auth.sendingOtp") : t("auth.confirmReset")}
        </button>
      </form>

      <BackToSignIn label={t("auth.signIn")} onClick={goToLogin} />
    </div>
  );

  const view =
    viewMode === "login" ? loginView
      : viewMode === "forgot" ? forgotView
        : viewMode === "reset" ? resetView
          : viewMode === "totp" ? totpView
            : viewMode === "email_otp" ? emailOtpView
              : backupCodeView;

  return (
    <>
      <style>{`
        .auth-page {
          /* Fixed, not var(--accent) — see the note at the top of this file. */
          --auth-brand: #2F6FED;
          --auth-brand-strong: #2559C9;
        }
        .auth-field:focus {
          border-color: var(--auth-brand);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--auth-brand) 16%, transparent);
        }
        .auth-primary { background: var(--auth-brand); }
        .auth-primary:hover:not(:disabled) { background: var(--auth-brand-strong); }
        .auth-primary:active:not(:disabled) { transform: translateY(1px); }
        .auth-link { color: var(--auth-brand); }
        .auth-link:hover { color: var(--auth-brand-strong); }
        .auth-check-on { background: var(--auth-brand); border-color: var(--auth-brand); }
        .auth-tile {
          background: color-mix(in srgb, var(--auth-brand) 10%, white);
          color: var(--auth-brand);
        }
        .dark .auth-tile {
          background: color-mix(in srgb, var(--auth-brand) 22%, transparent);
          color: color-mix(in srgb, var(--auth-brand) 45%, white);
        }
        .dark .auth-link { color: color-mix(in srgb, var(--auth-brand) 45%, white); }
        @keyframes authRise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: none; }
        }

        /* ── Illustration motion ───────────────────────────────────────────
           The scene is a standoff, so it should not be frozen: the threats drift, the firewall's
           badge breathes, and the dashed runs travel in the direction of the traffic they stand
           for. Everything is slow and small — this sits beside a password field, and movement that
           pulls the eye off the form is movement working against the page.

           transform-box:fill-box is required: without it an SVG child transforms about the
           viewport origin, not its own centre, and a 9px drift throws the shape across the canvas. */
        .hero-float, .hero-float-2, .hero-float-3, .hero-pulse {
          transform-box: fill-box;
          transform-origin: center;
        }
        @keyframes heroFloat    { 0%, 100% { transform: translateY(0); }  50% { transform: translateY(-9px); } }
        @keyframes heroFloatAlt { 0%, 100% { transform: translateY(0); }  50% { transform: translateY(6px); } }
        @keyframes heroPulse    { 0%, 100% { opacity: .12; transform: scale(1); } 50% { opacity: .3; transform: scale(1.08); } }
        @keyframes heroFlow     { to { stroke-dashoffset: -32; } }
        .hero-float   { animation: heroFloat 4.4s ease-in-out infinite; }
        .hero-float-2 { animation: heroFloatAlt 5.6s ease-in-out infinite .5s; }
        .hero-float-3 { animation: heroFloat 3.8s ease-in-out infinite 1.1s; }
        .hero-pulse   { animation: heroPulse 3s ease-in-out infinite; }
        .hero-flow    { stroke-dasharray: 7 11; animation: heroFlow 1.8s linear infinite; }

        /* Someone who has asked the OS to stop animations gets the scene, held still. */
        @media (prefers-reduced-motion: reduce) {
          .hero-float, .hero-float-2, .hero-float-3, .hero-pulse, .hero-flow { animation: none; }
        }
      `}</style>

      <div className="auth-page relative min-h-dvh w-full overflow-x-hidden bg-white dark:bg-[#0A0F1C]">
        {/* The wash behind the illustration. Two very wide, very faint radials — enough to keep the
            right half from reading as bare paper, far too soft to compete with the headline. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0
                     bg-[radial-gradient(1100px_620px_at_78%_18%,rgba(99,102,241,0.07),transparent_62%),radial-gradient(900px_520px_at_92%_86%,rgba(45,212,191,0.07),transparent_60%)]
                     dark:bg-[radial-gradient(1100px_620px_at_78%_18%,rgba(99,102,241,0.16),transparent_62%),radial-gradient(900px_520px_at_92%_86%,rgba(45,212,191,0.10),transparent_60%)]"
        />

        <div
          className="relative mx-auto grid min-h-dvh w-full max-w-360 items-center gap-10
                     px-6 py-10 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-16 lg:px-14 xl:gap-24"
        >
          {/* ── Left: identity + form ─────────────────────────────────────── */}
          <div
            className="mx-auto w-full max-w-85"
            style={{ animation: "authRise 520ms cubic-bezier(0.22,1,0.36,1)" }}
          >
            {/* Identity block. The tagline is not decoration: below `lg` the whole right-hand panel
                is hidden, so on a phone this line is the ONLY thing on screen that says what you
                are signing in to. It says something the headline does not, rather than repeating
                it — the headline is the pitch, this is the label on the door. */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-3">
                <img src={firewallLogo} alt="" aria-hidden className="h-9 w-9 object-contain" />
                <span className="text-[22px] font-extrabold tracking-tight text-slate-900 dark:text-white">
                  Firewall Automation
                </span>
              </div>
              {/* text-balance so the two lines split evenly instead of leaving "one console."
                  stranded on its own — an orphan under a wordmark reads as a mistake. */}
              <p className="m-0 mt-2 text-balance text-[12.5px] leading-5 text-slate-500 dark:text-white/50">
                {t("auth.brandTagline")}
              </p>
            </div>

            {/* Keyed on the view so switching to the code step animates in rather than swapping
                under the cursor — the same movement the card itself makes on first paint. */}
            <div key={viewMode} style={{ animation: "authRise 380ms cubic-bezier(0.22,1,0.36,1)" }}>
              {view}
            </div>

            <p className="mt-10 flex items-center justify-center gap-1.5 text-[11.5px] text-slate-400 dark:text-white/35">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[8px] font-bold">
                C
              </span>
              {t("auth.copyright", { year: new Date().getFullYear() })}
            </p>
          </div>

          {/* ── Right: what this console is for ───────────────────────────── */}
          {/* Hidden below lg: on a phone the form is the whole screen, and a headline pushed above
              it would put the reason for the page ahead of the way into it. */}
          <div className="hidden lg:flex lg:flex-col lg:items-center lg:justify-center">
            {/* max-width + balance, not <br>: the headline has to land on three lines the way the
                design draws it, and hard breaks would put them in the wrong places the moment the
                copy is translated or the panel is narrower than it is here. */}
            <h1 className="m-0 max-w-150 text-center text-[34px] font-extrabold leading-[1.24] tracking-tight text-balance text-[#0F1B33] dark:text-white xl:text-[42px]">
              {t("auth.heroTitle")}{" "}
              <span className="auth-link">{t("auth.heroBrand")}</span>
            </h1>

            {/* max-h as well as max-w. The width cap is the design size; the height cap is what
                stops a 1366×768 laptop — where the viewport is barely 660px after browser chrome —
                from being pushed into a scrollbar by the illustration alone. preserveAspectRatio
                keeps the drawing proportional inside whichever cap binds first. */}
            <HeroArt className="mt-3 max-h-[46vh] w-full max-w-165 text-slate-900 dark:text-white" />
          </div>
        </div>
      </div>

      <OtpModal
        open={openResetOTPModal}
        onClose={() => setOpenResetOTPModal(false)}
        email={verifiedResetEmail}
        newPassword={newPassword}
        onVerified={handleResetVerified}
      />
    </>
  );
};

export default Index;
