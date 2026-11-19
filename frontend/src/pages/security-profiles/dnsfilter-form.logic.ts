// The pure half of dnsfilter-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { type DNSFilterProfileForm, type DNSFilterMetadata } from "../../api/policyObject";

export const EMPTY_DNSFILTER_FORM: DNSFilterProfileForm = {
  name: "", comment: "",
  redirect_botnet: false,
  safe_search: false,
  youtube_restrict: "strict",
  fortiguard_category_filter: true,
  categories: [],
  domain_filter: false,
  domain_filter_entries: [],
  external_ip_blocklist: false,
  external_ip_blocklist_names: [],
  dns_translation: false,
  dns_translation_entries: [],
  use_default_redirect_portal: true,
  redirect_portal_ip: "",
  allow_rating_error: false,
  log_all_domains: false,
};

export const DEFAULT_DNSFILTER_META: DNSFilterMetadata = {
  categories: [], web_filter_licensed: true, botnet_licensed: true, external_resources: [],
};

export const validateDNSFilterForm = (form: DNSFilterProfileForm): Record<string, string> => {
  const errs: Record<string, string> = {};
  if (!form.name.trim()) errs.name = "Name is required";
  if (!form.use_default_redirect_portal && !form.redirect_portal_ip.trim()) {
    errs.redirect_portal_ip = "Enter the portal IP, or switch back to Use FortiGuard Default";
  }
  return errs;
};
