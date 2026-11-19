// wizardImpact — the same "what am I about to do to this firewall?" summary the chat's Apply shows,
// built from a WIZARD's form instead of from the AI's CLI.
//
// WHY A SECOND BUILDER
// summarizeApplyImpact reads CLI text, because that is all the chat button has. A wizard has
// something better: the form the user has been editing, plus what it already knows about the device
// (whether the object exists, which prerequisites are missing, where the policy will sit). So the
// wizard dialog can say things the chat one cannot — above all whether this Apply CREATES an object
// or WRITES OVER one that is already in production.
//
// Both builders produce the same ApplyImpact and feed the same ApplyConfirmModal, and the policy
// vocabulary itself (policyImpact / policyEffectLine / policyWarnings) is shared, so the two dialogs
// cannot end up describing the same policy in two different ways.

import type { PolicyFormState } from "../firewall-policy/create.logic";
import type { AppliedKind } from "./applyViaREST";
import {
  policyEffectLine, policyImpact, policyWarnings,
  type ApplyImpact, type ImpactObject,
} from "./applyImpact";

/** What one wizard is about to write. */
export type WizardObjectSpec = {
  kind: AppliedKind;
  /** Human label, as the chat's ✓ lines spell it ("Address", "Web Filter", "User Group"). */
  label: string;
  name: string;
  /** True when the object is already on the device and Apply will overwrite it. */
  isEdit: boolean;
  /** Short "field: value" lines identifying what is being written. Two or three at most. */
  facts?: string[];
  /** Anything else this object type changes, in the wizard's own words. */
  effects?: string[];
  warnings?: string[];
  /** Objects this Apply creates FIRST, in the order it creates them (Policy Wizard). */
  prerequisites?: ImpactObject[];
};

// What each kind of object does — and, more usefully, what it does NOT do on its own. A profile or
// an address that nothing references changes no traffic whatsoever, and a dialog that says
// "AntiVirus will be created" without that is how someone ends up believing traffic is being
// scanned when it is not.
const KIND_EFFECT: Partial<Record<AppliedKind, string>> = {
  address: "This object changes no traffic until a policy references it",
  service: "This object changes no traffic until a policy references it",
  schedule: "This time window does nothing until a policy sets its schedule to this name",
  "virtual-ip": "A VIP opens nothing until a policy accepts it (destination = this VIP) — creating the VIP alone does not forward a port",
  antivirus: "The profile inspects nothing until a policy references it",
  webfilter: "The profile inspects nothing until a policy references it",
  dnsfilter: "The profile inspects nothing until a policy references it",
  "application-control": "The sensor inspects nothing until a policy references it",
  "file-filter": "The profile inspects nothing until a policy references it",
  user: "This account can sign in to nothing until it is put in a group that a policy or a VPN references",
  "user-group": "This group does nothing until a policy or a VPN references it",
  "ldap-server": "This server authenticates nobody until a user group references it",
  "radius-server": "This server authenticates nobody until a user group references it",
};

/**
 * objectApplyImpact — the dialog for every wizard that writes ONE object.
 *
 * The single most important thing it establishes is create vs overwrite. An edit is the dangerous
 * case: the object is already in production, everything referencing it picks up the new settings the
 * moment Apply lands, and nothing on the wizard screen otherwise says so.
 */
export function objectApplyImpact(spec: WizardObjectSpec): ApplyImpact {
  const { kind, label, name, isEdit, facts = [], prerequisites = [] } = spec;

  const effects: string[] = [
    isEdit
      ? `Overwrites the existing ${label} "${name}" on the device — the previous values of the edited fields are lost`
      : `Creates a new ${label} "${name}" on the device`,
    ...facts,
    ...(spec.effects ?? []),
  ];
  // The "nothing references this yet" line is true of a CREATE only: an edit lands on an object that
  // may well be referenced by a live policy right now, which is the opposite situation.
  const kindEffect = KIND_EFFECT[kind];
  if (!isEdit && kindEffect) effects.push(kindEffect);

  const warnings = [...(spec.warnings ?? [])];
  if (isEdit) {
    warnings.push(
      `This edits an existing object rather than creating one — every policy that references ${label} "${name}" picks up the new values the moment you apply`,
    );
  }

  return {
    mode: isEdit ? "edit" : "create",
    transport: "rest",
    destructive: false,
    objects: [...prerequisites, { kind, label, name }],
    policies: [],
    effects,
    warnings,
    // Unlike the chat, the wizard has already asked the device whether this name exists — that check
    // is what decided isEdit — so it can state the answer instead of hedging.
    note: isEdit
      ? `Checked: a ${label} with this name already exists on the device, so this apply overwrites rather than creates`
      : `Checked: no ${label} with this name is on the device, so this apply creates a new one`,
    aiImpact: [],
  };
}

/** Where the Policy Wizard's placement step will put the rule. */
export type PlacementSummary = {
  /** Name of the policy this one goes ABOVE. Empty/undefined = bottom of its interface pair. */
  beforeName?: string | null;
  /** True when the placement step is locked because a sibling policy is already on the device. */
  locked?: boolean;
};

/**
 * policyApplyImpact — the Policy Wizard's dialog.
 *
 * Richer than the chat's on two counts, because the wizard knows things the CLI text does not:
 *   · the prerequisites it is about to auto-create (addresses, services, schedule, profiles), which
 *     land on the device BEFORE the policy and stay there even if the policy itself then fails;
 *   · where the rule will actually sit. The chat can only warn "it goes to the bottom"; here the
 *     user picked a position, so the dialog names the policy it will sit above. On a first-match
 *     firewall that is the difference between a rule that works and one that never runs.
 */
export function policyApplyImpact(args: {
  form: PolicyFormState;
  isEdit: boolean;
  prerequisites: ImpactObject[];
  placement: PlacementSummary;
}): ApplyImpact {
  const { form, isEdit, prerequisites, placement } = args;
  const policy = policyImpact(form.name, form);

  const effects: string[] = [
    isEdit
      ? `Edits the existing policy "${form.name}" on the device`
      : `Creates a new policy "${form.name}" on the device`,
    policyEffectLine(policy),
  ];
  if (prerequisites.length) {
    effects.push(
      `Creates the ${prerequisites.length} object(s) this policy references first ` +
      `(${prerequisites.map((p) => `${p.label} "${p.name}"`).join(", ")}), then the policy itself`,
    );
  }
  if (!form.enabled) {
    effects.push("This policy is set to disabled — it will be created but will not affect any traffic");
  }

  const warnings = policyWarnings(policy);
  warnings.push(
    placement.beforeName
      ? `Placement: above policy "${placement.beforeName}" — FortiGate matches top to bottom (first match wins)`
      : "Placement: bottom of this interface pair — if a broader policy sits above it, this one never matches",
  );
  if (placement.locked) {
    warnings.push("The position is locked to this answer's order because the sibling policies have already been created");
  }
  if (prerequisites.length) {
    warnings.push(
      "Objects created first stay on the device even if the policy fails at the next step — " +
      "use Fallback in the chat to clean them up",
    );
  }

  return {
    mode: isEdit ? "edit" : "create",
    transport: "rest",
    destructive: false,
    objects: [...prerequisites, { kind: "policy", label: "Policy", name: form.name }],
    policies: [policy],
    effects,
    warnings,
    note: prerequisites.length
      ? "The entries above the policy are objects the device does not have yet; they are created first, in this order"
      : (isEdit
        ? `Checked: policy "${form.name}" already exists on the device, so this apply edits it`
        : `Checked: policy "${form.name}" is not on the device, so this apply creates it`),
    aiImpact: [],
  };
}
