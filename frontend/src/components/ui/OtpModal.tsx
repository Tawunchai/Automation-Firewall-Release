import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { FiAlertCircle, FiClock, FiRefreshCw, FiX } from "react-icons/fi";
import { message } from "./toast";
import { SendOTP, VerifyOTPAddUpdatePassword } from "../../api";
import OtpArt from "./OtpArt";
import {
  OTP_LENGTH, OTP_TTL_SECONDS, RESEND_COOLDOWN_SECONDS,
  canResend, emptyOtp, expiryState, formatCountdown, isComplete,
  pasteCode, pressBackspace, shouldAutoSubmit, typeDigit, type OtpDigits,
} from "../../lib/otpFlow";

// The email-OTP dialog on the sign-in screen.
//
// ── ทรง ──────────────────────────────────────────────────────────────────────
// การ์ดกลางจอเรียงลงมาทางเดียว: ภาพประกอบ → หัวข้อ → คำอธิบายหนึ่งบรรทัด →
// บล็อกกรอกรหัส → นาฬิกา → ลิงก์ส่งใหม่ → ปุ่มยืนยันเต็มความกว้าง
//
// ช่องกรอกเป็น **บล็อกแยกหนึ่งช่องต่อหนึ่งหลัก** ตามดีไซน์ที่ขอมา — ข้อดีจริงของมันคือ
// ผู้ใช้เห็นทันทีว่ากรอกไปกี่หลักแล้วโดยไม่ต้องนับ ซึ่งสำคัญกับรหัสที่อ่านมาจากอีเมล
// ทีละตัว ส่วน paste ทั้งก้อนยังทำงานได้เหมือนช่องเดียว (ดู pasteCode) และ autofill
// ของเบราว์เซอร์เกาะที่ช่องแรกช่องเดียวก็พอ
//
// ── สี ───────────────────────────────────────────────────────────────────────
// ใช้ `--auth-brand` (น้ำเงินคงที่ของหน้า login) **ไม่ใช่** `currentColor` จาก ProviderContext
//
// ของเดิมใช้ currentColor ซึ่งเป็น "สีที่ผู้ใช้แต่ละคนเลือกไว้ในคอนโซล" — แต่หน้านี้คือหน้า
// ก่อนล็อกอิน ยังไม่มีผู้ใช้ กล่องจึงถูกทาด้วยสีของ **คนล่าสุดที่เคยใช้เบราว์เซอร์เครื่องนี้**
// เหตุผลเดียวกับที่หน้า authentication เขียนกำกับตัวเองไว้:
// "A front door should look the same to everyone who arrives at it."

type OtpModalProps = {
  open: boolean;
  email: string;
  newPassword: string;
  onClose: () => void;
  onVerified: () => void;
};

