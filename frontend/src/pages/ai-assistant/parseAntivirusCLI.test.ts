import { describe, it, expect } from "vitest";
import { parseAntivirusFromCLI, avDraftToForm } from "./parseAntivirusCLI";

// The AntiVirus parser, whose whole difficulty is that FortiOS 7.2 stores every setting
// PER-PROTOCOL while the form shows most of them as one switch.
//
// "Send files to FortiSandbox" is one checkbox in the GUI and six `set fortisandbox` lines on the
// device (http, ftp, cifs, smtp, pop3, imap). So the parser has to collapse six values into one
// boolean, and the per-protocol sub-blocks have to be read as sub-blocks: `set av-scan block`
// inside `config http` means HTTP scanning, and the same line at the top level means nothing at
// all. Getting that wrong does not fail — it shows the user a wizard with the wrong boxes ticked,
// which they then apply.

const NL = String.fromCharCode(10);
const cli = (...lines: string[]) => lines.join(NL);

const FULL = cli(
  "config antivirus profile",
  '    edit "AV-Office"',
  '        set comment "scan web and mail"',
  "        set feature-set flow",
  "        config http",
  "            set av-scan block",
  "            set outbreak-prevention block",
  "        end",
  "        config smtp",
  "            set av-scan monitor",
  "            set executables virus",
  "        end",
  "        config ftp",
  "            set av-scan disable",
  "        end",
  "        set mobile-malware-db enable",
  "    next",
  "end",
);

describe("parseAntivirusFromCLI", () => {
  it("reads the profile name off the edit key", () => {
    const p = parseAntivirusFromCLI(FULL);
    expect(p).not.toBeNull();
    expect(p!.target).toBe("AV-Office");
    expect(p!.form.name).toBe("AV-Office");
    expect(p!.form.comment).toBe("scan web and mail");
  });

  it("turns a per-protocol av-scan into that protocol's switch and no other", () => {
    const f = parseAntivirusFromCLI(FULL)!.form;
    expect(f.http_scan).toBe(true);
    expect(f.smtp_scan).toBe(true);  // "monitor" is still scanning — it logs instead of blocking
    expect(f.ftp_scan).toBe(false);  // explicitly disabled
    expect(f.pop3_scan).toBe(false); // no sub-block at all
    expect(f.imap_scan).toBe(false);
    expect(f.cifs_scan).toBe(false);
  });

  it("collapses a feature set on ANY protocol into the one switch the form shows", () => {
    const f = parseAntivirusFromCLI(FULL)!.form;
    // outbreak-prevention appears on http only, and the form has a single checkbox for it.
    expect(f.use_outbreak_db).toBe(true);
    expect(f.send_files_to_sandbox).toBe(false);
    expect(f.use_external_blocklist).toBe(false);
  });

  it("reads `executables virus`, which only exists on the mail protocols", () => {
    expect(parseAntivirusFromCLI(FULL)!.form.treat_win_exec_as_virus).toBe(true);
  });

  it("does not mistake a per-protocol value for a top-level one", () => {
    // THE TRAP. `set mobile-malware-db` is top-level; if the sub-blocks are not stripped first, a
    // per-protocol line with the same shape sets the wrong field.
    const sneaky = cli(
      "config antivirus profile",
      '    edit "AV-X"',
      "        config http",
      "            set av-scan block",
      "            set mobile-malware-db enable",
      "        end",
      "    next",
      "end",
    );
    expect(parseAntivirusFromCLI(sneaky)!.form.mobile_malware_protection).toBeUndefined();
    // …while the real top-level line is read.
    expect(parseAntivirusFromCLI(FULL)!.form.mobile_malware_protection).toBe(true);
  });

  it("reads a rename: the edit key is the old name, `set name` the new one", () => {
    const renamed = cli(
      "config antivirus profile",
      '    edit "AV-Old"',
      '        set name "AV-New"',
      "        config http",
      "            set av-scan block",
      "        end",
      "    next",
      "end",
    );
    const p = parseAntivirusFromCLI(renamed)!;
    expect(p.target).toBe("AV-Old"); // what the wizard must look up on the device
    expect(p.form.name).toBe("AV-New");
  });

  it("returns null for CLI with no antivirus profile in it", () => {
    expect(parseAntivirusFromCLI("")).toBeNull();
    expect(parseAntivirusFromCLI(cli(
      "config firewall policy",
      "    edit 0",
      '        set av-profile "default"',
      "    next",
      "end",
    ))).toBeNull();
  });

  it("treats a numeric edit key as the name, because that is what the device stores", () => {
    // A profile is keyed by NAME on FortiOS, so `edit 0` is not "auto-assign" here the way it is
    // for a policy — it really would create a profile called "0". The parser reports what the CLI
    // says rather than guessing; the wizard shows the user that name before anything is applied.
    expect(parseAntivirusFromCLI(cli(
      "config antivirus profile",
      "    edit 0",
      "        config http",
      "            set av-scan block",
      "        end",
      "    next",
      "end",
    ))!.target).toBe("0");
  });

  it("reads a profile whose block was truncated before the outer end", () => {
    const truncated = cli(
      "config antivirus profile",
      '    edit "AV-Cut"',
      "        config http",
      "            set av-scan block",
      "        end",
      "    next",
    );
    const p = parseAntivirusFromCLI(truncated);
    expect(p!.form.name).toBe("AV-Cut");
    expect(p!.form.http_scan).toBe(true);
  });
});

describe("avDraftToForm", () => {
  it("fills every field the draft did not mention", () => {
    const form = avDraftToForm({ name: "AV-1", http_scan: true });
    expect(form.name).toBe("AV-1");
    expect(form.http_scan).toBe(true);
    // The wizard renders immediately, so nothing may be undefined.
    expect(form.smtp_scan).toBe(false);
    expect(form.quarantine).toBe(false);
  });
});
