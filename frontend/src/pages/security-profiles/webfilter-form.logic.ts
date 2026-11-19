// The pure half of webfilter-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { EMPTY_WEBFILTER_OVERRIDE, type WebFilterProfileForm, type WebFilterMetadata } from "../../api/policyObject";

export const EMPTY_WEBFILTER_FORM: WebFilterProfileForm = {
  name: "", comment: "",
  fortiguard_category_filter: false,
  allow_override: false,
  block_invalid_urls: false,
  url_filter: false,
  block_malicious_fortisandbox: false,
  content_filter: false,
  allow_rating_error: false,
  rate_by_domain_and_ip: false,
  http_post_action: "allow",
  remove_cookies: false,
  categories: [],
  override: EMPTY_WEBFILTER_OVERRIDE,
  url_filter_entries: [],
  content_filter_entries: [],
};

export const EMPTY_WEBFILTER_METADATA: WebFilterMetadata = {
  categories: [], local_categories: [], web_filter_licensed: true, user_groups: [], profiles: [],
};
