import React from "react";
import Tooltip from "../../components/ui/Tooltip";
import {
  FiSend, FiSquare, FiMic, FiMicOff, FiX, FiDatabase, FiImage,
} from "react-icons/fi";
import { MAX_IMAGES, type PendingImage } from "./attachImages";
import { type QueryContext } from "./chat-model";
import { VOICE_INSECURE_MSG } from "./voice";
import type { NetworkDevice } from "../../api/device";

/**
 * The composer: the text box, its attachments, the microphone, the captured-CLI-context chip and
 * Send / Stop.
 *
 * Lifted out of the page component unchanged, for its size rather than its complexity — the page
 * was over both of this repo's file ratchets and this is one of the two self-contained halves of
 * its chat panel (the other is ChatTranscript).
 *
 * It owns no state. Everything it shows is handed to it, and everything it does goes back out
 * through a callback — which keeps the question "what is the composer allowed to change?"
 * answerable from this props list alone.
 */
export type ComposerProps = {
  accentGrad: string;
  currentColor: string;

  /** The device the question will be asked about; nothing can be sent without one. */
  selectedDevice: NetworkDevice | null;
  deviceId: number | null;

  /** An answer is arriving: Send becomes Stop. */
  asking: boolean;

  /** The draft, and the two ways it changes: typing, and ↑/↓ through what was already sent. */
  input: string;
  setInput: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  histIdx: number;
  setHistIdx: (n: number) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;

  /** Attachments carried to the vision API with the next message. */
  images: PendingImage[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  addFiles: (files: File[]) => void;
  onPasteComposer: (e: React.ClipboardEvent) => void;
  removeImage: (id: string) => void;

  /** CLI output captured from a Run Query, offered to the next question as context. */
  queryCtx: QueryContext | null;
  setQueryCtx: (c: QueryContext | null) => void;

  /** Dictation — see ./useVoiceInput for why `voiceSecure` is a hard stop rather than a warning. */
  listening: boolean;
  voiceSupported: boolean;
  voiceSecure: boolean;
  toggleListening: () => void;

  onSend: (overridePrompt?: string) => void;
  stopAnswer: () => void;
};

export const ChatComposer: React.FC<ComposerProps> = (ctx) => {
  const {
    accentGrad, currentColor, selectedDevice, deviceId, asking,
    input, setInput, inputRef, histIdx, setHistIdx, onKeyDown,
    images, fileInputRef, addFiles, onPasteComposer, removeImage,
    queryCtx, setQueryCtx, listening, voiceSupported, voiceSecure, toggleListening,
    onSend, stopAnswer,
  } = ctx;

  return (
    <>
          {/* Input area */}
          <div className="border-t hairline-2 p-3 shrink-0">

            {/* Auto-Context banner — shows when CLI output is ready to inject */}
            {queryCtx && (
              <div className="mb-2 flex items-center gap-2 rounded-[5px] border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-500/20 dark:bg-blue-500/8">
                <FiDatabase size={12} className="shrink-0 text-blue-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                    📊 CLI output attached — the model will see this live device data automatically
                  </p>
                  {queryCtx.cmd && (
                    <p className="text-[10px] text-blue-500 dark:text-blue-400 truncate">
                      Command: {queryCtx.cmd}
                    </p>
                  )}
                </div>
                <button type="button" onClick={() => setQueryCtx(null)}
                  className="shrink-0 text-blue-400 hover:text-blue-600 transition">
                  <FiX size={13} />
                </button>
              </div>
            )}

            {/* Listening indicator */}
            {listening && (
              <div className="mb-2 flex items-center gap-2 rounded-[5px] border border-red-200 bg-red-50 px-3 py-1.5 dark:border-red-500/20 dark:bg-red-500/8">
                <div className="flex items-center gap-0.5 shrink-0">
                  {[0, 120, 240].map((delay) => (
                    <div key={delay} className="h-3 w-1 rounded-full bg-red-500 animate-bounce"
                      style={{ animationDelay: `${delay}ms` }} />
                  ))}
                </div>
                <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                  Listening… tap the microphone again, or press Send when you are done
                </span>
              </div>
            )}

            {/* Attached-image thumbnails — removable, shown until Send carries them to the model. */}
            {images.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {images.map((im) => (
                  <div key={im.id} className="group relative h-16 w-16 overflow-hidden rounded-[6px] border hairline">
                    <img src={im.dataUrl} alt={im.name} title={im.name} className="h-full w-full object-cover" draggable={false} />
                    <button type="button" onClick={() => removeImage(im.id)} title="Remove"
                      className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100">
                      <FiX size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Hidden picker behind the image button below. */}
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
              multiple className="hidden"
              onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void addFiles(fs); }} />

            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); if (histIdx !== -1) setHistIdx(-1); }}
                onKeyDown={onKeyDown}
                onPaste={onPasteComposer}
                placeholder={selectedDevice
                  ? `Ask ${selectedDevice.name} anything… (Enter to send, Shift+Enter for a new line)`
                  : "Pick a device first"}
                disabled={!deviceId}
                rows={2}
                className="flex-1 resize-none rounded-[5px] border hairline surface-card px-3 py-2 text-[13px] ink outline-none transition disabled:opacity-50"
                style={{
                  maxHeight: 120,
                  borderColor: listening ? "var(--flow-deny)" : undefined,
                  boxShadow:   listening ? "0 0 0 2px color-mix(in srgb, var(--flow-deny) 20%, transparent)" : undefined,
                }}
              />

              {/* Attach image — pick files; paste (Ctrl+V) into the box also works. */}
              <Tooltip title={
                !deviceId ? "Pick a device first"
                : images.length >= MAX_IMAGES ? `Up to ${MAX_IMAGES} images per message`
                : "Attach an image (or paste a screenshot)"
              }>
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  disabled={!deviceId || asking || images.length >= MAX_IMAGES}
                  className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[5px] border hairline surface-card ink-2 surface-hover transition disabled:opacity-50">
                  <FiImage size={15} />
                  {images.length > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                      style={{ background: currentColor }}>{images.length}</span>
                  )}
                </button>
              </Tooltip>

              {/* Voice button */}
              {voiceSupported && (
                <Tooltip title={
                  !voiceSecure ? VOICE_INSECURE_MSG
                  : !deviceId ? "Pick a device first"
                  : listening ? "Listening… click to stop"
                  : "Click to speak"
                }>
                  <button type="button" onClick={toggleListening} disabled={!deviceId || asking || !voiceSecure}
                    className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[5px] transition disabled:opacity-50 ${
                      listening
                        ? "bg-red-500 text-white shadow-lg shadow-red-500/30"
                        : "border hairline surface-card ink-2 surface-hover"
                    }`}>
                    {listening ? <FiMicOff size={15} /> : <FiMic size={15} />}
                    {listening && <span className="absolute inset-0 rounded-[5px] animate-ping bg-red-400 opacity-40" />}
                  </button>
                </Tooltip>
              )}

              {/* Send — and, while an answer is being written, Stop.
                  It is the same button because it is the same place the user is already looking.
                  The only other way to abandon a 50-second answer used to be Clear, which empties
                  the whole conversation: there was no way to say "not this one" without also
                  throwing away everything that had been established. Stop keeps the transcript
                  (the question stays in it) and discards only the half-written answer, which is a
                  preview and was never deployable. */}
              {asking ? (
                <Tooltip title="Stop writing this answer — the conversation is kept">
                  <button onClick={stopAnswer} aria-label="Stop generating"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[5px] border hairline-2 ink-2 transition surface-hover">
                    <FiSquare size={13} className="fill-current" />
                  </button>
                </Tooltip>
              ) : (
                <button onClick={() => onSend()} disabled={!deviceId}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[5px] text-white transition disabled:opacity-50"
                  style={{ background: accentGrad }}>
                  <FiSend size={15} />
                </button>
              )}
            </div>
          </div>
    </>
  );
};
