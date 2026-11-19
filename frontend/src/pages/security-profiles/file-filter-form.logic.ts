// The pure half of file-filter-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { type FileFilterProfileForm } from "../../api/policyObject";

export const EMPTY_FILE_FILTER_FORM: FileFilterProfileForm = {
  name: "", comment: "", scan_archive_contents: true, rules: [],
};
