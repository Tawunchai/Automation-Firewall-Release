import React, { useEffect, useMemo, useRef, useState } from "react";
import { message } from "../../../components/ui/toast";
import Modal from "../../../components/ui/Modal";
import {
  FiEdit2,
  FiUploadCloud,
  FiX,
  FiShield,
  FiCheckCircle,
  FiRefreshCw,
  FiAlertTriangle,
  FiCamera,
} from "react-icons/fi";
import { MdVerified } from "react-icons/md";
import { useTranslation } from "react-i18next";
import type { UserResponse } from "../../../api/user";
import { UploadProfileImage, UpdateUserByID } from "../../../api/user";
import { useStateContext } from "../../../contexts/ProviderContext.logic";
import {
  GetTOTPStatus,
  InitTOTPSetup,
  VerifyTOTPSetup,
  ToggleTOTPEnabled,
  DisableTOTP,
} from "../../../api/totp";
import { cancelTarget, initialTotpStep, totpBadge, type TotpStep } from "./totpFlow";
import { activateOnKey } from "../../../components/ui/keyActivate";
import { apiErrorDetail } from "../../../api/errorText";

const HERO_AVATAR_SIZE = 92;
const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_MB = 5;

const createCoverThumbnail = async (imageSrc: string, size: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.decoding   = "async";
    img.onload = () => {
      try {
        const dpr      = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        const canvas   = document.createElement("canvas");
        const ts       = Math.round(size * dpr);
        canvas.width   = ts;
        canvas.height  = ts;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas context not available")); return; }
        ctx.clearRect(0, 0, ts, ts);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        const sw = img.naturalWidth, sh = img.naturalHeight;
        const scale = Math.max(ts / sw, ts / sh);
        ctx.drawImage(img, (ts - sw * scale) / 2, (ts - sh * scale) / 2, sw * scale, sh * scale);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imageSrc;
  });
};

type ProfileHeroProps = {
  user: UserResponse;
  onUpdated?: () => void;
};

/**
 * Button tones for the hero's action row.
 *
 * The hero is now a WHITE card (the user asked for a light banner with a network-diagram
 * watermark), so these are drawn for a light surface: a bordered white chip for neutral, and a
 * soft tint of the semantic hue for the two that carry state.
 */
const HERO_BTN =
  "flex h-8.5 items-center gap-2 rounded-[4px] border px-3 text-[12px] font-semibold " +
  "transition-colors";
const TONE = {
  neutral: "border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 dark:border-white/15 dark:bg-white/8 dark:text-white/85 dark:shadow-none dark:hover:bg-white/14",
  ok:      "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-400/30 dark:bg-emerald-400/12 dark:text-emerald-300 dark:hover:bg-emerald-400/20",
  warn:    "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-400/12 dark:text-amber-300 dark:hover:bg-amber-400/20",
  off:     "border-amber-200 bg-amber-50/60 text-amber-500 cursor-not-allowed dark:border-amber-400/20 dark:bg-amber-400/8 dark:text-amber-300/60",
};

/**
 * The hero's background: a network-diagram motif in the user's accent, built in two layers so the
 * card has texture without crowding the text.
 *
 * A single dot-grid in the user's accent, spread across the whole card and faded gently toward the
 * left so the name, email and pills always sit on clean paper. Deliberately very light — texture,
 * not pattern. Purely decorative: aria-hidden, no pointer events, hidden on narrow screens.
 */
const NetworkDecor: React.FC<{ accent: string }> = ({ accent }) => (
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0 hidden sm:block"
    style={{
      color: accent,
      maskImage: "linear-gradient(to right, transparent, #000 32%, #000)",
      WebkitMaskImage: "linear-gradient(to right, transparent, #000 32%, #000)",
    }}
  >
    <svg className="h-full w-full" aria-hidden>
      <defs>
        <pattern id="heroDotGrid" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.5" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#heroDotGrid)" opacity={0.08} />
    </svg>
  </div>
);

