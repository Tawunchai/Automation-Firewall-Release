import { normalizeCLI } from "./parsePrereqCLI";
import { maskToPrefix } from "./fgFormat";
import { BLANK_ROUTE_FORM, type RouteFormState } from "../static-routes/route-form.logic";

// A parsed static-route draft plus the route's CURRENT seq-num on the device (the
// `edit <n>` key), so the wizard can locate an existing route for an update. target is
// "" for a brand-new route (`edit 0` or a seq that doesn't exist yet).
export type ParsedRoute = { form: Partial<RouteFormState>; target: string };

type CLIStatement = { key: string; tokens: string[] };

function parseSetLine(line: string): CLIStatement | null {
  const m = line.match(/^\s*set\s+([a-z0-9-]+)\s+(.*)$/i);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const rest = m[2].trim();
  const quoted = [...rest.matchAll(/"([^"]*)"/g)].map((mm) => mm[1]);
  const tokens = quoted.length > 0 ? quoted : rest.split(/\s+/).filter(Boolean);
  return { key, tokens };
}

// Normalizes a FortiOS `set dst` value into a form-friendly string. FortiOS emits
// "10.0.0.0 255.255.255.0" (ip + mask); convert to CIDR ("10.0.0.0/24") when the mask is
// contiguous, otherwise keep "ip/mask". A bare "0.0.0.0/0" or CIDR passes through.
function normalizeDst(tokens: string[]): string {
  if (tokens.length >= 2) {
    const [ip, mask] = tokens;
    const prefix = maskToPrefix(mask);
    return prefix != null ? `${ip}/${prefix}` : `${ip}/${mask}`;
  }
  return tokens[0] ?? "";
}

// Parses the first `config router static ... edit <n> ... next ... end` block from
// AI-generated FortiOS CLI into a partial RouteFormState the Static Route wizard can
// prefill. Field mapping mirrors routeInputToWrite()/buildStaticRoutePayload in
// backend/services/fortigate.go + controller/policyobject/device_route.go.
export function parseRouteFromCLI(cliText: string): ParsedRoute | null {
  cliText = normalizeCLI(cliText);
  const configMatch = cliText.match(/config\s+router\s+static\b([\s\S]*?)\n\s*end\b/i)
    ?? cliText.match(/config\s+router\s+static\b([\s\S]*)/i);
  if (!configMatch) return null;

  const editMatch = configMatch[1].match(/edit\s+"?(\d+)"?\s*\n([\s\S]*?)(?:\n\s*next\b|$)/i);
  if (!editMatch) return null;

  const seq = parseInt(editMatch[1], 10);
  const body = editMatch[2];
  // seq 0 = "let FortiOS auto-assign" → a brand-new route (no existing target).
  const target = seq > 0 ? String(seq) : "";

  const draft: Partial<RouteFormState> = { dstType: "subnet" };
  let sawDst = false;

  for (const rawLine of body.split("\n")) {
    const stmt = parseSetLine(rawLine);
    if (!stmt) continue;
    const { key, tokens } = stmt;
    const val = tokens[0] ?? "";

    switch (key) {
      case "dst":
        draft.dst = normalizeDst(tokens);
        draft.dstType = "subnet";
        sawDst = true;
        break;
      case "internet-service": {
        const id = parseInt(val, 10);
        if (!Number.isNaN(id) && id > 0) {
          draft.dstType = "internet-service";
          draft.internetService = id;
        }
        break;
      }
      case "gateway":
        // FortiGate stores an unset gateway as 0.0.0.0 — treat that as blank.
        draft.gateway = val === "0.0.0.0" ? "" : val;
        break;
      case "device":
        if (val) draft.device = val;
        break;
      case "blackhole":
        if (val === "enable") { draft.device = "blackhole"; }
        break;
      case "distance":
        if (val) draft.distance = val;
        break;
      case "priority":
        if (val) draft.priority = val;
        break;
      case "status":
        draft.enabled = val !== "disable";
        break;
      case "comment":
      case "comments":
        draft.comment = tokens.join(" ");
        break;
      default:
        break;
    }
  }

  // Nothing routable was described → not a real route block.
  if (!sawDst && draft.dstType !== "internet-service" && draft.device !== "blackhole") return null;

  return { form: draft, target };
}

// Merges a parsed partial draft over blank defaults (or over an existing route for edit).
export function routeDraftToForm(
  draft: Partial<RouteFormState>,
  base: RouteFormState = BLANK_ROUTE_FORM,
): RouteFormState {
  return { ...base, ...draft };
}