const OtpModal: React.FC<OtpModalProps> = ({ open, email, newPassword, onClose, onVerified }) => {
  const { t } = useTranslation();

  const [otp, setOtp]               = useState<OtpDigits>(emptyOtp());
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending]   = useState(false);
  const [error, setError]           = useState("");
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [ttlLeft, setTtlLeft]       = useState(OTP_TTL_SECONDS);
  const [cooldown, setCooldown]     = useState(RESEND_COOLDOWN_SECONDS);

  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const focusBox  = (i: number) => inputRefs.current[i]?.focus();
  const code      = otp.join("");
  // กันยิงซ้ำตอน auto-submit: ครบ 6 หลัก → ส่งเอง แต่ต้องส่งครั้งเดียวต่อโค้ดหนึ่งชุด
  const submittedRef = useRef("");

  const expiry  = expiryState(ttlLeft);
  const expired = expiry === "expired";

  /** เริ่มนับใหม่ทั้งสองนาฬิกา — ใช้ทั้งตอนเปิดกล่องและตอนขอโค้ดใหม่ */
  const startClocks = useCallback(() => {
    setTtlLeft(OTP_TTL_SECONDS);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }, []);

  useEffect(() => {
    if (!open) return;
    setOtp(emptyOtp());
    setError("");
    setSubmitting(false);
    setResending(false);
    setFocusedIdx(-1);
    submittedRef.current = "";
    startClocks();
    const id = setTimeout(() => focusBox(0), 80);
    return () => clearTimeout(id);
  }, [open, startClocks]);

  // นาฬิกาเดียวเดินทั้งสองตัวนับ — ตั้ง interval สองอันให้ทำงานเรื่องเดียวกันไม่มีประโยชน์
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      setTtlLeft((s) => (s > 0 ? s - 1 : 0));
      setCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [open]);

  // Escape ปิดกล่อง — dialog ที่ปิดได้ทางเดียวคือคลิกฉากหลัง ใช้ด้วยคีย์บอร์ดไม่ได้
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  const verify = useCallback(async (value: string) => {
    setError("");
    if (value.length !== OTP_LENGTH) { setError(t("otpModal.incomplete", { total: OTP_LENGTH })); return; }
    if (!newPassword.trim()) { setError(t("otpModal.noPassword")); return; }
    try {
      setSubmitting(true);
      const res = await VerifyOTPAddUpdatePassword({ email, otp: value, new_password: newPassword });
      if (!res)      { setError(t("otpModal.failed")); return; }
      if (res.error) { setError(res.error); return; }
      message.success(res.message || t("otpModal.title"));
      onVerified();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error || e?.message || t("otpModal.failed"));
    } finally {
      setSubmitting(false);
      // ❗ห้ามเคลียร์ submittedRef ตรงนี้ — ตัวเลขในช่องยังเป็นชุดเดิม เงื่อนไข auto-submit
      // จะกลับมาเป็นจริงทันทีที่ setSubmitting(false) แล้วยิงซ้ำวนไม่จบ = ใช้โควตา
      // OTPMaxAttempts (5 ครั้ง) หมดในพริบตาจากการพิมพ์ผิดแค่ครั้งเดียว
      // มันถูกเคลียร์ตอนผู้ใช้แก้ตัวเลขเท่านั้น (ดู handleChange)
    }
  }, [email, newPassword, onVerified, t]);

  // ครบ 6 หลักแล้วส่งเลย — ไม่ต้องเอื้อมไปกดปุ่ม (โค้ด OTP ไม่มีอะไรให้ทบทวนก่อนส่ง)
  useEffect(() => {
    if (!open) return;
    if (!shouldAutoSubmit(otp, submittedRef.current, { submitting, expired })) return;
    submittedRef.current = code;
    void verify(code);
  }, [otp, code, open, submitting, expired, verify]);

  /** ทุกทางที่ตัวเลขเปลี่ยนผ่านตรงนี้ — ตำแหน่งเดียวที่รู้ว่าต้องย้ายโฟกัสไปไหน */
  const applyInput = (r: { next: OtpDigits; focus: number }) => {
    // ผู้ใช้แก้ตัวเลข = โค้ดชุดใหม่ ให้ auto-submit ทำงานได้อีกครั้ง
    submittedRef.current = "";
    setError("");
    setOtp(r.next);
    if (r.focus !== focusedIdx) focusBox(r.focus);
  };

  const handleResend = async () => {
    if (!canResend(cooldown, resending)) return;
    setError("");
    try {
      setResending(true);
      const res = await SendOTP({ email });
      if (!res)      { setError(t("otpModal.resendFailed")); return; }
      if (res.error) { setError(res.error); return; }
      message.success(res.message || t("otpModal.resent"));
      setOtp(emptyOtp());
      submittedRef.current = "";
      startClocks();
      setTimeout(() => focusBox(0), 80);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error || e?.message || t("otpModal.resendFailed"));
    } finally { setResending(false); }
  };

  if (!open) return null;

  return createPortal(
    <div className="auth-page fixed inset-0 z-9999 flex items-center justify-center overflow-y-auto p-4">
      <style>{`
        /* โทเคนสีตัวเดียวกับหน้า login (--auth-brand ประกาศไว้ที่ .auth-page)
           กล่องนี้ห่อตัวเองด้วย .auth-page ด้วย เพราะถูก portal ไปไว้ที่ document.body
           ซึ่งอยู่นอกต้นไม้ของหน้านั้นแล้ว ตัวแปรจึงไม่ถูกสืบทอดลงมา */
        .auth-page { --auth-brand: #2F6FED; --auth-brand-strong: #2559C9; }

        /* บล็อกกรอกรหัส — สี่สถานะ: ว่าง / มีเลข / โฟกัส / ผิด
           ว่างเป็นขอบเทาบาง ๆ ตามดีไซน์ ไม่ใช่ขอบสีแบรนด์ เพราะหกช่องที่ขอบน้ำเงินหมด
           จะแย่งสายตากับปุ่ม VERIFY ซึ่งเป็นสิ่งเดียวที่ควรเด่นที่สุดในการ์ด */
        .otp-box {
          border-color: #E3E8F0; background: #fff; color: #0F172A;
          transition: border-color .15s, box-shadow .15s, background-color .15s;
        }
        .otp-box:hover:not(:disabled):not(:focus) { border-color: #CBD5E1; }
        .otp-box[data-filled="true"] {
          border-color: color-mix(in srgb, var(--auth-brand) 40%, #E3E8F0);
          background: color-mix(in srgb, var(--auth-brand) 5%, #fff);
          color: var(--auth-brand);
        }
        .otp-box:focus {
          border-color: var(--auth-brand);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--auth-brand) 16%, transparent);
        }
        .otp-box[data-invalid="true"]:not(:focus) { border-color: #F87171; background: #FEF2F2; color: #B91C1C; }
        .otp-box:disabled { background: #F8FAFC; color: #94A3B8; }

        .dark .otp-box { border-color: rgba(255,255,255,.13); background: rgba(255,255,255,.04); color: #fff; }
        .dark .otp-box:hover:not(:disabled):not(:focus) { border-color: rgba(255,255,255,.24); }
        .dark .otp-box[data-filled="true"] {
          border-color: color-mix(in srgb, var(--auth-brand) 55%, transparent);
          background: color-mix(in srgb, var(--auth-brand) 15%, transparent);
          color: color-mix(in srgb, var(--auth-brand) 45%, white);
        }
        .dark .otp-box[data-invalid="true"]:not(:focus) {
          border-color: rgba(248,113,113,.45); background: rgba(248,113,113,.12); color: #FCA5A5;
        }
        .dark .otp-box:disabled { background: rgba(255,255,255,.03); color: rgba(255,255,255,.35); }

        .otp-primary { background: var(--auth-brand); }
        .otp-primary:hover:not(:disabled) { background: var(--auth-brand-strong); }
        .otp-primary:active:not(:disabled) { transform: translateY(1px); }
        .otp-link { color: var(--auth-brand); }
        .otp-link:hover:not(:disabled) { color: var(--auth-brand-strong); }
        .dark .otp-link { color: color-mix(in srgb, var(--auth-brand) 45%, white); }

        @keyframes otpRise { from { opacity: 0; transform: translateY(12px) scale(.985); } to { opacity: 1; transform: none; } }
        .otp-card { animation: otpRise .2s ease-out; }

        /* ผู้ที่ตั้งค่าระบบให้ลดการเคลื่อนไหว ต้องได้กล่องนิ่ง ๆ */
        @media (prefers-reduced-motion: reduce) { .otp-card { animation: none; } }
      `}</style>

      <div
        role="presentation"
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-[3px] dark:bg-black/60"
        onClick={submitting ? undefined : onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="otp-modal-title"
        className="otp-card relative z-10 my-auto w-full max-w-105 rounded-2xl border border-slate-200/70 bg-white px-7 pb-8 pt-6 shadow-[0_28px_80px_-20px_rgba(15,23,42,.32)] dark:border-white/10 dark:bg-[#0F1729] sm:px-10"
      >
        {/* ปุ่มปิด — ดีไซน์ต้นแบบเป็นหน้าเต็มจึงไม่มีปุ่มนี้ แต่ของเราเป็น dialog
            ถ้าไม่มีทางออกที่มองเห็นได้ ผู้ใช้จะติดอยู่กับมัน (Esc/คลิกฉากหลังก็ปิดได้) */}
        <button
          type="button" onClick={onClose} disabled={submitting} aria-label={t("common.close")}
          className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500 disabled:opacity-40 dark:text-white/25 dark:hover:bg-white/8 dark:hover:text-white/60"
        >
          <FiX className="text-[16px]" />
        </button>

        {/* ── ภาพประกอบ: กำแพงไฟกับโทรศัพท์ ── */}
        <OtpArt className="mx-auto h-38 w-full max-w-70" />

        {/* ── หัวข้อ ── */}
        <h2
          id="otp-modal-title"
          className="mt-5 text-center text-[24px] font-bold leading-tight tracking-[-0.02em] text-slate-900 dark:text-white"
        >
          {t("otpModal.title")}
        </h2>
        <p className="mt-2 text-center text-[13.5px] leading-relaxed text-slate-500 dark:text-white/50">
          {t("otpModal.subtitle")}
        </p>

        {/* ── บล็อกกรอกรหัส ──
            ช่องยืดหดได้ (flex-1 + max-w) แทนความกว้างตายตัว — หกช่องกว้างช่องละ 48px
            รวมช่องไฟบวกกันแล้วกว้างเกินการ์ดบนจอมือถือ แล้วมันจะล้นออกนอกขอบ */}
        <div className="mt-6 flex justify-center gap-2 sm:gap-2.5">
          {otp.map((digit, index) => (
            <input
              key={index}
              ref={(el) => { inputRefs.current[index] = el; }}
              type="text"
              inputMode="numeric"
              // ให้เบราว์เซอร์/มือถือเติมโค้ดจากอีเมลให้เองได้ — ช่องแรกช่องเดียวพอ
              autoComplete={index === 0 ? "one-time-code" : "off"}
              maxLength={1}
              value={digit}
              disabled={submitting || expired}
              data-filled={digit ? "true" : "false"}
              data-invalid={error ? "true" : "false"}
              aria-label={t("otpModal.inputLabel", { n: index + 1, total: OTP_LENGTH })}
              aria-invalid={!!error}
              aria-describedby="otp-clock"
              onChange={(e) => applyInput(typeDigit(otp, index, e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Backspace")   { e.preventDefault(); applyInput(pressBackspace(otp, index)); }
                if (e.key === "ArrowLeft"  && index > 0)              focusBox(index - 1);
                if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) focusBox(index + 1);
                if (e.key === "Enter" && isComplete(otp))             void verify(code);
              }}
              onPaste={(e) => { e.preventDefault(); applyInput(pasteCode(otp, index, e.clipboardData.getData("text"))); }}
              onFocus={(e) => { setFocusedIdx(index); e.target.select(); }}
              onBlur={() => setFocusedIdx(-1)}
              className="otp-box h-14 min-w-0 flex-1 rounded-xl border text-center text-[22px] font-semibold tabular-nums outline-none sm:max-w-13"
            />
          ))}
        </div>

        {/* ── นาฬิกาอายุโค้ด ── */}
        <p
          id="otp-clock"
          className={[
            "m-0 mt-2.5 flex items-center justify-center gap-1.5 text-[11.5px] font-medium",
            expiry === "fresh"     ? "text-slate-400 dark:text-white/35"
              : expiry === "warning" ? "text-amber-600 dark:text-amber-400"
              :                        "text-red-600 dark:text-red-400",
          ].join(" ")}
        >
          <FiClock className="shrink-0 text-[11px]" />
          {expired
            ? t("otpModal.expired")
            : expiry === "warning"
              ? t("otpModal.expiringSoon", { time: formatCountdown(ttlLeft) })
              : t("otpModal.expiresIn",    { time: formatCountdown(ttlLeft) })}
        </p>

        {/* ── ข้อผิดพลาด ── */}
        {error && (
          <div
            role="alert" aria-live="polite"
            className="mt-3 flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"
          >
            <FiAlertCircle className="mt-px shrink-0 text-[13px]" />
            <span>{error}</span>
          </div>
        )}

        {/* ── ส่งใหม่ ── */}
        <p className="mt-3.5 text-center text-[13px] text-slate-500 dark:text-white/45">
          {t("otpModal.noCode")}{" "}
          <button
            type="button" onClick={handleResend} disabled={!canResend(cooldown, resending)}
            className="otp-link inline-flex items-center gap-1 font-semibold underline underline-offset-2 transition disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline dark:disabled:text-white/30"
          >
            {resending && <FiRefreshCw className="animate-spin text-[11px]" />}
            {resending
              ? t("otpModal.sending")
              : cooldown > 0
                ? t("otpModal.resendIn", { seconds: cooldown })
                : t("otpModal.resend")}
          </button>
        </p>

        {/* ── ปุ่มยืนยัน ── */}
        <button
          type="button" onClick={() => void verify(code)}
          disabled={submitting || expired || code.length !== OTP_LENGTH}
          className="otp-primary mt-6 inline-flex h-13 w-full items-center justify-center gap-2 rounded-[10px] text-[14px] font-bold uppercase tracking-[0.06em] text-white transition disabled:cursor-not-allowed disabled:opacity-45"
        >
          {submitting
            ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />{t("otpModal.verifying")}</>
            : t("otpModal.verify")}
        </button>

        <p className="mt-3 text-center text-[11px] text-slate-300 dark:text-white/25">
          {t("otpModal.checkSpam")}
        </p>
      </div>
    </div>,
    document.body
  );
};

export default OtpModal;
