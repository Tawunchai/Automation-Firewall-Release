import { useCallback, useEffect, useRef, useState } from "react";
import { message } from "../../components/ui/toast";
import { getSpeechRecognition, isVoiceSecureContext, VOICE_INSECURE_MSG } from "./voice";
import type {
  SpeechRecognitionErrorEvent, SpeechRecognitionEvent, SpeechRecognitionInstance,
} from "./voice";

/**
 * Dictation for the AI composer: hold the browser's SpeechRecognition, write what it hears into
 * the composer, and explain every way it can refuse.
 *
 * Lifted out of the page component unchanged. The error branches are the reason this is worth its
 * own file — each one came from a real support round:
 *
 *  - an insecure origin is a HARD stop, not a warning. The browser refuses the microphone outright
 *    and fires `not-allowed` WITHOUT showing the permission prompt, so a click that got through
 *    only produced "allow it in Browser Settings" and sent people hunting for a permission that
 *    had never been denied there (see lan-https-voice).
 *  - `network` does not mean the microphone. Chrome's Web Speech API is not on-device: it streams
 *    the audio to Google's servers, so on a locked-down company LAN this is the likeliest failure
 *    once HTTPS is sorted, and the message has to say so.
 *
 * `input`/`setInput` are the composer's own state: dictation appends to whatever was already typed
 * rather than replacing it, which is what the snapshot taken at start is for.
 */
export function useVoiceInput(input: string, setInput: (v: string) => void) {
  const [listening, setListening] = useState(false);

  // Both are synchronous questions about the browser, asked once. They were a mount effect that
  // wrote two pieces of state, which meant the composer rendered its microphone button wrong and
  // then corrected it — and an effect whose only job is to set state on mount is the thing
  // react-hooks/set-state-in-effect is pointing at. A lazy initialiser answers before the first
  // paint instead.
  const [voiceSupported] = useState(() => !!getSpeechRecognition());
  const [voiceSecure] = useState(() => isVoiceSecureContext());

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const inputSnapshotRef = useRef("");

  useEffect(() => () => { recognitionRef.current?.abort(); }, []);

  /** Stop dictation without toggling it back on — what Send does before it takes the text. */
  const stopListening = useCallback(() => {
    if (!listening) return;
    recognitionRef.current?.stop();
    setListening(false);
  }, [listening]);

  const toggleListening = useCallback(() => {
    if (listening) { stopListening(); return; }
    const SR = getSpeechRecognition();
    if (!SR) { message.error("This browser does not support voice input — use Chrome or Edge"); return; }
    // Not a warning — a hard stop. The browser refuses the microphone outright on an insecure
    // origin and fires `not-allowed` WITHOUT ever showing the permission prompt, so letting the
    // click through only produced "กรุณาอนุญาตใน Browser Settings", which sent people hunting
    // through settings for a permission that was never denied there.
    if (!voiceSecure) { message.error(VOICE_INSECURE_MSG); return; }
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = "th-TH";
    inputSnapshotRef.current = input;
    rec.onstart = () => setListening(true);
    rec.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "", interimText = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      const prefix = inputSnapshotRef.current ? inputSnapshotRef.current + " " : "";
      setInput(prefix + finalText + interimText);
    };
    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      if (ev.error === "not-allowed" || ev.error === "permission-denied")
        message.error("Microphone access was denied — allow it in your browser settings");
      else if (ev.error === "network")
        // Chrome's Web Speech API is NOT on-device — it streams the audio to Google's servers and
        // gets the text back. So `network` here means the browser could not reach them, which on a
        // locked-down company LAN is the likeliest cause once HTTPS is already sorted.
        message.error(
          "Speech recognition failed — Chrome sends audio to Google's servers to transcribe it. " +
          "Check that this machine can reach the internet and that no firewall or proxy is blocking it."
        );
      else if (ev.error === "audio-capture")
        message.error("No microphone found — connect one and try again");
      else if (ev.error !== "no-speech" && ev.error !== "aborted")
        message.error(`Something went wrong: ${ev.error}`);
      setListening(false);
    };
    rec.onend = () => { setListening(false); recognitionRef.current = null; };
    recognitionRef.current = rec;
    rec.start();
  }, [listening, stopListening, input, voiceSecure, setInput]);

  return { listening, voiceSupported, voiceSecure, toggleListening, stopListening };
}
