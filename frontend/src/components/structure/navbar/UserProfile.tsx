import { useNavigate } from "react-router-dom";
import { type JSX, useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStateContext } from "../../../contexts/ProviderContext.logic";
import { FiLogOut, FiUser, FiServer } from "react-icons/fi";
import { message } from "../../ui/toast";

type UserProfileItem = {
  icon: JSX.Element;
  title: string;
  link?: string;
  /** Runs instead of navigating — for an entry that opens a dialog rather than a page. */
  onSelect?: () => void;
};

type UserProfileProps = {
  profileSrc: string;
  avatarFallback: string;
  fullName: string;
  roleName: string;
  email: string;
  logout: () => Promise<void>;
};

const AVATAR_SIZE = 44;

const createCoverThumbnail = async (imageSrc: string, size: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        const canvas = document.createElement("canvas");
        const targetSize = Math.round(size * dpr);
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("no ctx")); return; }
        ctx.clearRect(0, 0, targetSize, targetSize);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        const sw = img.naturalWidth, sh = img.naturalHeight;
        const scale = Math.max(targetSize / sw, targetSize / sh);
        const drawW = sw * scale, drawH = sh * scale;
        ctx.drawImage(img, (targetSize - drawW) / 2, (targetSize - drawH) / 2, drawW, drawH);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("load failed"));
    img.src = imageSrc;
  });
};

const UserProfile: React.FC<UserProfileProps> = ({
  profileSrc, avatarFallback, fullName, roleName, email, logout,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // useStateContext() throws rather than returning undefined, and StateContextType declares both
  // of these — the `as any` here was not reaching for anything the type does not have.
  const { isClicked, setIsClicked } = useStateContext();

  const [open, setOpen] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [thumbSrc, setThumbSrc] = useState("");

  useEffect(() => { if (isClicked?.userProfile) setOpen(true); }, [isClicked?.userProfile]);
  useEffect(() => { setImageError(false); }, [profileSrc]);

  const finalSrc = !imageError && profileSrc ? profileSrc : avatarFallback;

  useEffect(() => {
    let cancelled = false;
    const build = async () => {
      if (!finalSrc) { setThumbSrc(""); return; }
      if (finalSrc.startsWith("data:image/svg+xml")) { setThumbSrc(finalSrc); return; }
      try {
        const url = await createCoverThumbnail(finalSrc, AVATAR_SIZE);
        if (!cancelled) setThumbSrc(url);
      } catch { if (!cancelled) setThumbSrc(finalSrc); }
    };
    void build();
    return () => { cancelled = true; };
  }, [finalSrc]);

  const normalizedRole = String(roleName || "").trim().toLowerCase();
  const isAdmin = normalizedRole === "admin";

  const menuItems: UserProfileItem[] = useMemo(() => {
    const base: UserProfileItem[] = [
      { icon: <FiUser className="text-[15px]" />, title: t("account.viewProfile"), link: "/admin/profile" },
    ];
    if (isAdmin) {
      base.push({ icon: <FiServer className="text-[15px]" />, title: t("account.service"), link: "/admin/service" });
    }
    return base;
  }, [isAdmin, t]);

  const close = () => {
    setIsClicked((prev) => ({ ...prev, userProfile: false }));
    setOpen(false);
  };

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await logout();
      message.success(t("auth.logoutSuccess"));
      close();
      await new Promise(r => setTimeout(r, 600));
      navigate("/", { replace: true });
    } catch {
      message.error(t("auth.logoutFailed"));
      close();
      navigate("/", { replace: true });
    } finally { setLoggingOut(false); }
  };

  if (!open) return null;

  return (
    <>
      <div role="presentation" className="fixed inset-0 z-9998" onClick={close} />

      <div
        className={[
          "fixed right-4 top-17 z-9999 w-64 overflow-hidden",
          "rounded-[4px] shadow-[0_8px_30px_-8px_rgba(0,0,0,0.18)]",
          /* Light mode: white */
          "border hairline surface-card",
          /* Dark mode: dark panel */
          "  dark:shadow-[0_8px_30px_-8px_rgba(0,0,0,0.55)]",
        ].join(" ")}
      >
        {/* Profile header */}
        <div className="flex items-center gap-3 px-4 py-4">
          <div className="relative shrink-0">
            <img
              src={thumbSrc || finalSrc}
              alt={fullName}
              draggable={false}
              onError={() => setImageError(true)}
              className="h-11 w-11 rounded-full object-cover ring-2 ring-slate-200 dark:ring-white/10"
            />
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#1c1c28]" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold ink">
              {fullName}
            </p>
            <p className="truncate text-[11px] ink-3">
              {email}
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-4 h-px surface-sunken" />

        {/* Menu items */}
        <div className="p-1.5">
          {menuItems.map((item, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                close();
                if (item.onSelect) item.onSelect();
                else if (item.link) navigate(item.link);
              }}
              disabled={loggingOut}
              className="flex w-full items-center gap-3 rounded-[4px] px-3 py-2.5 text-[13px] font-medium ink-2 transition-colors surface-hover focus:outline-none"
            >
              <span className="shrink-0 ink-3">{item.icon}</span>
              {item.title}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="mx-4 h-px surface-sunken" />

        {/* Logout */}
        <div className="p-1.5">
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className={[
              "flex w-full items-center gap-3 rounded-[4px] px-3 py-2.5 text-[13px] font-medium transition-colors",
              "text-rose-500 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10",
              loggingOut ? "cursor-not-allowed opacity-50" : "",
              "focus:outline-none",
            ].join(" ")}
          >
            <FiLogOut className="shrink-0 text-[15px]" />
            {loggingOut ? t("auth.loggingOut") : t("auth.logout")}
          </button>
        </div>
      </div>
    </>
  );
};

export default UserProfile;
