import { normalizeCLI } from "./parsePrereqCLI";
import type { AVProfileForm } from "../../api/policyObject";
import { EMPTY_AV_FORM } from "../security-profiles/antivirus-form.logic";

// A parsed draft plus the profile's CURRENT name (the `edit "X"` key), so the wizard can find
// the existing profile even on a rename (the new name lives in form.name).
export type ParsedAV = { form: Partial<AVProfileForm>; target: string };

// Parses the first `config antivirus profile ... edit "<name>" ... next ... end` block from
// AI-generated FortiOS CLI into a partial AVProfileForm the AntiVirus wizard can prefill.
// Returns null when the text has no antivirus profile block (e.g. it's a policy/address
// suggestion) or when no profile name was found (spurious match).
//
// FortiOS 7.2 stores every AV setting PER-PROTOCOL inside nested `config http/ftp/smtp/...`
// sub-blocks — same shape the AI's system prompt teaches it to emit (see the AntiVirus
// section of backend/services/ai.go CLIReference) and the same shape the device write path
// uses (avProfilePayload in backend/services/fortigate.go). Field mapping per protocol:
//   set av-scan {block|monitor}          → protocol scan ON
//   set fortisandbox {block|monitor}     → "Send files to FortiSandbox for inspection"
//   set outbreak-prevention {block|...}  → "Use FortiGuard outbreak prevention database"
//   set external-blocklist {block|...}   → "Use external malware block list"
//   set quarantine enable                → "Quarantine"
//   set executables virus (smtp/pop3/imap) → "Treat Windows executables ... as viruses"
// Top-level: set mobile-malware-db {enable}, set ems-threat-feed {enable}.

type SubBlock = { name: string; body: string };

// Splits a profile body into its nested `config <proto> ... end` sub-blocks.
function extractSubBlocks(body: string): SubBlock[] {
  const blocks: SubBlock[] = [];
  const re = /config\s+([a-z0-9-]+)\b([\s\S]*?)\n\s*end\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    blocks.push({ name: m[1].toLowerCase(), body: m[2] });
  }
  return blocks;
}

// True when a `set <key> <value>` exists in `body` with a value other than disable/off.
function optionOn(body: string, key: string): boolean {
  const m = body.match(new RegExp(`set\\s+${key}\\s+([a-z0-9-]+)`, "i"));
  if (!m) return false;
  const v = m[1].toLowerCase();
  return v !== "" && v !== "disable";
}

function setValue(body: string, key: string): string | null {
  const m = body.match(new RegExp(`set\\s+${key}\\s+"?([a-z0-9-]+)"?`, "i"));
  return m ? m[1].toLowerCase() : null;
}

export function parseAntivirusFromCLI(cliText: string): ParsedAV | null {
  cliText = normalizeCLI(cliText);
  const cfg = cliText.match(/config\s+antivirus\s+profile\b([\s\S]*?)\n\s*end\b\s*$/i)
    ?? cliText.match(/config\s+antivirus\s+profile\b([\s\S]*)/i);
  if (!cfg) return null;

  const editMatch = cfg[1].match(/edit\s+"?([^"\n]+?)"?\s*\n([\s\S]*?)\n\s*next\b/i);
  if (!editMatch) return null;

  const target = editMatch[1].trim();
  const profileBody = editMatch[2];
  if (!target) return null;

  const subs = extractSubBlocks(profileBody);
  const byProto: Record<string, string> = {};
  for (const b of subs) byProto[b.name] = b.body;

  const protoScan = (p: string) => optionOn(byProto[p] ?? "", "av-scan");
  const anyProtoOn = (key: string) =>
    ["http", "ftp", "cifs", "smtp", "pop3", "imap"].some((p) => optionOn(byProto[p] ?? "", key));

  const form: Partial<AVProfileForm> = {
    name: target,
    http_scan: protoScan("http"),
    smtp_scan: protoScan("smtp"),
    pop3_scan: protoScan("pop3"),
    imap_scan: protoScan("imap"),
    ftp_scan:  protoScan("ftp"),
    cifs_scan: protoScan("cifs"),

    send_files_to_sandbox:   anyProtoOn("fortisandbox"),
    use_outbreak_db:         anyProtoOn("outbreak-prevention"),
    use_external_blocklist:  anyProtoOn("external-blocklist"),
    quarantine: ["http", "ftp", "cifs", "smtp", "pop3", "imap"]
      .some((p) => setValue(byProto[p] ?? "", "quarantine") === "enable"),

    treat_win_exec_as_virus: ["smtp", "pop3", "imap"]
      .some((p) => setValue(byProto[p] ?? "", "executables") === "virus"),
  };

  // Top-level (outside the per-protocol sub-blocks). Look at the profile body with the
  // sub-blocks stripped so a per-protocol value can't be mistaken for a top-level one.
  const topLevel = profileBody.replace(/config\s+[a-z0-9-]+\b[\s\S]*?\n\s*end\b/gi, "");
  const mm = setValue(topLevel, "mobile-malware-db");
  if (mm !== null) form.mobile_malware_protection = mm === "enable";
  form.use_ems_threat_feed = setValue(topLevel, "ems-threat-feed") === "enable";

  // A comment may be quoted with spaces.
  const cmt = profileBody.match(/set\s+comment\s+"([^"]*)"/i);
  if (cmt) form.comment = cmt[1];

  // A rename restates the name inside the block; otherwise the edit key is the name.
  const nameSet = profileBody.match(/set\s+name\s+"?([^"\n]+?)"?\s*$/im);
  if (nameSet) form.name = nameSet[1].trim();

  return { form, target };
}

// Merges a parsed partial draft over the blank defaults so every AVProfileForm field has a
// valid value the wizard can render immediately.
export function avDraftToForm(draft: Partial<AVProfileForm>): AVProfileForm {
  return { ...EMPTY_AV_FORM, ...draft };
}
