import { normalizeCLI } from "./parsePrereqCLI";
import type { ScheduleForm, ScheduleType } from "../../api/policyObject";

// A parsed schedule draft plus the schedule's CURRENT name (the `edit "X"` key), so the wizard
// can locate an existing object even on a rename (the new name lives in form.name).
export type ParsedSchedule = { form: ScheduleForm; target: string };

// The CLI keyword is "firewall schedule <recurring|onetime|group>". FortiOS also accepts the CMDB
// dotted form "firewall.schedule" in some contexts, so tolerate either. Capture the sub-table.
const SCHEDULE_BLOCK =
  /config\s+firewall[.\s]schedule\s+(recurring|onetime|group)\b([\s\S]*?)\n\s*end\b/i;
const SCHEDULE_BLOCK_OPEN =
  /config\s+firewall[.\s]schedule\s+(recurring|onetime|group)\b([\s\S]*)/i;

function parseSetLine(line: string): { key: string; tokens: string[] } | null {
  const m = line.match(/^\s*set\s+([a-z0-9-]+)\s+(.*)$/i);
  if (!m) return null;
  const rest = m[2].trim();
  const quoted = [...rest.matchAll(/"([^"]*)"/g)].map((mm) => mm[1]);
  const tokens = quoted.length > 0 ? quoted : rest.split(/\s+/).filter(Boolean);
  return { key: m[1].toLowerCase(), tokens };
}

// parseScheduleEdit converts one `edit "<name>" … next` body of a known type into a ParsedSchedule.
// Field mapping mirrors buildSchedulePayload() in backend/services/fortigate.go.
function parseScheduleEdit(type: ScheduleType, target: string, body: string): ParsedSchedule | null {
  if (!target) return null;
  const form: ScheduleForm = { name: target, type };
  const days: string[] = [];
  const members: string[] = [];

  for (const line of body.split("\n")) {
    const stmt = parseSetLine(line);
    if (!stmt) continue;
    const { key, tokens } = stmt;
    switch (key) {
      case "name":
        if (tokens[0]) form.name = tokens[0]; // rename → new name
        break;
      case "day":
        // "set day monday tuesday" → weekday tokens
        for (const t of tokens) {
          const d = t.toLowerCase();
          if (["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].includes(d)) {
            days.push(d);
          }
        }
        break;
      case "start":
        // recurring "hh:mm" | onetime "hh:mm yyyy/mm/dd" — keep the whole value verbatim
        form.start = tokens.join(" ");
        break;
      case "end":
        form.end = tokens.join(" ");
        break;
      case "member":
        members.push(...tokens);
        break;
      case "expiration-days":
      case "expiration_days":
        form.expiration_days = parseInt(tokens[0], 10) || 0;
        break;
      case "color": {
        const idx = parseInt(tokens[0], 10);
        if (!Number.isNaN(idx) && idx >= 0 && idx <= 32) form.color = idx;
        break;
      }
      default:
        break;
    }
  }

  if (type === "recurring") form.day = days;
  if (type === "group") form.member = members;
  return { form, target };
}

// Parses the FIRST schedule block from AI CLI into a ParsedSchedule the Schedule wizard can prefill.
export function parseScheduleFromCLI(cliText: string): ParsedSchedule | null {
  cliText = normalizeCLI(cliText);
  const block = cliText.match(SCHEDULE_BLOCK) ?? cliText.match(SCHEDULE_BLOCK_OPEN);
  if (!block) return null;
  const type = block[1].toLowerCase() as ScheduleType;
  const editMatch = block[2].match(/edit\s+"?([^"\n]+?)"?\s*\n([\s\S]*?)\n\s*next\b/i);
  if (!editMatch) return null;
  return parseScheduleEdit(type, editMatch[1].trim(), editMatch[2]);
}

// parseAllSchedulesFromCLI extracts EVERY schedule block across all three tables — so a suggestion
// that defines several schedules yields all of them. Used to auto-create a referenced-but-missing
// schedule when the user jumps straight to the Policy Wizard and hits Apply.
export function parseAllSchedulesFromCLI(cliText: string): ParsedSchedule[] {
  cliText = normalizeCLI(cliText);
  const out: ParsedSchedule[] = [];
  // Walk every "config firewall schedule <type> … end" block in order.
  const blockRe = /config\s+firewall[.\s]schedule\s+(recurring|onetime|group)\b([\s\S]*?)\n\s*end\b/gi;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(cliText)) !== null) {
    const type = bm[1].toLowerCase() as ScheduleType;
    const editRe = /edit\s+"?([^"\n]+?)"?\s*\n([\s\S]*?)\n\s*next\b/gi;
    let em: RegExpExecArray | null;
    while ((em = editRe.exec(bm[2])) !== null) {
      const parsed = parseScheduleEdit(type, em[1].trim(), em[2]);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

// scheduleDraftToForm normalises a parsed draft into a complete ScheduleForm for creation.
export function scheduleDraftToForm(draft: ScheduleForm): ScheduleForm {
  return {
    name: draft.name,
    type: draft.type,
    start: draft.start,
    end: draft.end,
    day: draft.day,
    expiration_days: draft.expiration_days,
    member: draft.member,
    color: draft.color ?? 0,
  };
}