const ProfileHero: React.FC<ProfileHeroProps> = ({ user, onUpdated }) => {
  const { t }                                = useTranslation();
  const { triggerUserRefresh, currentColor } = useStateContext();
  const fileInputRef                         = useRef<HTMLInputElement>(null);
  const isMountedRef                         = useRef(true);

  /* ── avatar preview ── */
  const [previewOpen,  setPreviewOpen]  = useState(false);
  const [avatarThumb,  setAvatarThumb]  = useState("");
  const [thumbLoading, setThumbLoading] = useState(false);
  const [avatarError,  setAvatarError]  = useState(false);

  /* ── upload modal ── */
  const [uploadOpen,  setUploadOpen]  = useState(false);
  const [dragOver,    setDragOver]    = useState(false);
  const [pickedFile,  setPickedFile]  = useState<File | null>(null);
  const [pickedUrl,   setPickedUrl]   = useState<string>("");
  const [uploading,   setUploading]   = useState(false);

  /* ── TOTP modal ── */
  const [totpOpen,          setTotpOpen]          = useState(false);
  const [totpVerified,      setTotpVerified]      = useState(false);
  const [totpIsEnabled,     setTotpIsEnabled]     = useState(false);
  const [totpGlobalEnabled, setTotpGlobalEnabled] = useState(false);
  const [totpStep,          setTotpStep]          = useState<TotpStep>("idle");
  const [totpQr,            setTotpQr]            = useState<string | null>(null);
  const [totpCode,          setTotpCode]          = useState("");
  const [totpSubmitting,    setTotpSubmitting]    = useState(false);
  const [totpError,         setTotpError]         = useState("");

  const fullName   = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "Unknown User";
  const profileSrc = useMemo(() => (user && !avatarError ? user.profile?.trim() || "" : ""), [user, avatarError]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  /* ── fetch TOTP status on mount ── */
  useEffect(() => {
    GetTOTPStatus().then((s) => {
      if (!isMountedRef.current) return;
      setTotpVerified(s.is_verified);
      setTotpIsEnabled(s.is_enabled);
      setTotpGlobalEnabled(s.global_enabled);
    });
  }, []);

  /* ── build thumbnail ── */
  useEffect(() => {
    let cancelled = false;
    const build = async () => {
      if (!profileSrc) { setAvatarThumb(""); return; }
      if (profileSrc.startsWith("data:image/svg+xml")) { setAvatarThumb(profileSrc); return; }
      try {
        setThumbLoading(true);
        const url = await createCoverThumbnail(profileSrc, HERO_AVATAR_SIZE);
        if (!cancelled) setAvatarThumb(url);
      } catch {
        if (!cancelled) setAvatarThumb(profileSrc);
      } finally {
        if (!cancelled) setThumbLoading(false);
      }
    };
    void build();
    return () => { cancelled = true; };
  }, [profileSrc]);

  useEffect(() => () => { if (pickedUrl) URL.revokeObjectURL(pickedUrl); }, [pickedUrl]);

  /* ── file handling ── */
  const applyFile = (file: File) => {
    if (!file.type.startsWith("image/")) { message.error("Please select an image file."); return; }
    if (file.size > MAX_MB * 1024 * 1024) { message.error(`File must be smaller than ${MAX_MB} MB.`); return; }
    if (pickedUrl) URL.revokeObjectURL(pickedUrl);
    setPickedFile(file);
    setPickedUrl(URL.createObjectURL(file));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) applyFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) applyFile(file);
  };

  const openUpload = () => { setPickedFile(null); setPickedUrl(""); setUploadOpen(true); };
  const closeUpload = () => {
    if (uploading) return;
    setUploadOpen(false);
    setPickedFile(null);
    if (pickedUrl) { URL.revokeObjectURL(pickedUrl); setPickedUrl(""); }
  };

  const handleSave = async () => {
    if (!pickedFile || !user?.id) return;
    setUploading(true);
    try {
      const uploadedUrl = await UploadProfileImage(pickedFile);
      if (!uploadedUrl) { message.error("Upload failed. Please try again."); return; }
      const updated = await UpdateUserByID(user.id, { profile: uploadedUrl });
      if (!updated) { message.error("Failed to save profile photo."); return; }
      message.success("Profile photo updated!");
      setAvatarError(false);
      closeUpload();
      triggerUserRefresh();
      onUpdated?.();
    } catch {
      message.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  /* ── TOTP handlers ── */

  // เปิด dialog แล้วเข้าหน้าตั้งค่าเลยสำหรับคนที่ยังไม่เคยตั้ง — ไม่ต้องกด
  // "Set Up Authenticator App" ซ้ำอีกรอบ เพราะเขากดปุ่ม Set Up TOTP มาแล้ว
  // (คนที่ตั้งไว้แล้วยังเข้า "idle" เพราะหน้านั้นคือเมนู enable/disable/remove
  //  ซึ่งเป็นทางเลือกจริง ไม่ใช่ปุ่มผ่านทาง)
  const openTotpModal = async () => {
    setTotpQr(null);
    setTotpCode("");
    setTotpError("");
    setTotpOpen(true);

    // อ่านสถานะจริงจาก server ก่อนตัดสินใจว่าจะเปิดหน้าไหน — ค่าที่หน้านี้ถืออยู่ถูกโหลด
    // ตอนเข้าหน้า และอาจเก่าไปแล้ว (เปลี่ยนที่แท็บอื่น / admin ปิด TOTP ทั้งระบบไปแล้ว)
    // เมนู enable/disable ตัดสินใจจากค่านี้ ถ้ามันผิด ปุ่มจะไปทำสิ่งที่ตรงข้ามกับที่เขียนไว้
    const status = await GetTOTPStatus();
    if (!isMountedRef.current) return;
    setTotpVerified(status.is_verified);
    setTotpIsEnabled(status.is_enabled);
    setTotpGlobalEnabled(status.global_enabled);

    const step = initialTotpStep(status.is_verified, status.global_enabled);
    setTotpStep(step);
    if (step === "scanning") void fetchTotpQr();
  };

  const closeTotpModal = () => {
    if (totpSubmitting) return;
    setTotpOpen(false);
    setTotpStep("idle");
    setTotpQr(null);
    setTotpCode("");
    setTotpError("");
  };

  // ดึง QR อย่างเดียว — ไม่แตะ step เพราะผู้เรียกเป็นคนตั้งไว้แล้ว
  // ถ้าดึงไม่ได้ ให้ค้างอยู่หน้าเดิมพร้อมข้อความ ไม่เด้งกลับไปหน้า "Not Set Up"
  // ซึ่งเป็นหน้าที่ผู้ใช้ตั้งใจข้ามมาตั้งแต่แรก
  const fetchTotpQr = async () => {
    const res = await InitTOTPSetup();
    if (!isMountedRef.current) return;
    if (!res) { setTotpError(t("totp.qrFailed")); return; }
    setTotpQr(res.qr_image);
  };

  const startTotpSetup = async () => {
    setTotpError("");
    setTotpStep("scanning");
    setTotpQr(null);
    await fetchTotpQr();
  };

  const handleTotpVerify = async () => {
    if (totpCode.length !== 6) { setTotpError(t("totp.codeLength")); return; }
    setTotpError("");
    try {
      setTotpSubmitting(true);
      const res = await VerifyTOTPSetup(totpCode);
      if (!isMountedRef.current) return;
      // ต้องตั้ง **ทั้งสองค่า** ตามที่ server ตอบกลับ
      //
      // ของเดิมตั้งแค่ totpVerified แล้วปล่อย totpIsEnabled ค้างเป็น false (ค่าที่โหลดมาตอน
      // เข้าหน้า ตอนที่ยังไม่ได้ตั้ง TOTP) หน้าจอจึงขึ้น "TOTP Disabled" ทันทีที่ตั้งค่าสำเร็จ
      // แล้วผู้ใช้ก็กด "Enable TOTP" ตามที่เห็น ซึ่งไปสลับค่าจริงใน DB จาก true เป็น false
      // → TOTP ถูกปิดจริง และ login ก็เลิกถาม TOTP (อาการที่เจอ)
      setTotpVerified(res.is_verified);
      setTotpIsEnabled(res.is_enabled);
      setTotpStep("idle");
      setTotpQr(null);
      setTotpCode("");
      message.success(t("totp.enabledSuccess"));
    } catch (err) {
      if (!isMountedRef.current) return;
      setTotpError(apiErrorDetail(err, t("totp.invalidCode")));
    } finally {
      if (isMountedRef.current) setTotpSubmitting(false);
    }
  };

  // `enabled` = สิ่งที่ปุ่มเขียนไว้ ไม่ใช่ "ตรงข้ามกับค่าที่หน้าจอคิดว่าเป็นอยู่"
  const handleTotpSetEnabled = async (enabled: boolean) => {
    setTotpError("");
    try {
      setTotpSubmitting(true);
      const res = await ToggleTOTPEnabled(enabled);
      if (!isMountedRef.current) return;
      setTotpIsEnabled(res.is_enabled);
      setTotpStep("idle");
      message.success(res.is_enabled ? t("totp.enabledSuccess") : t("totp.disabledSuccess"));
    } catch (err) {
      if (!isMountedRef.current) return;
      setTotpError(apiErrorDetail(err, t("totp.disableError")));
    } finally {
      if (isMountedRef.current) setTotpSubmitting(false);
    }
  };

  const handleTotpRemove = async () => {
    setTotpError("");
    try {
      setTotpSubmitting(true);
      await DisableTOTP();
      if (!isMountedRef.current) return;
      setTotpVerified(false);
      setTotpIsEnabled(false);
      setTotpStep("idle");
      message.success(t("totp.disabledSuccess"));
      closeTotpModal();
    } catch (err) {
      if (!isMountedRef.current) return;
      setTotpError(apiErrorDetail(err, t("totp.disableError")));
    } finally {
      if (isMountedRef.current) setTotpSubmitting(false);
    }
  };

  const modalPreviewSrc = pickedUrl || profileSrc;

  /* ── The TOTP control, as data ──────────────────────────────────────────────
     Four states, one button. They used to be four JSX branches written out twice — once for the
     desktop action row and once for a mobile one — which is eight places to keep a security
     control's wording and colour in step, and they had already drifted (only the desktop copy
     carried the "why" tooltip). */
  // สถานะมาจาก totpBadge() ตัวเดียว (เทสไว้แล้วใน totpFlow.test.ts) แทนที่จะไล่ ternary
  // ซ้อนกันสี่ชั้นตรงนี้ — เงื่อนไขเดียวกันนี้ต้องตรงกับที่ auth.Login ใช้ตัดสินว่าจะถาม TOTP ไหม
  const TOTP_BADGE = {
    unavailable: { label: t("totp.globalDisabledBtn"), icon: <FiAlertTriangle />, tone: TONE.off,     disabled: true,  title: t("totp.globalDisabledTitle") },
    active:      { label: t("totp.activeBadge"),       icon: <FiCheckCircle />,   tone: TONE.ok,      disabled: false, title: t("totp.configuredDesc") },
    paused:      { label: t("totp.disabledBadge"),     icon: <FiAlertTriangle />, tone: TONE.warn,    disabled: false, title: t("totp.enableTOTPDesc") },
    setup:       { label: t("totp.setupShort"),        icon: <FiShield />,        tone: TONE.neutral, disabled: false, title: t("totp.notConfiguredDesc") },
  } as const;

  const totpAction = TOTP_BADGE[totpBadge(totpVerified, totpIsEnabled, totpGlobalEnabled)];

  const roleLabel = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "—";

  return (
    <>
      {/* ════════════════════ HERO ════════════════════
          A card carrying a faint accent dot-grid — light in day mode, a dark panel under dark mode,
          so it belongs to whichever theme is on rather than staying a bright white slab at night. */}
      <section className="relative overflow-hidden rounded-[4px] border border-slate-200/70 bg-gradient-to-br from-white to-slate-50 dark:border-white/10 dark:from-[#141b29] dark:to-[#0f1521]">
        <NetworkDecor accent={currentColor} />
        <div className="relative flex flex-col items-center gap-4 p-5 text-center sm:flex-row sm:gap-5 sm:text-left">

          {/* ── Avatar ── */}
          <div className="relative shrink-0">
            <div className="h-23 w-23 overflow-hidden rounded-full bg-slate-100 ring-4 ring-slate-100 shadow-sm dark:bg-white/10 dark:ring-white/10 dark:shadow-none">
              {profileSrc ? (
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="block h-full w-full cursor-pointer overflow-hidden rounded-full"
                  aria-label={t("account.viewPhoto")}
                >
                  <img
                    src={avatarThumb || profileSrc}
                    alt={fullName}
                    draggable={false}
                    onError={() => setAvatarError(true)}
                    className={[
                      "block h-full w-full rounded-full object-cover transition-opacity",
                      thumbLoading ? "opacity-80" : "opacity-100",
                    ].join(" ")}
                  />
                </button>
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center text-[32px] font-semibold text-white"
                  style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 55%, #a855f7))` }}
                >
                  {fullName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={openUpload}
              className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 dark:border-white/15 dark:bg-[#1b2332] dark:text-white/80 dark:shadow-none dark:hover:bg-white/10"
              aria-label={t("account.changePhoto")}
            >
              <FiEdit2 className="text-[12px]" />
            </button>
          </div>

          {/* ── Identity ── */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-center gap-1.5 sm:justify-start">
              <h2 className="m-0 truncate text-[19px] font-bold leading-tight tracking-[-0.02em] ink">
                {fullName}
              </h2>
              <MdVerified className="shrink-0 text-[16px] text-emerald-500" />
            </div>
            <p className="mt-1 truncate text-[12.5px] ink-3">
              {user.email?.toLowerCase() || "—"}
            </p>

            {/* Role, and the job title if there is one. Both are identity, which is what this
                block is for — everything else about the account lives in the card below. */}
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
              <span
                className="pill border"
                style={{
                  borderColor: `color-mix(in srgb, ${currentColor} 35%, transparent)`,
                  background: `color-mix(in srgb, ${currentColor} 14%, transparent)`,
                  color: currentColor,
                }}
              >
                <FiShield className="text-[10px]" />
                {roleLabel}
              </span>
              {user.position?.trim() && (
                <span className="pill border border-slate-200 bg-white text-slate-500 dark:border-white/12 dark:bg-white/5 dark:text-white/55">
                  {user.position}
                </span>
              )}
            </div>
          </div>

          {/* ── Actions ── */}
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={openUpload} className={`${HERO_BTN} ${TONE.neutral}`}>
              <FiCamera className="text-[13px]" />
              <span>{t("account.changePhoto")}</span>
            </button>
            <button
              type="button"
              onClick={openTotpModal}
              disabled={totpAction.disabled}
              title={totpAction.title}
              className={`${HERO_BTN} ${totpAction.tone}`}
            >
              {totpAction.icon}
              <span>{totpAction.label}</span>
            </button>
          </div>
        </div>
      </section>

      {/* ── Avatar lightbox ── */}
      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} width="max-w-2xl" bodyClassName="p-0">
        <img src={profileSrc} alt={fullName} className="block h-auto w-full rounded-[4px]" />
      </Modal>

      {/* ════════════════════ TOTP ════════════════════ */}
      <Modal open={totpOpen} onClose={closeTotpModal} width="max-w-sm" bodyClassName="p-0">
        <div>
          {/* A clean white header — a soft accent badge, the title, and the close, in place of the
              app-wide dark modal bar, so this reads as a calm setup sheet rather than an alert. */}
          <div className="relative flex items-center gap-3 overflow-hidden border-b border-slate-100 px-5 py-4 dark:border-white/8">
            <span className="pointer-events-none absolute -right-6 -top-10 h-24 w-24 rounded-full"
              style={{ background: `color-mix(in srgb, ${currentColor} 9%, transparent)` }} />
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px]"
              style={{ color: currentColor, background: `color-mix(in srgb, ${currentColor} 12%, transparent)` }}>
              <FiShield className="text-[16px]" />
            </span>
            <h3 className="relative m-0 min-w-0 flex-1 truncate text-[14px] font-bold ink">{t("totp.title")}</h3>
            <button type="button" onClick={closeTotpModal} aria-label={t("common.cancel")} className="btn-icon relative shrink-0">
              <FiX className="text-[15px]" />
            </button>
          </div>
          <div className="space-y-4 p-5">

          {/* ── Global disabled warning ── */}
          {!totpGlobalEnabled && (
            <div className="banner banner-warn items-start">
              <FiAlertTriangle className="mt-0.5 shrink-0 text-[15px] text-amber-500" />
              <div>
                <p className="m-0 text-[12px] font-semibold ink">{t("totp.globalDisabledTitle")}</p>
                <p className="m-0 mt-0.5 text-[11px] ink-3">{t("totp.globalDisabledDesc")}</p>
              </div>
            </div>
          )}

          {/* ── IDLE: not set up ── */}
          {totpStep === "idle" && !totpVerified && (
            <div className="space-y-3 text-center">
              <span
                className="medallion mx-auto h-12 w-12 text-[22px]"
                style={{ color: currentColor, background: `color-mix(in srgb, ${currentColor} 13%, transparent)` }}
              >
                <FiShield />
              </span>
              <p className="m-0 text-[13px] font-semibold ink">{t("totp.notConfigured")}</p>
              <p className="m-0 text-[12px] ink-3">{t("totp.notConfiguredDesc")}</p>
              <button
                onClick={startTotpSetup}
                disabled={!totpGlobalEnabled}
                className="btn btn-accent w-full"
              >
                {totpGlobalEnabled ? t("totp.setup") : t("totp.globalDisabledBtn")}
              </button>
            </div>
          )}

          {/* ── IDLE: already set up ── */}
          {totpStep === "idle" && totpVerified && (
            <div className="space-y-2.5">
              <div className={`banner items-start ${totpIsEnabled ? "banner-ok" : "banner-warn"}`}>
                {totpIsEnabled
                  ? <FiCheckCircle className="mt-0.5 shrink-0 text-[16px] text-emerald-600 dark:text-emerald-400" />
                  : <FiAlertTriangle className="mt-0.5 shrink-0 text-[16px] text-amber-500" />}
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[13px] font-semibold ink">
                    {totpIsEnabled ? t("totp.configuredTitle") : t("totp.disable")}
                  </p>
                  <p className="m-0 mt-0.5 text-[11px] ink-3">
                    {totpIsEnabled ? t("totp.configuredDesc") : t("totp.enableTOTPDesc")}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {totpIsEnabled ? (
                  <button
                    onClick={() => setTotpStep("disabling")}
                    disabled={!totpGlobalEnabled}
                    title={!totpGlobalEnabled ? t("totp.globalDisabledTitle") : undefined}
                    className="btn btn-ghost btn-sm text-amber-700 dark:text-amber-400"
                  >
                    <FiX className="text-[13px]" />
                    {t("totp.disable")}
                  </button>
                ) : (
                  <button
                    onClick={() => setTotpStep("enabling")}
                    disabled={!totpGlobalEnabled}
                    title={!totpGlobalEnabled ? t("totp.globalDisabledTitle") : undefined}
                    className="btn btn-ghost btn-sm text-emerald-700 dark:text-emerald-400"
                  >
                    <FiShield className="text-[13px]" />
                    {t("totp.enableTOTP")}
                  </button>
                )}

                <button
                  onClick={() => setTotpStep("removing")}
                  disabled={!totpGlobalEnabled}
                  title={!totpGlobalEnabled ? t("totp.globalDisabledTitle") : undefined}
                  className="btn btn-ghost btn-sm text-red-600 dark:text-red-400"
                >
                  <FiX className="text-[13px]" />
                  {t("totp.removeTOTP")}
                </button>
              </div>
            </div>
          )}

          {/* ── DISABLING confirm (soft disable — keeps the secret) ── */}
          {totpStep === "disabling" && (
            <div className="banner banner-warn flex-col items-stretch gap-3">
              <div className="flex items-start gap-2.5">
                <FiAlertTriangle className="mt-0.5 shrink-0 text-[15px] text-amber-500" />
                <div>
                  <p className="m-0 text-[13px] font-semibold ink">{t("totp.disableConfirm")}</p>
                  <p className="m-0 mt-0.5 text-[11px] ink-3">{t("totp.disableWarning")}</p>
                </div>
              </div>
              {totpError && <p className="m-0 text-[12px] text-red-500">{totpError}</p>}
              <div className="flex gap-2">
                <button onClick={() => handleTotpSetEnabled(false)} disabled={totpSubmitting} className="btn btn-sm flex-1 bg-amber-500 text-white hover:brightness-105">
                  {totpSubmitting ? "…" : t("totp.disableConfirmBtn")}
                </button>
                <button onClick={() => { setTotpStep("idle"); setTotpError(""); }} className="btn btn-ghost btn-sm flex-1">
                  {t("totp.disableKeepActive")}
                </button>
              </div>
            </div>
          )}

          {/* ── ENABLING confirm (re-enable a soft-disabled TOTP) ── */}
          {totpStep === "enabling" && (
            <div className="banner banner-ok flex-col items-stretch gap-3">
              <div className="flex items-start gap-2.5">
                <FiShield className="mt-0.5 shrink-0 text-[15px] text-emerald-600" />
                <div>
                  <p className="m-0 text-[13px] font-semibold ink">{t("totp.enableTOTP")}</p>
                  <p className="m-0 mt-0.5 text-[11px] ink-3">{t("totp.enableTOTPDesc")}</p>
                </div>
              </div>
              {totpError && <p className="m-0 text-[12px] text-red-500">{totpError}</p>}
              <div className="flex gap-2">
                <button onClick={() => handleTotpSetEnabled(true)} disabled={totpSubmitting} className="btn btn-sm flex-1 bg-emerald-600 text-white hover:brightness-105">
                  {totpSubmitting ? "…" : t("totp.enableTOTPBtn")}
                </button>
                <button onClick={() => { setTotpStep("idle"); setTotpError(""); }} className="btn btn-ghost btn-sm flex-1">
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}

          {/* ── REMOVING confirm (permanent delete) ── */}
          {totpStep === "removing" && (
            <div className="banner banner-danger flex-col items-stretch gap-3">
              <div className="flex items-start gap-2.5">
                <FiAlertTriangle className="mt-0.5 shrink-0 text-[15px] text-red-500" />
                <div>
                  <p className="m-0 text-[13px] font-semibold ink">{t("totp.removeConfirm")}</p>
                  <p className="m-0 mt-0.5 text-[11px] ink-3">{t("totp.removeWarning")}</p>
                </div>
              </div>
              {totpError && <p className="m-0 text-[12px] text-red-500">{totpError}</p>}
              <div className="flex gap-2">
                <button onClick={handleTotpRemove} disabled={totpSubmitting} className="btn btn-danger btn-sm flex-1">
                  {totpSubmitting ? "…" : t("totp.removeConfirmBtn")}
                </button>
                <button onClick={() => { setTotpStep("idle"); setTotpError(""); }} className="btn btn-ghost btn-sm flex-1">
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}

          {/* ── SCANNING: QR + code entry ── */}
          {totpStep === "scanning" && (
            <div className="space-y-4">
              {/* Step 1: QR */}
              <div>
                <p className="m-0 mb-3 text-[12px] font-semibold ink">{t("totp.step1")}</p>
                <div className="flex justify-center">
                  {totpQr ? (
                    <div className="rounded-[4px] border-4 border-white bg-white p-1.5 shadow-md">
                      <img src={`data:image/png;base64,${totpQr}`} alt="TOTP QR Code" className="h-40 w-40" />
                    </div>
                  ) : totpError ? (
                    // ดึง QR ไม่สำเร็จ — ให้ลองใหม่ตรงนี้ ไม่เด้งกลับไปหน้า "Not Set Up"
                    // ที่ผู้ใช้ตั้งใจข้ามมาแล้ว (กดปุ่มที่นั่นก็วนกลับมาที่เดิม)
                    <button
                      type="button"
                      onClick={() => { setTotpError(""); void fetchTotpQr(); }}
                      className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-[4px] surface-sunken text-[11px] ink-3 transition hover:opacity-80"
                    >
                      <FiRefreshCw className="text-[20px]" />
                      {t("totp.qrRetry")}
                    </button>
                  ) : (
                    <div className="flex h-40 w-40 items-center justify-center rounded-[4px] surface-sunken">
                      <FiRefreshCw className="animate-spin text-[24px] ink-3" />
                    </div>
                  )}
                </div>
                <p className="m-0 mt-2 text-center text-[10px] ink-3">{t("totp.appSuggestion")}</p>
              </div>

              {/* Step 2: Code */}
              <div>
                <p className="m-0 mb-1 text-[12px] font-semibold ink">{t("totp.step2")}</p>
                <p className="m-0 mb-2 text-[11px] ink-3">{t("totp.step2Desc")}</p>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setTotpError(""); }}
                  placeholder="000000"
                  className="shell-input mb-2 text-center font-mono text-[22px] tracking-[0.6em]"
                />
                {totpError && <p className="m-0 mb-2 text-[12px] text-red-500">{totpError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleTotpVerify}
                    disabled={totpSubmitting || totpCode.length !== 6}
                    className="btn btn-accent flex-1"
                  >
                    {totpSubmitting ? "…" : t("totp.verifyEnable")}
                  </button>
                  {/* คนที่ยังไม่เคยตั้ง TOTP ไม่มี "หน้าก่อนหน้า" ให้กลับไปแล้ว — ส่งกลับ
                      "idle" จะไปโผล่หน้า Not Set Up ที่เพิ่งถูกตัดออกจากทางเดิน จึงปิดไปเลย */}
                  <button
                    onClick={() => {
                      if (cancelTarget(totpVerified) === "close") { closeTotpModal(); return; }
                      setTotpStep("idle"); setTotpQr(null); setTotpCode(""); setTotpError("");
                    }}
                    className="btn btn-ghost"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            </div>
          )}
          </div>
        </div>
      </Modal>

      {/* ════════════════════ UPLOAD ════════════════════ */}
      <Modal
        open={uploadOpen}
        onClose={closeUpload}
        width="max-w-sm"
        bodyClassName="p-0"
        footer={
          <>
            <button type="button" onClick={closeUpload} disabled={uploading} className="btn btn-ghost btn-sm">
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!pickedFile || uploading}
              className="btn btn-accent btn-sm"
            >
              {uploading && (
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              )}
              {uploading ? t("account.saving") : t("account.savePhoto")}
            </button>
          </>
        }
      >
        {/* Clean white header with a soft camera badge, matching the TOTP sheet. */}
        <div className="relative flex items-center gap-3 overflow-hidden border-b border-slate-100 px-5 py-4 dark:border-white/8">
          <span className="pointer-events-none absolute -right-6 -top-10 h-24 w-24 rounded-full"
            style={{ background: `color-mix(in srgb, ${currentColor} 9%, transparent)` }} />
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px]"
            style={{ color: currentColor, background: `color-mix(in srgb, ${currentColor} 12%, transparent)` }}>
            <FiCamera className="text-[16px]" />
          </span>
          <h3 className="relative m-0 min-w-0 flex-1 truncate text-[14px] font-bold ink">{t("account.changePhoto")}</h3>
          <button type="button" onClick={closeUpload} aria-label={t("common.cancel")} className="btn-icon relative shrink-0">
            <FiX className="text-[15px]" />
          </button>
        </div>
        <div className="p-5">
        {/* Preview */}
        <div className="flex justify-center">
          <div className="h-20 w-20 overflow-hidden rounded-full ring-4 ring-(--shell-border)">
            {modalPreviewSrc ? (
              <img src={modalPreviewSrc} alt="Preview" className="h-full w-full object-cover transition-all duration-300" />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center text-[30px] font-semibold text-white"
                style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 55%, #a855f7))` }}
              >
                {fullName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        </div>

        <p className="mb-3 mt-3 text-center text-[11.5px] ink-3">JPG, PNG or WEBP · max {MAX_MB} MB</p>

        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={activateOnKey(() => fileInputRef.current?.click())}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={[
            "flex cursor-pointer items-center gap-3 rounded-[4px] border-2 border-dashed px-4 py-4 transition-all",
            dragOver || pickedFile ? "" : "hairline surface-sunken",
          ].join(" ")}
          style={
            dragOver || pickedFile
              ? {
                  borderColor: `color-mix(in srgb, ${currentColor} 55%, transparent)`,
                  background: `color-mix(in srgb, ${currentColor} 7%, transparent)`,
                }
              : undefined
          }
        >
          <span
            className="medallion h-10 w-10 shrink-0 text-[18px]"
            style={
              dragOver || pickedFile
                ? { color: currentColor, background: `color-mix(in srgb, ${currentColor} 14%, transparent)` }
                : undefined
            }
          >
            <FiUploadCloud className={dragOver || pickedFile ? "" : "ink-3"} />
          </span>
          <div className="min-w-0 flex-1">
            {pickedFile ? (
              <>
                <p className="m-0 truncate text-[13px] font-medium" style={{ color: currentColor }}>{pickedFile.name}</p>
                <p className="m-0 text-[11px] ink-3">{t("account.clickToReplace")}</p>
              </>
            ) : (
              <>
                <p className="m-0 text-[13px] font-medium ink">{t("account.dropzoneTitle")}</p>
                <p className="m-0 text-[11px] ink-3">{t("account.dropzoneHint")}</p>
              </>
            )}
          </div>
        </div>

        <input ref={fileInputRef} type="file" accept={ACCEPT} className="hidden" onChange={handleInputChange} />
        </div>
      </Modal>
    </>
  );
};

export default ProfileHero;
