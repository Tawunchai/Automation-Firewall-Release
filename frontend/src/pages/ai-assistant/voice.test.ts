import { describe, expect, it, afterEach } from "vitest";
import { getSpeechRecognition, isVoiceSecureContext, VOICE_INSECURE_MSG } from "./voice";

// The microphone button is the one control on this page whose availability is decided entirely by
// the browser, and the two ways it can be unavailable look identical to a user: the constructor is
// missing, or the page is not a secure context. Both were unreachable from a test while they lived
// inside the 2,000-line component.
//
// The secure-context half matters on this deployment specifically: the console is reached by IP on
// a LAN, so a build served over plain HTTP has a mic button that fails with `not-allowed` before any
// permission prompt appears. That is why frontend/nginx serves HTTPS at all.

const w = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete w.SpeechRecognition;
  delete w.webkitSpeechRecognition;
});

describe("getSpeechRecognition", () => {
  it("is null when the browser has neither spelling", () => {
    expect(getSpeechRecognition()).toBeNull();
  });

  it("finds the unprefixed constructor", () => {
    const ctor = function () {};
    w.SpeechRecognition = ctor;
    expect(getSpeechRecognition()).toBe(ctor);
  });

  it("falls back to the webkit prefix, which is what Chromium actually ships", () => {
    const ctor = function () {};
    w.webkitSpeechRecognition = ctor;
    expect(getSpeechRecognition()).toBe(ctor);
  });

  it("prefers the unprefixed one when both are present", () => {
    const plain = function () {};
    const prefixed = function () {};
    w.SpeechRecognition = plain;
    w.webkitSpeechRecognition = prefixed;
    expect(getSpeechRecognition()).toBe(plain);
  });
});

describe("isVoiceSecureContext", () => {
  it("reports what the browser reports, rather than re-deriving it from the URL", () => {
    // The browser already treats localhost and 127.0.0.1 as secure; reimplementing that rule here
    // is how the check drifts from what getUserMedia will actually do.
    const original = window.isSecureContext;
    try {
      Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
      expect(isVoiceSecureContext()).toBe(true);
      Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
      expect(isVoiceSecureContext()).toBe(false);
    } finally {
      Object.defineProperty(window, "isSecureContext", { value: original, configurable: true });
    }
  });
});

describe("the message shown when voice cannot be used", () => {
  it("says what to do about it, not just that it failed", () => {
    // A user on http://10.0.x.x needs to know the page has to be served over HTTPS. "Voice
    // unavailable" would send them to check their microphone.
    expect(VOICE_INSECURE_MSG).toMatch(/https/i);
    expect(VOICE_INSECURE_MSG.length).toBeGreaterThan(20);
  });
});
