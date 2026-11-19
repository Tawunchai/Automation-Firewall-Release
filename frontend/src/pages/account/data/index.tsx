import React, { useEffect, useMemo, useState } from "react";
import {
  FiHome,
  FiBriefcase,
  FiMail,
  FiPhone,
  FiUser,
  FiShield,
  FiEdit2,
  FiCheck,
  FiX,
  FiAlertCircle,
} from "react-icons/fi";
import { message } from "../../../components/ui/toast";
import { useTranslation } from "react-i18next";
import type { UserResponse, UpdateUserInput } from "../../../api/user";
import { UpdateUserByID } from "../../../api/user";
import { useStateContext } from "../../../contexts/ProviderContext.logic";
import { apiErrorText } from "../../../api/errorText";

type DataProps = {
  user: UserResponse;
  onUpdated: () => void;
};

type DataForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  position: string;
};

const Data: React.FC<DataProps> = ({ user, onUpdated }) => {
  const { t } = useTranslation();
  const { triggerUserRefresh, currentColor } = useStateContext();

  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const createForm = (u: UserResponse): DataForm => ({
    firstName: u.first_name || "",
    lastName: u.last_name || "",
    email: u.email || "",
    phone: u.phone_number || "",
    location: u.location || "",
    position: u.position || "",
  });

  const [form, setForm] = useState<DataForm>(createForm(user));

  useEffect(() => {
    setForm(createForm(user));
    setEditing(false);
  }, [user]);

  const fullName =
    `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "—";

  const hasChanged = useMemo(() => {
    const initial = createForm(user);
    return (
      form.firstName.trim() !== initial.firstName.trim() ||
      form.lastName.trim() !== initial.lastName.trim() ||
      form.email.trim() !== initial.email.trim() ||
      form.phone.trim() !== initial.phone.trim() ||
      form.location.trim() !== initial.location.trim() ||
      form.position.trim() !== initial.position.trim()
    );
  }, [form, user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === "phone") {
      setForm((prev) => ({ ...prev, phone: value.replace(/\D/g, "").slice(0, 10) }));
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCancel = () => {
    setForm(createForm(user));
    setEditing(false);
  };

  const handleSave = async () => {
    if (!user?.id) { message.error("User ID not found"); return; }
    if (!hasChanged) { setEditing(false); return; }

    if (!form.firstName.trim()) { message.error("Please enter first name"); return; }
    if (!form.lastName.trim()) { message.error("Please enter last name"); return; }

    try {
      setSubmitting(true);
      const payload: UpdateUserInput = {
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        email: form.email.trim(),
        phone_number: form.phone.trim(),
        location: form.location.trim(),
        position: form.position.trim(),
      };
      const updated = await UpdateUserByID(user.id, payload);
      if (!updated) { message.error("Update failed"); return; }
      message.success("Saved successfully");
      setEditing(false);
      onUpdated();
      triggerUserRefresh();
    } catch (err) {
      message.error(apiErrorText(err, "Update failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const nameMissing = fullName === "—";
  const fill = t("account.fillInfo");

  const displayItems = [
    { label: t("account.name"),     value: nameMissing ? fill : fullName, icon: <FiUser />,      missing: nameMissing },
    { label: t("account.email"),    value: user.email || fill,            icon: <FiMail />,      missing: !user.email },
    { label: t("account.phone"),    value: user.phone_number || fill,     icon: <FiPhone />,     missing: !user.phone_number },
    { label: t("account.location"), value: user.location || fill,         icon: <FiHome />,      missing: !user.location },
    { label: t("account.position"), value: user.position || fill,         icon: <FiBriefcase />, missing: !user.position },
  ];

  /* The five editable fields, as data. They were six near-identical JSX blocks, which is how the
     phone field ended up as the only one carrying its hint. */
  const editFields: { name: keyof DataForm; label: string; type: string; extra?: React.InputHTMLAttributes<HTMLInputElement> }[] = [
    { name: "email",    label: t("account.email"),    type: "email" },
    { name: "phone",    label: t("account.phone"),    type: "text", extra: { inputMode: "numeric", maxLength: 10, placeholder: t("account.phonePlaceholder") } },
    { name: "location", label: t("account.location"), type: "text" },
    { name: "position", label: t("account.position"), type: "text" },
  ];

  return (
    <section className="shell-card flex h-full flex-col overflow-hidden">
      <header className="card-head">
        <h2 className="card-title t-card">
          <span
            className="medallion h-6 w-6 text-[12px]"
            style={{ color: currentColor, background: `color-mix(in srgb, ${currentColor} 13%, transparent)` }}
          >
            <FiUser />
          </span>
          <span className="truncate">{t("account.personalInfo")}</span>
        </h2>

        {!editing ? (
          <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">
            <FiEdit2 className="text-[11px]" />
            {t("common.edit")}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={submitting}
              className="btn btn-accent btn-sm"
            >
              <FiCheck className="text-[11px]" />
              {submitting ? t("account.saving") : t("common.save")}
            </button>
            <button type="button" onClick={handleCancel} disabled={submitting} className="btn btn-ghost btn-sm">
              <FiX className="text-[11px]" />
              {t("common.cancel")}
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 px-4 py-1">
        {!editing ? (
          <div>
            {displayItems.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3 border-b hairline-2 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={`shrink-0 text-[14px] ${item.missing ? "text-amber-500" : "ink-3"}`}>
                    {item.missing ? <FiAlertCircle /> : item.icon}
                  </span>
                  <span className={`truncate text-[12px] ${item.missing ? "text-amber-600 dark:text-amber-400/85" : "ink-2"}`}>
                    {item.label}
                  </span>
                </div>
                <span
                  className={[
                    "truncate text-[12.5px] font-semibold",
                    item.missing ? "text-amber-500/70 dark:text-amber-400/50" : "ink",
                  ].join(" ")}
                >
                  {item.value}
                </span>
              </div>
            ))}

            {/* Role — read-only. It is the one row on this card the account holder cannot change,
                so it is a chip rather than a value: it states a fact, it does not invite editing. */}
            <div className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-2.5">
                <span className="shrink-0 text-[14px] ink-3"><FiShield /></span>
                <span className="text-[12px] ink-2">{t("account.role")}</span>
              </div>
              <span className={`chip ${user.role === "admin" ? "chip-accent" : ""}`}>
                {user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "—"}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-3">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="field-label" htmlFor="acct-firstName">{t("account.firstName")}</label>
                <input
                  id="acct-firstName"
                  name="firstName"
                  value={form.firstName}
                  onChange={handleChange}
                  type="text"
                  className="shell-input"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="acct-lastName">{t("account.lastName")}</label>
                <input
                  id="acct-lastName"
                  name="lastName"
                  value={form.lastName}
                  onChange={handleChange}
                  type="text"
                  className="shell-input"
                />
              </div>
            </div>

            {editFields.map((f) => (
              <div key={f.name}>
                <label className="field-label" htmlFor={`acct-${f.name}`}>{f.label}</label>
                <input
                  id={`acct-${f.name}`}
                  name={f.name}
                  value={form[f.name]}
                  onChange={handleChange}
                  type={f.type}
                  className="shell-input"
                  {...f.extra}
                />
                {f.name === "phone" && <p className="field-hint">{t("account.phoneHint")}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default Data;
