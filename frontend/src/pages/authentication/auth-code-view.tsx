import React from "react";
import { useTranslation } from "react-i18next";
import { CODE_INPUT_CLS, ErrorBox, Field, PRIMARY_BTN } from "./auth-controls";

// The one-field "enter the code" screen, used by all three second factors: an authenticator app, a
// code emailed to the address on the account, and a printed recovery code.
//
// It was a function inside the page that the three views called with different props, which is a
// component with extra steps — so it is one now. Nothing about which factor is in play lives here;
// the page passes the title, the field and what to do on submit.
export type CodeViewProps = {
  icon: React.ReactNode;
  title: string;
  subtitle: React.ReactNode;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint: string;
  submitting: boolean;
  submitLabel: string;
  disabled: boolean;
  extra?: React.ReactNode;
};

const CodeView: React.FC<CodeViewProps> = (opts) => {
  const { t } = useTranslation();
  return (
    <div className="mt-9">
      <div className="text-center">
        <span className="auth-tile mx-auto mb-3 flex h-13 w-13 items-center justify-center rounded-[4px]">
          {opts.icon}
        </span>
        <h2 className="m-0 text-[22px] font-extrabold tracking-tight text-slate-900 dark:text-white">
          {opts.title}
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-5 text-slate-500 dark:text-white/55">
          {opts.subtitle}
        </p>
      </div>

      <ErrorBox text={opts.error} />

      <form onSubmit={opts.onSubmit} className="mt-5">
        <Field label={opts.label}>
          <input
            type="text"
            inputMode={opts.placeholder === "000000" ? "numeric" : "text"}
            value={opts.value}
            onChange={(e) => opts.onChange(e.target.value)}
            placeholder={opts.placeholder}
            autoFocus
            className={CODE_INPUT_CLS}
          />
        </Field>
        <p className="mt-1.5 text-[11.5px] text-slate-400 dark:text-white/35">{opts.hint}</p>

        <button
          type="submit"
          disabled={opts.submitting || opts.disabled}
          className={`${PRIMARY_BTN} mt-5`}
        >
          {opts.submitting ? t("auth.verifying") : opts.submitLabel}
        </button>
      </form>

      {opts.extra}
    </div>
  );
};

export default CodeView;
