import React from "react";
import { FiPlus, FiX } from "react-icons/fi";
import { inputCls } from "../fw-addresses/address-form";
import { focusRing } from "../../components/ui/form-controls.logic";
import MinimalSelect from "../../components/ui/MinimalSelect";
import {
  CUSTOM_ENC_OPTIONS, CUSTOM_AUTH_OPTIONS, CUSTOM_PRF_OPTIONS, CUSTOM_DH_GROUPS, isAEADCipher,
} from "./ipsec-wizard-rules";
import type { CustomProposalRow } from "./ipsec-wizard-rules";

/**
 * The wizard's own small controls: the toggle, the stacked pickers, the subnet and address row
 * editors, the proposal table and the DH group grid.
 *
 * Split out of ipsec-wizard.tsx, which reached 1,841 lines - 200 of them these widgets and the rest
 * one very large component. They are ordinary presentational pieces with no wizard state in them,
 * which is what makes them the safe half to move first.
 */


// A small iOS-style toggle — the GUI renders Split Tunnel / Client Options this way.
// A switch, not a clickable box. `label` is required rather than optional: a toggle with no
// accessible name is announced as "switch, checked" and nothing else, and the only reliable way to
// stop that happening again is to make the compiler ask for the name.
export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; currentColor: string; label: string }> =
  ({ checked, onChange, currentColor, label }) => (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
      style={{ background: checked ? currentColor : "#cbd5e1" }}>
      <span className="inline-block h-4 w-4 transform rounded-full surface-card transition-transform"
        style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }} />
    </button>
  );

