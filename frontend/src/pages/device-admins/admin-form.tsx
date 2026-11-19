import React from "react";
import { FiAlertTriangle } from "react-icons/fi";
import type { AccProfile, AdminUser } from "../../api/systemSettings";
import { TWO_FACTOR_OPTIONS, describeProfile, type AdminDraft } from "./model";
import MinimalSelect from "../../components/ui/MinimalSelect";

// The fields shared by the standalone create and edit pages — pulled out of index.tsx's old modal
// the same way static-routes/route-form.tsx split theirs out for its own full-page create/edit.
// The lockout confirmation stays a small modal on top of the page (see lockout-confirm.tsx),
// the same way delete confirmation stays a modal everywhere else in this app.

export const AdminFields: React.FC<{
  draft: AdminDraft;
  set: <K extends keyof AdminDraft>(k: K, v: AdminDraft[K]) => void;
  profiles: AccProfile[];
  original: AdminUser | null;
  formError: string | null;
  wouldLockOut: boolean;
}> = ({ draft: d, set, profiles, original, formError, wouldLockOut }) => {
  const profileOf = (name: string) => profiles.find((p) => p.name === name);

  return (
    <div className="space-y-3 px-6 py-5">
      {formError && (
        <div className="banner banner-danger">
          <FiAlertTriangle size={14} className="shrink-0" /><span>{formError}</span>
        </div>
      )}

      {wouldLockOut && (
        <div className="banner banner-danger">
          <FiAlertTriangle size={14} className="shrink-0" />
          <span>
            {`This restricts ${d.name} to the addresses below. Every other address — including the one you are connected from, unless it is in the list — stops being able to log in as this account.`}
          </span>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="ad-name" className="field-label">Account name</label>
          <input id="ad-name" className="shell-input" value={d.name} disabled={!!original}
                 onChange={(e) => set("name", e.target.value)} />
        </div>
        <div>
          <label htmlFor="ad-profile" className="field-label">Access profile</label>
          <MinimalSelect id="ad-profile" ariaLabel="Access profile" className="w-full" value={d.accprofile}
            onChange={(v) => set("accprofile", v)}
            options={[
              { value: "", label: "Choose…" },
              ...profiles.map((p) => ({ value: p.name, label: p.name })),
            ]} />
          <p className="t-meta m-0 mt-1">{describeProfile(profileOf(d.accprofile))}</p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-[13px] ink">
        <input type="checkbox" checked={d.remoteAuth} onChange={(e) => set("remoteAuth", e.target.checked)} />
        Authenticate against a remote server instead of a local password
      </label>

      {d.remoteAuth ? (
        <div>
          <label htmlFor="ad-group" className="field-label">Remote group</label>
          <input id="ad-group" className="shell-input" value={d.remoteGroup}
                 onChange={(e) => set("remoteGroup", e.target.value)} />
        </div>
      ) : (
        <div>
          {original && (
            <label className="mb-1.5 flex items-center gap-2 text-[13px] ink">
              <input type="checkbox" checked={d.keepPassword} onChange={(e) => set("keepPassword", e.target.checked)} />
              Leave the password unchanged
            </label>
          )}
          <label htmlFor="ad-pass" className="field-label">Password</label>
          <input id="ad-pass" type="password" className="shell-input" autoComplete="new-password"
                 value={d.password} disabled={d.keepPassword} onChange={(e) => set("password", e.target.value)} />
          {original && d.keepPassword && (
            <p className="t-meta m-0 mt-1">
              The firewall never returns a password, so leaving this alone is the only way to keep it.
            </p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="ad-hosts" className="field-label">Trusted hosts</label>
        <textarea id="ad-hosts" className="shell-input font-mono" rows={3}
                  placeholder={"10.0.0.0/24\n192.168.1.5/32"} value={d.trustHosts}
                  onChange={(e) => set("trustHosts", e.target.value)} />
        <p className="t-meta m-0 mt-1">
          One subnet per line, up to ten. Empty means the account can log in from any address — which
          is the FortiOS default, not a gap in the configuration.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="ad-2fa" className="field-label">Second factor</label>
          <MinimalSelect id="ad-2fa" ariaLabel="Second factor" className="w-full" value={d.twoFactor}
            onChange={(v) => set("twoFactor", v)}
            options={TWO_FACTOR_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        </div>
        <div>
          <label htmlFor="ad-comments" className="field-label">Comments</label>
          <input id="ad-comments" className="shell-input" value={d.comments}
                 onChange={(e) => set("comments", e.target.value)} />
        </div>
      </div>
    </div>
  );
};

