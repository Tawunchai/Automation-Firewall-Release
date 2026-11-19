import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTime } from "./datetime";

// The point of this module is that its output does not depend on the machine's LOCALE, so the tests
// assert exact strings. They must still pass in any TIME ZONE, though — the formatter deliberately
// renders local time — so every fixture is built from local components rather than from a UTC
// string, which would shift by the offset and make these tests fail in Bangkok and pass in London.
const localDate = (h = 15, m = 11, s = 31) => new Date(2026, 7, 19, h, m, s);

describe("formatDateTime", () => {
  it("renders a Gregorian year, never a Buddhist one", () => {
    const out = formatDateTime(localDate());
    expect(out).toContain("2026");
    // 2569 is what a Thai-locale browser produced before the locale was pinned, and it is the
    // failure this module exists to prevent.
    expect(out).not.toContain("2569");
  });

  it("spells the month, so 19/08 can never be read as an American 8/19", () => {
    expect(formatDateTime(localDate())).toMatch(/^19 Aug 2026/);
  });

  it("uses a 24-hour clock", () => {
    const out = formatDateTime(localDate(15));
    expect(out).not.toMatch(/am|pm/i);
    expect(out).toContain("15:11:31");
  });

  it("keeps a 24-hour clock past noon rather than wrapping to 11pm", () => {
    expect(formatDateTime(localDate(23, 5, 9))).toContain("23:05:09");
  });

  it("accepts a Date, a string and an epoch alike", () => {
    const d = localDate();
    expect(formatDateTime(d)).toBe(formatDateTime(d.getTime()));
    expect(formatDateTime(d.toISOString())).toBe(formatDateTime(d));
  });

  // A report that prints "Invalid Date" in its header is not a report.
  it("falls back rather than printing Invalid Date", () => {
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("")).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
    expect(formatDateTime(undefined, "never")).toBe("never");
  });
});

describe("formatDate", () => {
  it("drops the time", () => {
    expect(formatDate(localDate())).toBe("19 Aug 2026");
  });
});

describe("formatTime", () => {
  it("keeps only the clock", () => {
    expect(formatTime(localDate())).toBe("15:11:31");
  });
});