// A vertical button stack — the GUI renders NAT configuration and Remote device type this way
// (one full-width option per row), unlike the horizontal groups elsewhere on the page.
export function VStack<T extends string>({ value, onChange, options, currentColor }: {
  value: T; onChange: (v: T) => void; currentColor: string;
  options: { v: T; l: string; icon?: React.ReactNode; hint?: string }[];
}) {
  return (
    <div className="inline-flex w-full max-w-sm flex-col overflow-hidden rounded border hairline">
      {options.map((o, i) => {
        const active = value === o.v;
        return (
          <button key={o.v} type="button" onClick={() => onChange(o.v)} title={o.hint}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-left text-[12px] font-semibold transition-colors ${i > 0 ? "border-t hairline" : ""}`}
            style={{ background: active ? currentColor : "transparent", color: active ? "white" : "#64748b" }}>
            {o.icon}{o.l}
          </button>
        );
      })}
    </div>
  );
}

// ─── Subnet list editor (the GUI's stacked rows + ⊕) ─────────────────────────
export const SubnetList: React.FC<{
  value: string[]; onChange: (v: string[]) => void; currentColor: string;
  placeholder: string; disabled?: boolean;
}> = ({ value, onChange, currentColor, placeholder, disabled }) => {
  const ring = focusRing(currentColor);
  const setAt = (i: number, v: string) => onChange(value.map((s, idx) => (idx === i ? v : s)));
  return (
    <div className="w-full max-w-sm space-y-2">
      {value.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={s} onChange={(e) => setAt(i, e.target.value)} placeholder={placeholder} disabled={disabled}
            className={`${inputCls} w-full font-mono ${disabled ? "cursor-not-allowed surface-sunken ink-3" : ""}`} {...ring} />
          {value.length > 1 && !disabled && (
            <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded border hairline ink-3 transition hover:border-red-300 hover:bg-red-50 hover:text-red-500">
              <FiX size={12} />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" onClick={() => onChange([...value, ""])}
          className="flex w-full items-center justify-center gap-1.5 rounded border hairline py-1 ink-3 transition surface-hover">
          <FiPlus size={13} />
        </button>
      )}
    </div>
  );
};

// A plain checkbox + label — the GUI renders "Require 'Group Name' on VPN client" this way
// (full-width, starting at the label column), not as a toggle.
export const CheckRow: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; currentColor: string }> =
  ({ checked, onChange, label, currentColor }) => (
    <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium ink-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer rounded hairline" style={{ accentColor: currentColor }} />
      {label}
    </label>
  );

// A stacked picker of existing address objects — the GUI's "Local Address" row (one <select> per
// row + ⊕), used to build the split-tunnel group's members.
export const AddressList: React.FC<{
  value: string[]; onChange: (v: string[]) => void; options: string[];
  currentColor: string; disabled?: boolean;
}> = ({ value, onChange, options, disabled }) => {
  const rows = value.length ? value : [""];
  const setAt = (i: number, v: string) => onChange(rows.map((s, idx) => (idx === i ? v : s)));
  return (
    <div className="w-full max-w-sm space-y-2">
      {rows.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <MinimalSelect value={s} ariaLabel="Address" className="w-full" disabled={disabled}
            onChange={(v) => setAt(i, v)}
            options={[
              { value: "", label: "Select an address…" },
              ...options.map((o) => ({ value: o, label: o })),
            ]} />
          {rows.length > 1 && !disabled && (
            <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded border hairline ink-3 transition hover:border-red-300 hover:bg-red-50 hover:text-red-500">
              <FiX size={12} />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" onClick={() => onChange([...rows, ""])}
          className="flex w-full items-center justify-center gap-1.5 rounded border hairline py-1 ink-3 transition surface-hover">
          <FiPlus size={13} />
        </button>
      )}
    </div>
  );
};

export const Err: React.FC<{ msg?: string }> = ({ msg }) =>
  msg ? <p className="mt-1 text-[11px] text-red-500">{msg}</p> : null;

// ─── Custom: Phase 1 / Phase 2 Proposal editor (the GUI's stacked Encryption + Authentication rows) ─
// `phase` decides the second column: phase1 pairs an AEAD cipher with a PRF; phase2 leaves an AEAD
// cipher standing alone (it authenticates itself), so its second dropdown disappears.
export const ProposalEditor: React.FC<{
  value: CustomProposalRow[]; onChange: (v: CustomProposalRow[]) => void;
  phase: "p1" | "p2"; currentColor: string;
}> = ({ value, onChange, phase }) => {
  const rows = value.length ? value : [{ enc: "aes256", auth: "sha256" }];
  const setAt = (i: number, patch: Partial<CustomProposalRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="w-full max-w-md space-y-2">
      {rows.map((r, i) => {
        const aead = isAEADCipher(r.enc);
        // phase1 AEAD → PRF options; anything with an auth column → hash options.
        const authOpts = aead ? CUSTOM_PRF_OPTIONS : CUSTOM_AUTH_OPTIONS;
        const showAuth = phase === "p1" || !aead;
        return (
          <div key={i} className="flex items-center gap-2">
            <MinimalSelect value={r.enc} ariaLabel="Encryption" className="w-full"
              onChange={(enc) => {
                // Keep the auth column valid when switching cipher families (AEAD⇄CBC).
                const nextAuth = phase === "p1" && isAEADCipher(enc)
                  ? (CUSTOM_PRF_OPTIONS.includes(r.auth) ? r.auth : "prfsha256")
                  : (!isAEADCipher(enc) && CUSTOM_AUTH_OPTIONS.includes(r.auth) ? r.auth : (isAEADCipher(enc) ? "" : "sha256"));
                setAt(i, { enc, auth: nextAuth });
              }}
              options={CUSTOM_ENC_OPTIONS.map((o) => ({ value: o, label: o.toUpperCase() }))} />
            {showAuth ? (
              <MinimalSelect value={r.auth} ariaLabel="Authentication" className="w-full"
                onChange={(v) => setAt(i, { auth: v })}
                options={authOpts.map((o) => ({ value: o, label: o.toUpperCase() }))} />
            ) : (
              <span className="w-full text-center text-[11px] italic ink-3">self-authenticated</span>
            )}
            {rows.length > 1 && (
              <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded border hairline ink-3 transition hover:border-red-300 hover:bg-red-50 hover:text-red-500">
                <FiX size={12} />
              </button>
            )}
          </div>
        );
      })}
      <button type="button" onClick={() => onChange([...rows, { enc: "aes256", auth: "sha256" }])}
        className="flex items-center gap-1.5 rounded border hairline px-3 py-1 text-[11px] font-semibold ink-2 transition surface-hover">
        <FiPlus size={12} /> Add
      </button>
    </div>
  );
};

// A wrapping checkbox grid of Diffie-Hellman groups — the GUI's Phase 1 / Phase 2 DH selector.
export const DHGroupGrid: React.FC<{
  value: number[]; onChange: (v: number[]) => void; currentColor: string;
}> = ({ value, onChange, currentColor }) => {
  const toggle = (g: number) => onChange(value.includes(g) ? value.filter((x) => x !== g) : [...value, g]);
  return (
    <div className="grid w-full max-w-md grid-cols-6 gap-1.5">
      {CUSTOM_DH_GROUPS.map((g) => {
        const on = value.includes(g);
        return (
          <button key={g} type="button" onClick={() => toggle(g)}
            className="rounded border px-1 py-1 text-[11px] font-semibold transition"
            style={{
              background: on ? currentColor : "transparent",
              color: on ? "white" : "#64748b",
              borderColor: on ? currentColor : "#cbd5e1",
            }}>{g}</button>
        );
      })}
    </div>
  );
};
