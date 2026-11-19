import React from "react";
import type { ChangeRequest } from "../../api/changeRequests";
import { describeAction } from "./model";

// The one line a reviewer is meant to read first: what this request DOES to the firewall.
//
// Built from the stored request — `method`, `path`, `resource_type`, `resource_key` — and never
// from prose. The server derives the row's title from the same fields; this is that derivation in
// the UI's own words, so it can be read in Thai or Chinese and can name the sub-route verbs the
// stored title flattens.
//
// Everything that came from the device or from the route (an mkey, a profile name, a resource type
// this page cannot name) is rendered inside <code>, which the i18n runtime passes through verbatim:
// a translated object name would be a lie about what is going to be written.

type Props = {
  request: Pick<ChangeRequest, "method" | "path" | "resource_type" | "resource_key">;
  /** "lg" for the detail dialog's headline, "sm" for a queue row. */
  size?: "sm" | "lg";
};

const ActionSummary: React.FC<Props> = ({ request, size = "sm" }) => {
  const a = describeAction(request);
  const text = size === "lg" ? "text-[14px]" : "text-[12px]";
  const mono = size === "lg" ? "text-[13px]" : "text-[11px]";

  return (
    <span className={`inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 ${text}`}>
      <span className="font-bold ink">{a.verb}</span>
      {a.recognised ? (
        <span className="ink">{a.noun}</span>
      ) : (
        <code className={`t-mono ${mono} ink-2`}>{request.resource_type}</code>
      )}
      {a.key !== "" && <code className={`t-mono ${mono} ink`}>{a.key}</code>}
      {a.bulk && <span className="chip chip-warn text-[10px]">several at once</span>}
    </span>
  );
};

export default ActionSummary;
