import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  FiCheck, FiChevronDown, FiEdit2, FiHardDrive, FiKey, FiMail,
  FiPlus, FiSave, FiSearch, FiShield, FiUpload, FiUser, FiX,
} from "react-icons/fi";
import { message } from "./toast";
import { ListRoles, UpdateUserIDByAdmin, CreateUser, ListEmailAndPhoneNumber } from "../../api";
import { GetPasswordPolicy, type PasswordPolicy } from "../../api/passwordpolicy";
import {
  GetUserDeviceAccess, SetUserDeviceAccess,
  type DeviceAccessOption, type UserDeviceAccess,
} from "../../api/deviceAccess";
import { DEFAULT_POLICY, firstPolicyViolation, policyRules } from "../../lib/passwordPolicy";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { apiErrorDetail, apiErrorText } from "../../api/errorText";

// Role ที่ admin มอบให้บัญชีใหม่ได้ตอนนี้
//
// ระบบยังมี role "user" อยู่ในฐานข้อมูล (บัญชีเก่าที่เป็น user ยังใช้งานได้ตามปกติ และยัง
// แสดงผลถูกต้องในตาราง) แต่ยังไม่มีหน้าจอไหนที่ผู้ใช้ระดับ user ทำอะไรได้จริง — ทุกหน้าใน
// แอปนี้เป็น admin-only ตั้งแต่ /devices ยัน /policy/* การแจก role "user" จึงเท่ากับสร้าง
// บัญชีที่ล็อกอินได้แต่เปิดอะไรไม่ได้เลย ล็อกไว้ที่ admin ก่อน
// เปิดเพิ่มทีหลัง = เติมชื่อ role ลง list นี้ที่เดียว
const ASSIGNABLE_ROLES = ["admin"];

type UiUser = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  profile: string;
  phone_number: string;
  location: string;
  position: string;
  role: "Admin" | "User" | string;
};

type RoleResponse = { id: number; role: string };
type EmailAndPhoneNumberResponse = { id: number; email: string; phone_number: string };

type UserFormModalProps = {
  open: boolean;
  user: UiUser | null;
  onClose: () => void;
  onUpdated: () => void;
};

type Payload = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  app_role_id: number | "";
};

const EMPTY_FORM: Payload = { email: "", password: "", first_name: "", last_name: "", app_role_id: "" };

const isBase64DataImage = (v: string) =>
  /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,/i.test((v || "").trim());

const isImageFile = (file: File) => file.type.startsWith("image/");

const normalizeEmail = (v: string) => v.trim().toLowerCase();

