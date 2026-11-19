// The pure half of appcontrol-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { type AppControlProfileForm } from "../../api/policyObject";

export const EMPTY_APPCONTROL_FORM: AppControlProfileForm = {
  name: "", comment: "",
  categories: [],
  unknown_application_action: "allow",
  network_protocol_enforcement: false,
  network_services: [],
  overrides: [],
  block_non_default_ports: false,
  allow_and_log_dns: true,
  replacement_messages: true,
};
