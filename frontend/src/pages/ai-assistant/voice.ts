/**
 * The Web Speech API, as this console uses it.
 *
 * The DOM lib does not declare SpeechRecognition, so the shapes the page relies on are written out
 * here rather than as `any` at the call site. The two helpers below are the whole of the decision
 * about whether the microphone is available: the constructor is vendor-prefixed on Chromium, and
 * getUserMedia needs a SECURE CONTEXT — which on a LAN console reached by IP means the page has to
 * be served over HTTPS, or the button is there and silently never works.
 *
 * Split out of index.tsx (2,033 lines). Pure, and now reachable by a test.
 */
// ─── Web Speech API types ──────────────────────────────────────────────────────
export interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { readonly transcript: string; readonly confidence: number };
}
export interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
export interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
  readonly resultIndex: number;
}
export interface SpeechRecognitionErrorEvent extends Event { readonly error: string }
export interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void; abort(): void;
  onstart:  (() => void) | null;
  onend:    (() => void) | null;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror:  ((e: SpeechRecognitionErrorEvent) => void) | null;
}
/**
 * The constructor, under either of the two names browsers publish it as.
 *
 * Declared rather than asserted: `window as any` here switched off checking of the whole window
 * object to read two optional properties, and the thing it returns is then called with `new` —
 * so a wrong shape would fail at the first `start()`, not at the lookup.
 */
type SpeechRecognitionWindow = typeof window & {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
};

export const getSpeechRecognition = (): (new () => SpeechRecognitionInstance) | null => {
  const w = window as SpeechRecognitionWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

// Voice needs a SECURE CONTEXT. `localhost` counts as one by spec, which is why the microphone
// works while developing and stops dead once the app is opened by IP over HTTP on the LAN — the
// browser rejects it with `not-allowed` before any permission prompt appears.
//
// window.isSecureContext is the browser's own answer to the same question (it already treats
// localhost/127.0.0.1 as secure), so it is used instead of re-deriving the rule from the URL.
export const isVoiceSecureContext = (): boolean =>
  typeof window !== "undefined" && window.isSecureContext;

export const VOICE_INSECURE_MSG =
  "The microphone only works over HTTPS, and this page was opened over HTTP. " +
  "Open it via https:// (see README.md), or on localhost on the server itself.";