const UserFormModal: React.FC<UserFormModalProps> = ({
  open, user, onClose, onUpdated,
}) => {
  const { t } = useTranslation();
  const { currentColor } = useStateContext();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const isEditMode = !!user;

  const [formData, setFormData]       = useState<Payload>(EMPTY_FORM);
  const [roles, setRoles]             = useState<RoleResponse[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [profileUrl, setProfileUrl]   = useState("");
  const [error, setError]             = useState("");
  const fetchedRolesRef               = useRef(false);

  const [roleOpen, setRoleOpen]       = useState(false);
  const [roleSearch, setRoleSearch]   = useState("");
  const roleDropdownRef               = useRef<HTMLDivElement | null>(null);

  const [existingEmails, setExistingEmails] = useState<EmailAndPhoneNumberResponse[]>([]);
  const [emailDuplicateError, setEmailDuplicateError] = useState("");

  // กฎรหัสผ่านมาจาก /admin/password-policy ไม่ใช่จากค่าที่เขียนตายไว้ในไฟล์นี้
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_POLICY);

  // ── Device access ───────────────────────────────────────────────────────────
  //
  // "Which firewalls may this person work on" is edited HERE, and only here. It used to be its own
  // dialog, opened by clicking the table cell; that made the cell a control that looked like a
  // label, and left two different ways to change one account. The Users table now only reports the
  // access, and the pencil is the single way in.
  //
  // Edit mode only, and deliberately: a grant needs a user ID, and the account does not have one
  // until it has been created. New accounts are granted by reopening them.
  //
  // Note this is only the FIRST half of reaching a device. The person still maps their own firewall
  // login under Profile ▸ Device Credentials — a device carries no login of its own — which is why
  // each row reports whether they have done it instead of implying the grant is the whole job.
  const [access, setAccess]               = useState<UserDeviceAccess | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError]     = useState("");
  const [granted, setGranted]             = useState<Set<number>>(new Set());
  const [grantedInitial, setGrantedInitial] = useState<Set<number>>(new Set());
  const [deviceSearch, setDeviceSearch]   = useState("");

  // An administrator reaches every firewall whatever is ticked, so the list is read-only for one.
  const accessIsAdmin = (access?.role ?? "").toLowerCase() === "admin";

  const visibleDevices = useMemo<DeviceAccessOption[]>(() => {
    const all = access?.devices ?? [];
    const q = deviceSearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter((d) => [d.name, d.mgmt_ip, d.site, d.vendor].join(" ").toLowerCase().includes(q));
  }, [access, deviceSearch]);

  const accessChanged = useMemo(() => {
    if (!isEditMode || accessIsAdmin) return false;
    if (granted.size !== grantedInitial.size) return true;
    for (const id of granted) if (!grantedInitial.has(id)) return true;
    return false;
  }, [granted, grantedInitial, isEditMode, accessIsAdmin]);

  const toggleDevice = (id: number) =>
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allShownGranted = visibleDevices.length > 0 && visibleDevices.every((d) => granted.has(d.id));

  // Select-all acts on what is VISIBLE, never on the whole inventory: with a filter box right
  // above it, a button that also granted the filtered-out devices would hand somebody a firewall
  // they were never looking at.
  const toggleAllShown = () =>
    setGranted((prev) => {
      const next = new Set(prev);
      if (allShownGranted) visibleDevices.forEach((d) => next.delete(d.id));
      else visibleDevices.forEach((d) => next.add(d.id));
      return next;
    });

  const loadAccess = async (userId: number) => {
    setAccessLoading(true);
    setAccessError("");
    try {
      const data = await GetUserDeviceAccess(userId);
      setAccess(data);
      const held = new Set(data.devices.filter((d) => d.granted).map((d) => d.id));
      setGranted(held);
      setGrantedInitial(new Set(held));
    } catch (e) {
      setAccess(null);
      setGranted(new Set());
      setGrantedInitial(new Set());
      setAccessError(apiErrorDetail(e, "Could not read this user's device access"));
    } finally {
      setAccessLoading(false);
    }
  };

  // แปลง PolicyRule → ข้อความบนหน้าจอ (โมดูล lib คืน i18n key มา จะได้เทสได้โดยไม่ต้องมี i18n)
  const ruleText = (r: { i18nKey: string; count?: number }) =>
    r.count === undefined ? t(r.i18nKey) : t(r.i18nKey, { count: r.count });

  const passwordRules = useMemo(
    () => policyRules(formData.password, policy),
    [formData.password, policy],
  );
  // โชว์ error ต่อเมื่อผู้ใช้พิมพ์อะไรไปแล้ว — ช่องว่างเปล่ายังไม่ใช่ "รหัสผ่านผิด"
  const passwordError = useMemo(() => {
    if (isEditMode || !formData.password) return "";
    const bad = firstPolicyViolation(formData.password, policy);
    return bad ? ruleText(bad) : "";
  }, [formData.password, policy, isEditMode, t]);

  const fullName = useMemo(() =>
    `${formData.first_name} ${formData.last_name}`.trim() || t("userModal.newUser"),
  [formData.first_name, formData.last_name, t]);

  const selectedRole = useMemo(() =>
    roles.find((r) => r.id === Number(formData.app_role_id)) || null,
  [roles, formData.app_role_id]);

  const filteredRoles = useMemo(() => {
    const kw = roleSearch.trim().toLowerCase();
    return kw ? roles.filter((r) => r.role.toLowerCase().includes(kw)) : roles;
  }, [roles, roleSearch]);

  const checkDuplicateEmail = (email: string) => {
    const norm = normalizeEmail(email);
    if (!norm) return "";
    return existingEmails.some((item) => {
      const same = normalizeEmail(item.email) === norm;
      const isSelf = isEditMode && user?.id === item.id;
      return same && !isSelf;
    }) ? "This email is already in use" : "";
  };

  const fetchRoles = async () => {
    try {
      setLoadingRoles(true);
      const data = await ListRoles();
      // กรองเหลือเฉพาะ role ที่มอบให้บัญชีใหม่ได้ — ดูเหตุผลที่ ASSIGNABLE_ROLES
      setRoles((data ?? []).filter((r) => ASSIGNABLE_ROLES.includes(r.role.toLowerCase())));
    } catch { setRoles([]); }
    finally { setLoadingRoles(false); }
  };

  const loadPolicy = async () => {
    try { setPolicy(await GetPasswordPolicy()); }
    catch { setPolicy(DEFAULT_POLICY); } // อ่านไม่ได้ = ใช้ค่าเข้มไว้ก่อน ปล่อยให้ backend ตัดสินซ้ำ
  };

  const loadExistingEmails = async () => {
    try {
      const data = await ListEmailAndPhoneNumber();
      setExistingEmails(Array.isArray(data) ? data : []);
    } catch { setExistingEmails([]); }
  };

  useEffect(() => {
    if (!open) return;
    if (!fetchedRolesRef.current) { fetchedRolesRef.current = true; fetchRoles(); }
    loadExistingEmails();
    // ดึงทุกครั้งที่เปิด ไม่ cache — admin อาจเพิ่งไปแก้ policy ที่อีกแท็บ แล้วกฎบนฟอร์มนี้
    // ต้องเป็นกฎเดียวกับที่ backend จะใช้ตัดสินตอนกดสร้าง
    loadPolicy();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (isEditMode && user) {
      const matchedRole = roles.find((r) => r.role.toLowerCase() === String(user.role || "").toLowerCase());
      setFormData({ email: user.email ?? "", password: "", first_name: user.first_name ?? "", last_name: user.last_name ?? "", app_role_id: matchedRole?.id ?? "" });
      setProfileUrl(user.profile ?? "");
    } else {
      // เหลือ role เดียวให้เลือก ก็เลือกให้เลย — บังคับให้กด dropdown ที่มีตัวเลือกเดียว
      // เป็นขั้นตอนที่ไม่ได้ให้ข้อมูลอะไรกับใคร และเป็นเหตุให้ "Please select role" โผล่มาเปล่า ๆ
      setFormData({ ...EMPTY_FORM, app_role_id: roles.length === 1 ? roles[0].id : "" });
      setProfileUrl("");
    }
    setSubmitting(false); setUploadingImage(false); setError("");
    setRoleOpen(false); setRoleSearch("");
    setEmailDuplicateError("");
  }, [open, isEditMode, user, roles]);

  // Device access is loaded per OPEN, not per render of the row: the grants may have been changed
  // elsewhere since the table was last refreshed, and this dialog is about to overwrite them with
  // a full set rather than a delta.
  useEffect(() => {
    if (!open) { return; }
    setDeviceSearch("");
    setAccessError("");
    if (isEditMode && user) {
      void loadAccess(user.id);
    } else {
      setAccess(null);
      setGranted(new Set());
      setGrantedInitial(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEditMode, user?.id]);

  useEffect(() => {
    if (!roleOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(e.target as Node))
        setRoleOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [roleOpen]);

  useEffect(() => {
    if (!open) return;
    setEmailDuplicateError(checkDuplicateEmail(formData.email));
  }, [formData.email, existingEmails, open, isEditMode]);

  const originalEmail = useMemo(() => (isEditMode ? user?.email ?? "" : ""), [isEditMode, user]);

  const hasFormChanged = useMemo(() => {
    if (!isEditMode) return true;
    const matchedRole = roles.find((r) => r.role.toLowerCase() === String(user?.role || "").toLowerCase());
    return (
      normalizeEmail(formData.email) !== normalizeEmail(originalEmail) ||
      formData.first_name.trim() !== (user?.first_name ?? "").trim() ||
      formData.last_name.trim() !== (user?.last_name ?? "").trim() ||
      String(formData.app_role_id || "") !== String(matchedRole?.id ?? "") ||
      profileUrl !== (user?.profile ?? "") ||
      // Ticking a device is a change like any other — without this, Save stays disabled for
      // someone who came here to do only that.
      accessChanged
    );
  }, [formData, originalEmail, user, roles, isEditMode, profileUrl, accessChanged]);

  if (!open) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (name === "email") setEmailDuplicateError(checkDuplicateEmail(value));
  };

  const handleRoleSelect = (roleId: number) => {
    setFormData((prev) => ({ ...prev, app_role_id: roleId }));
    setRoleOpen(false); setRoleSearch("");
  };

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isImageFile(file)) { message.warning(t("userModal.uploadImageOnly")); e.target.value = ""; return; }
    if (file.size > 5 * 1024 * 1024) { message.warning(t("userModal.imageTooLarge")); e.target.value = ""; return; }
    try {
      setUploadingImage(true);
      const { UploadProfileImage } = await import("../../api/user");
      const url = await UploadProfileImage(file);
      if (!url) { message.error(t("userModal.uploadFailed")); return; }
      setProfileUrl(url);
      message.success(t("userModal.imageUploaded"));
    } catch { message.error(t("userModal.uploadImageFailed")); }
    finally { setUploadingImage(false); e.target.value = ""; }
  };

  const validateForm = () => {
    if (!formData.first_name.trim()) return "Please enter first name";
    if (!formData.last_name.trim()) return "Please enter last name";
    if (!formData.email.trim()) return "Please enter email";
    if (!/\S+@\S+\.\S+/.test(formData.email)) return "Invalid email format";
    if (emailDuplicateError) return emailDuplicateError;
    if (!isEditMode) {
      if (!formData.password.trim()) return "Please enter password";
      // ตัวตรวจตัวเดียวกับ checklist ที่แสดงอยู่ใต้ช่อง — จะได้ไม่มีสภาพ "ติ๊กเขียวครบแต่กดไม่ผ่าน"
      const bad = firstPolicyViolation(formData.password, policy);
      if (bad) return ruleText(bad);
    }
    if (!formData.app_role_id) return "Please select role";
    if (isEditMode && !hasFormChanged) return t("userModal.noChanges");
    return "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (isEditMode && !hasFormChanged) { message.warning(t("userModal.noChanges")); return; }
    await loadExistingEmails();
    setEmailDuplicateError(checkDuplicateEmail(formData.email));
    const validationError = validateForm();
    if (validationError) { setError(validationError); return; }
    try {
      setSubmitting(true);
      // The two calls answer different shapes — an UpdateUserByAdminResponse and a UserResponse —
      // and this block only ever asks two things of whichever came back: is it there, and does it
      // carry an `error` to show, or a `message` to echo. That is the type, stated.
      let res: { error?: string; message?: string } | null;
      if (isEditMode && user) {
        res = await UpdateUserIDByAdmin(user.id, {
          email: formData.email.trim(),
          first_name: formData.first_name.trim(),
          last_name: formData.last_name.trim(),
          profile: profileUrl || "",
          phone_number: user.phone_number ?? "",
          location: user.location ?? "",
          position: user.position ?? "",
          app_role_id: Number(formData.app_role_id),
        });
      } else {
        // ไม่ส่ง phone_number / location / position — ฟอร์มนี้ไม่ได้เก็บ และ backend
        // ไม่บังคับแล้ว (ของเดิมส่งค่าว่างไปชน `binding:"required"` → 400 ทุกครั้ง
        // จนสร้างผู้ใช้จากหน้านี้ไม่สำเร็จเลยสักครั้ง) เติมทีหลังได้ที่หน้า Edit
        res = await CreateUser({
          email: formData.email.trim(),
          password: formData.password.trim(),
          first_name: formData.first_name.trim(),
          last_name: formData.last_name.trim(),
          profile: profileUrl || "",
          app_role_id: Number(formData.app_role_id),
        });
      }
      if (!res) { setError(isEditMode ? t("userModal.updateFailed") : t("userModal.createFailed")); return; }
      if (res.error) { setError(res.error); return; }

      // The grants are a second, independent write, so its failure is reported on its own rather
      // than folded into "update failed" — the profile really did save, and saying otherwise would
      // send the admin back to redo work that is already done.
      if (isEditMode && user && accessChanged) {
        try {
          await SetUserDeviceAccess(user.id, Array.from(granted));
        } catch (accessErr) {
          setError(
            apiErrorDetail(accessErr, "The profile was saved, but the device access could not be updated"),
          );
          return;
        }
      }

      message.success(res.message || (isEditMode ? t("userModal.updateSuccess") : t("userModal.createSuccess")));
      onUpdated();
    } catch (err) {
      setError(apiErrorText(err, (isEditMode ? t("userModal.updateFailed") : t("userModal.createFailed"))));
    } finally { setSubmitting(false); }
  };

  const inputBase = "h-9 rounded-[4px] border border-slate-200/80 px-3 text-[11px] outline-none transition w-full bg-white text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-white/85 dark:placeholder:text-white/30";
  const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-white/40";

  const onFocusInput = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = currentColor;
    e.currentTarget.style.boxShadow = `0 0 0 3px ${currentColor}20`;
  };
  const onBlurInput = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  };

  return createPortal(
    <div className="fixed inset-0 z-9999 flex items-center justify-center p-3 sm:p-4">
      <div role="presentation" className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={!submitting ? onClose : undefined} />
      <div className="relative z-10 w-full max-w-md rounded-[6px] bg-white dark:bg-[#12101f] ring-1 ring-black/5 dark:ring-white/10">

        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-white/8">
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <label className="group relative h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-full"
              style={{ outline: `2px solid ${currentColor}50`, outlineOffset: "2px" }}>
              {profileUrl && (isBase64DataImage(profileUrl) || profileUrl.startsWith("http://") || profileUrl.startsWith("https://")) ? (
                <img src={profileUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-white text-[18px] font-semibold"
                  style={{ background: gradient }}>
                  {(formData.first_name || "U").charAt(0).toUpperCase()}
                </div>
              )}
              <div className="absolute inset-0 hidden items-center justify-center rounded-full bg-black/40 group-hover:flex">
                <FiUpload className="text-[13px] text-white" />
              </div>
              <input type="file" accept="image/*" onChange={handleUploadImage} className="hidden" />
            </label>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: currentColor }}>
                {isEditMode
                  ? <span className="inline-flex items-center gap-1"><FiEdit2 className="text-[8px]" />{t("userModal.editMode")}</span>
                  : <span className="inline-flex items-center gap-1"><FiPlus className="text-[8px]" />{t("userModal.createMode")}</span>
                }
              </p>
              <h3 className="text-[14px] font-bold leading-tight text-slate-800 dark:text-white/90">{fullName}</h3>
              <p className="text-[10px] text-slate-400 dark:text-white/35">
                {formData.email || t("userModal.fillDetails")}
                {uploadingImage && <span className="ml-2" style={{ color: currentColor }}>{t("userModal.uploading")}</span>}
              </p>
            </div>
          </div>

          <button type="button" onClick={onClose} disabled={submitting}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-white/40 dark:hover:bg-white/10 transition-colors">
            <FiX className="text-[14px]" />
          </button>
        </div>

        {/* ── Form ── */}
        <form onSubmit={handleSubmit}>
          <div className="px-5 py-4 space-y-3">

            {/* First + Last Name */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="field" className={labelCls}>{t("userModal.firstName")}</label>
                <div className="relative">
                  <FiUser className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 dark:text-white/30" />
                  <input id="field" type="text" name="first_name" value={formData.first_name} onChange={handleChange}
                    placeholder={t("userModal.firstNamePlaceholder")} onFocus={onFocusInput} onBlur={onBlurInput}
                    className={`pl-8 ${inputBase}`} />
                </div>
              </div>
              <div>
                <label htmlFor="field-1" className={labelCls}>{t("userModal.lastName")}</label>
                <div className="relative">
                  <FiUser className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 dark:text-white/30" />
                  <input id="field-1" type="text" name="last_name" value={formData.last_name} onChange={handleChange}
                    placeholder={t("userModal.lastNamePlaceholder")} onFocus={onFocusInput} onBlur={onBlurInput}
                    className={`pl-8 ${inputBase}`} />
                </div>
              </div>
            </div>

            {/* Email */}
            <div>
              <label htmlFor="field-2" className={labelCls}>{t("userModal.email")}</label>
              <div className="relative">
                <FiMail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 dark:text-white/30" />
                <input id="field-2" type="email" name="email" value={formData.email} onChange={handleChange}
                  placeholder={t("userModal.emailPlaceholder")} onFocus={onFocusInput} onBlur={onBlurInput}
                  className={`pl-8 ${inputBase}`} />
              </div>
              {emailDuplicateError && <p className="mt-1 pl-1 text-[10px] text-red-500">{emailDuplicateError}</p>}
            </div>

            {/* Password (create only) */}
            {!isEditMode && (
              <div>
                <label htmlFor="field-3" className={labelCls}>{t("userModal.password")}</label>
                <div className="relative">
                  <FiShield className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 dark:text-white/30" />
                  <input id="field-3" type="password" name="password" value={formData.password} onChange={handleChange}
                    placeholder={t("userModal.passwordPlaceholder")} onFocus={onFocusInput} onBlur={onBlurInput}
                    className={`pl-8 ${inputBase}`} />
                </div>
                {/* กฎที่แสดงมาจาก /admin/password-policy ตรง ๆ — ของเดิมเป็นข้อความตายตัว
                    "Min 8 chars · uppercase · lowercase · special character" ซึ่งไม่ตรงกับ
                    policy จริง (บนระบบตอนนี้ตั้งไว้แค่ min 8) และมี "lowercase" ที่หน้า
                    Password Policy ไม่มีให้ตั้งด้วยซ้ำ */}
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-1">
                  {passwordRules.map((r) => {
                    const touched = formData.password.length > 0;
                    return (
                      <span key={r.key}
                        className="inline-flex items-center gap-1 text-[10px] transition-colors"
                        style={{
                          color: !touched ? "#94a3b8" : r.ok ? "#10b981" : "#ef4444",
                        }}>
                        <span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full border"
                          style={{
                            borderColor: !touched ? "#cbd5e1" : r.ok ? "#10b981" : "#ef4444",
                            backgroundColor: touched && r.ok ? "#10b981" : "transparent",
                          }}>
                          {touched && r.ok && <FiCheck className="text-[6px] text-white" />}
                        </span>
                        {ruleText(r)}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Role */}
            <div className="relative" ref={roleDropdownRef}>
              <label htmlFor="field-4" className={labelCls}>{t("userModal.role")}</label>
              <button type="button" onClick={() => { if (!loadingRoles) setRoleOpen((p) => !p); }} disabled={loadingRoles}
                className="h-9 rounded-[4px] px-3 flex items-center gap-2 border border-slate-200/80 transition w-full bg-white text-slate-700 dark:bg-white/5 dark:border-white/10 dark:text-white/75 disabled:opacity-60"
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = currentColor; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = ""; }}>
                <FiShield className="shrink-0 text-[11px] text-slate-400 dark:text-white/30" />
                <span className="flex-1 truncate text-left text-[11px]">
                  {loadingRoles ? t("userModal.loadingRoles") : selectedRole?.role || t("userModal.selectRole")}
                </span>
                <FiChevronDown className={`text-[11px] text-slate-400 transition-transform dark:text-white/30 ${roleOpen ? "rotate-180" : ""}`} />
              </button>

              {roleOpen && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-[4px] border border-slate-200/80 bg-white shadow-lg dark:border-white/10 dark:bg-[#0e0c1e]"
                  style={{ boxShadow: `0 8px 24px -4px ${currentColor}20, 0 4px 12px rgba(0,0,0,.12)` }}>
                  <div className="border-b border-slate-100 p-1.5 dark:border-white/8">
                    <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 dark:border-white/10 dark:bg-white/5">
                      <FiSearch className="text-[10px] text-slate-400 dark:text-white/40" />
                      <input id="field-4" value={roleSearch} onChange={(e) => setRoleSearch(e.target.value)}
                        placeholder={t("userModal.searchRole")}
                        className="h-7 w-full bg-transparent text-[10px] text-slate-700 outline-none placeholder:text-slate-400 dark:text-white/80 dark:placeholder:text-white/35" />
                    </div>
                  </div>
                  <div className="max-h-32 overflow-y-auto p-1.5">
                    {filteredRoles.length === 0 ? (
                      <div className="py-3 text-center text-[10px] text-slate-400 dark:text-white/40">{t("userModal.noRolesFound")}</div>
                    ) : (
                      <div className="space-y-0.5">
                        {filteredRoles.map((role) => {
                          const checked = Number(formData.app_role_id) === role.id;
                          return (
                            <button key={role.id} type="button" onClick={() => handleRoleSelect(role.id)}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 transition hover:bg-slate-50 dark:hover:bg-white/5"
                              style={checked ? { backgroundColor: `${currentColor}12` } : {}}>
                              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border transition"
                                style={checked ? { borderColor: currentColor, backgroundColor: currentColor, color: "white" } : { borderColor: "#cbd5e1" }}>
                                {checked && <FiCheck className="text-[7px]" />}
                              </span>
                              <span className="flex-1 truncate text-[10px] font-medium text-slate-700 dark:text-white/80">{role.role}</span>
                              {checked && (
                                <span className="rounded-full border px-1.5 py-0.5 text-[8px] font-semibold"
                                  style={{ borderColor: `${currentColor}40`, backgroundColor: `${currentColor}12`, color: currentColor }}>
                                  {t("userModal.selectedBadge")}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Device access (edit only) ── */}
            {isEditMode && (
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  {/* labelCls, minus its bottom margin — appending "mb-0" would not reliably win,
                      Tailwind utilities of equal specificity are decided by stylesheet order. */}
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-white/40">
                    {t("userModal.deviceAccess")}
                  </span>
                  {!accessIsAdmin && access && (
                    <span className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold"
                      style={{ borderColor: `${currentColor}40`, backgroundColor: `${currentColor}12`, color: currentColor }}>
                      {granted.size}/{access.devices.length}
                    </span>
                  )}
                </div>

                {accessIsAdmin ? (
                  <div className="flex items-start gap-2 rounded-[4px] border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-[10px] text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/60">
                    <FiShield className="mt-0.5 shrink-0 text-[11px]" />
                    <span>{t("userModal.deviceAccessAdmin")}</span>
                  </div>
                ) : accessLoading ? (
                  <p className="rounded-[4px] border border-slate-200/80 px-3 py-2.5 text-[10px] text-slate-400 dark:border-white/10 dark:text-white/40">
                    {t("userModal.deviceAccessLoading")}
                  </p>
                ) : accessError ? (
                  <p className="rounded-[4px] border border-red-200 bg-red-50 px-3 py-2 text-[10px] text-red-600 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300">
                    {accessError}
                  </p>
                ) : (access?.devices.length ?? 0) === 0 ? (
                  <p className="rounded-[4px] border border-slate-200/80 px-3 py-2.5 text-[10px] text-slate-400 dark:border-white/10 dark:text-white/40">
                    {t("userModal.deviceAccessNoInventory")}
                  </p>
                ) : (
                  <>
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 dark:border-white/10 dark:bg-white/5">
                        <FiSearch className="text-[10px] text-slate-400 dark:text-white/40" />
                        <input value={deviceSearch} onChange={(e) => setDeviceSearch(e.target.value)}
                          placeholder={t("userModal.deviceAccessFilter")}
                          className="h-7 w-full bg-transparent text-[10px] text-slate-700 outline-none placeholder:text-slate-400 dark:text-white/80 dark:placeholder:text-white/35" />
                      </div>
                      <button type="button" onClick={toggleAllShown} disabled={visibleDevices.length === 0}
                        className="h-7 shrink-0 rounded-lg border border-slate-200 px-2 text-[10px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-white/65 dark:hover:bg-white/5">
                        {allShownGranted ? t("userModal.deviceAccessClearShown") : t("userModal.deviceAccessSelectShown")}
                      </button>
                    </div>

                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-[4px] border border-slate-200/80 p-1.5 dark:border-white/10">
                      {visibleDevices.length === 0 ? (
                        <p className="py-3 text-center text-[10px] text-slate-400 dark:text-white/40">
                          {t("userModal.deviceAccessNoMatch")}
                        </p>
                      ) : visibleDevices.map((d) => {
                        const checked = granted.has(d.id);
                        return (
                          <button key={d.id} type="button" onClick={() => toggleDevice(d.id)}
                            className="flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition hover:bg-slate-50 dark:hover:bg-white/5"
                            style={checked
                              ? { borderColor: currentColor, backgroundColor: `${currentColor}0f` }
                              : { borderColor: "transparent" }}>
                            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition"
                              style={checked
                                ? { borderColor: currentColor, backgroundColor: currentColor, color: "white" }
                                : { borderColor: "#cbd5e1" }}>
                              {checked && <FiCheck className="text-[7px]" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[10.5px] font-semibold text-slate-700 dark:text-white/85">{d.name}</span>
                              <span className="block truncate text-[9.5px] text-slate-400 dark:text-white/40">
                                {d.mgmt_ip}{d.site ? ` · ${d.site}` : ""}
                              </span>
                            </span>
                            {/* A grant without their own login still opens nothing — say which it is. */}
                            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[8.5px] font-semibold ${
                              d.has_credential
                                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300"
                                : "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"}`}
                              title={d.has_credential ? t("userModal.deviceAccessOwnLoginHint") : t("userModal.deviceAccessNoLoginHint")}>
                              {d.has_credential && <FiKey className="text-[8px]" />}
                              {d.has_credential ? t("userModal.deviceAccessOwnLogin") : t("userModal.deviceAccessNoLogin")}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <p className="mt-1.5 flex items-start gap-1.5 pl-0.5 text-[9.5px] leading-relaxed text-slate-400 dark:text-white/40">
                      <FiHardDrive className="mt-0.5 shrink-0 text-[10px]" />
                      <span>{t("userModal.deviceAccessHint")}</span>
                    </p>
                  </>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-[4px] border border-red-200 bg-red-50 px-3 py-2 text-center text-[11px] text-red-600 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-white/8">
            <button type="button" onClick={onClose} disabled={submitting}
              className="h-9 px-4 rounded-[4px] inline-flex items-center gap-2 text-[11px] font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-white/65 transition disabled:opacity-60">
              {t("userModal.cancel")}
            </button>
            <button type="submit"
              disabled={submitting || !!emailDuplicateError || (!isEditMode && !!passwordError) || (isEditMode && !hasFormChanged)}
              className="h-9 px-4 rounded-[4px] inline-flex items-center gap-2 text-[11px] font-semibold text-white transition disabled:opacity-60"
              style={{ background: gradient }}>
              {submitting
                ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                : <FiSave className="text-[11px]" />
              }
              {submitting
                ? (isEditMode ? t("userModal.saving") : t("userModal.creating"))
                : (isEditMode ? t("userModal.saveChanges") : t("userModal.createUser"))
              }
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default UserFormModal;
