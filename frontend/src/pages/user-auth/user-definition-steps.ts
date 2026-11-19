import type React from "react";

import {
  UserTypeStep, LoginCredentialsStep, ContactInfoStep, ExtraInfoStep,
  type LocalUserFieldsProps,
} from "./user-definition-form";

// The wizard's four steps, in order, as a list the create page indexes by step number.
//
// A list of components is not itself a component, and it lived in user-definition-form.tsx beside
// the four it names — which made that file export both, and so not a fast-refresh boundary: every
// save reloaded the whole module and sent the wizard back to step one with the form empty, which
// is the state a person editing the form is trying to look at.
//
// It cannot go in the form's `.logic.ts` either, because it refers to the components. So it gets
// its own module: one export, no JSX, nothing to drift.
export const WIZARD_STEP_COMPONENTS: React.FC<LocalUserFieldsProps>[] = [
  UserTypeStep, LoginCredentialsStep, ContactInfoStep, ExtraInfoStep,
];
