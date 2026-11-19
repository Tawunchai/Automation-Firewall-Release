import React, { useCallback, useMemo, useRef, useState } from "react";
import { message } from "../../components/ui/toast";
import { fileToPendingImage, MAX_IMAGES, type PendingImage } from "./attachImages";
import type { ChatItem } from "./chat-model";

/**
 * The AI composer's own two behaviours: the images attached to the next message, and ↑/↓ through
 * the prompts already sent.
 *
 * Both are about the text box and nothing else — neither touches the device, the job or the
 * transcript — so they come out of the page component together. Lifted unchanged.
 *
 * ── Why ↑ is conditional ───────────────────────────────────────────────────
 *
 * From a fresh composer, ↑ recalls a prompt only when the caret is at the very start, so editing
 * a multi-line draft is never hijacked. Once you ARE walking history every ↑/↓ keeps walking it,
 * and typing (onChange, in the page) drops back out. The live draft is stashed on the way in, so
 * ↓ past the newest restores whatever was half-typed rather than clearing it.
 */
export function useComposerInput(opts: {
  items: ChatItem[];
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
}) {
  const { items, input, setInput, onSend } = opts;

  // Screenshots the user pastes / drops / picks, carried to Claude's vision API with the next
  // message. Held only until Send (then cleared); the sent copy lives on the user's chat bubble.
  const [images, setImages] = useState<PendingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // histIdx walks the user's own past messages, newest first; -1 means "not navigating". The live
  // draft is stashed so ↓ past the newest restores whatever was half-typed.
  const [histIdx, setHistIdx] = useState(-1);
  const histDraftRef = useRef("");

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const room = MAX_IMAGES - images.length;
    if (room <= 0) { message.warning(`You can attach up to ${MAX_IMAGES} images per message`); return; }
    const take = files.slice(0, room);
    if (files.length > room) message.warning(`Only ${room} more image${room > 1 ? "s" : ""} could be added (max ${MAX_IMAGES})`);
    const results = await Promise.allSettled(take.map(fileToPendingImage));
    const ok: PendingImage[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") ok.push(r.value);
      else message.error(r.reason?.message ?? "Could not attach that image");
    }
    if (ok.length) setImages((prev) => [...prev, ...ok].slice(0, MAX_IMAGES));
  }, [images.length]);

  const onPasteComposer = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) { e.preventDefault(); void addFiles(files); }
  }, [addFiles]);

  const removeImage = useCallback(
    (id: string) => setImages((prev) => prev.filter((im) => im.id !== id)),
    [],
  );

  // The user's own past prompts, oldest→newest — what ↑ walks back through.
  const sentPrompts = useMemo(
    () => items.filter((it) => it.role === "user").map((it) => it.text),
    [items],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); return; }

    const ta = e.currentTarget;
    // ↑ recalls the previous prompt. From a fresh composer it only fires when the caret is at the
    // very start, so editing a multi-line draft is never hijacked; once you are walking history,
    // every ↑/↓ keeps walking it. Typing anything (onChange) drops back out of history mode.
    if (e.key === "ArrowUp") {
      const navigating = histIdx !== -1;
      const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
      if (sentPrompts.length === 0 || (!navigating && !atStart)) return;
      e.preventDefault();
      if (!navigating) histDraftRef.current = input; // stash the live draft to restore later
      const nextIdx = navigating ? Math.max(0, histIdx - 1) : sentPrompts.length - 1;
      setHistIdx(nextIdx);
      setInput(sentPrompts[nextIdx]);
    } else if (e.key === "ArrowDown") {
      if (histIdx === -1) return;
      e.preventDefault();
      if (histIdx >= sentPrompts.length - 1) {
        setHistIdx(-1);
        setInput(histDraftRef.current); // past the newest → back to what was being typed
      } else {
        const nextIdx = histIdx + 1;
        setHistIdx(nextIdx);
        setInput(sentPrompts[nextIdx]);
      }
    }
  };

  return {
    images, setImages, fileInputRef, addFiles, onPasteComposer, removeImage,
    histIdx, setHistIdx, onKeyDown,
  };
}
