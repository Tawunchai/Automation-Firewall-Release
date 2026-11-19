import { describe, it, expect } from "vitest";
import { directionApplies, allowedFileTypes, PASSWORD_PROTECTED_FALLBACK } from "./file-filter-sections.logic";

// The rule drawer greys out Traffic when the chosen protocols can't carry a direction.
//
// Why: the CMDB schema says "Traffic direction (HTTP, FTP, SSH, CIFS only)." and the device
// enforces it silently — a mail-only rule (smtp/imap/pop3/mapi) sent with direction=outgoing
// comes back stored as "any" with a 200 OK. Verified live on FortiOS 7.2.10:
//   protocol=http  sent=outgoing -> stored=outgoing
//   protocol=smtp  sent=outgoing -> stored=any
//   protocol="http smtp" sent=outgoing -> stored=outgoing

describe("directionApplies", () => {
  it("is true for each protocol the device honours a direction on", () => {
    for (const p of ["http", "ftp", "ssh", "cifs"]) {
      expect(directionApplies([p])).toBe(true);
    }
  });

  it("is false for mail-only rules — the device forces those to Both", () => {
    expect(directionApplies(["smtp"])).toBe(false);
    expect(directionApplies(["imap"])).toBe(false);
    expect(directionApplies(["pop3"])).toBe(false);
    expect(directionApplies(["mapi"])).toBe(false);
    expect(directionApplies(["smtp", "imap", "pop3"])).toBe(false);
  });

  it("is true as soon as one direction-capable protocol is in the mix", () => {
    expect(directionApplies(["smtp", "http"])).toBe(true);
    expect(directionApplies(["pop3", "imap", "cifs"])).toBe(true);
  });

  it("is false for an empty selection", () => {
    expect(directionApplies([])).toBe(false);
  });

  it("ignores case", () => {
    expect(directionApplies(["HTTP"])).toBe(true);
    expect(directionApplies(["SMTP"])).toBe(false);
  });

  it("matches the six protocols the flow-mode GUI offers", () => {
    // The metadata endpoint returns exactly these (verified live).
    const guiProtocols = ["cifs", "ftp", "http", "imap", "pop3", "smtp"];
    const canDirect = guiProtocols.filter((p) => directionApplies([p]));
    expect(canDirect).toEqual(["cifs", "ftp", "http"]);
  });
});

// "Password-protected only" narrows the file-type datasource at runtime — the schema doesn't say
// so. Verified live on FortiOS 7.2.10 by trying all 56 antivirus.filetype names with
// password-protected=yes: 6 passed, the other 50 returned "-3 entry not found in datasource".
describe("allowedFileTypes", () => {
  const all = ["7z", "bat", "exe", "gif", "msoffice", "msofficex", "pdf", "rar", "tar", "zip"];
  const pp = ["7z", "msoffice", "msofficex", "pdf", "rar", "zip"];

  it("offers the whole catalogue while the toggle is off", () => {
    expect(allowedFileTypes(false, all, pp)).toEqual(all);
  });

  it("narrows to the password-capable formats when the toggle is on", () => {
    expect(allowedFileTypes(true, all, pp)).toEqual(["7z", "msoffice", "msofficex", "pdf", "rar", "zip"]);
  });

  it("drops the types the device would reject with -3", () => {
    const narrowed = allowedFileTypes(true, all, pp);
    for (const rejected of ["exe", "bat", "gif", "tar"]) {
      expect(narrowed).not.toContain(rejected);
    }
  });

  it("intersects with the device catalogue so it never offers a type the device lacks", () => {
    // A device whose catalogue has no rar/msoffice must not be offered them.
    expect(allowedFileTypes(true, ["zip", "7z", "exe"], pp)).toEqual(["zip", "7z"]);
  });

  it("falls back to the known-good list when the metadata omits it", () => {
    expect(allowedFileTypes(true, all, [])).toEqual(["7z", "msoffice", "msofficex", "pdf", "rar", "zip"]);
    expect(PASSWORD_PROTECTED_FALLBACK).toEqual(["7z", "msoffice", "msofficex", "pdf", "rar", "zip"]);
  });

  it("falls back rather than returning nothing when the catalogue is empty", () => {
    expect(allowedFileTypes(true, [], pp)).toEqual(PASSWORD_PROTECTED_FALLBACK);
  });

  it("ignores case when intersecting", () => {
    expect(allowedFileTypes(true, ["ZIP", "EXE"], pp)).toEqual(["ZIP"]);
  });
});
