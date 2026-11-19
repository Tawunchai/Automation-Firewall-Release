import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

// The emulator, configured once.
//
// Two panes on this page own a terminal now — the single-device shell and the multi-device
// broadcast console — and every option below was chosen for a reason that is easy to lose in a
// second copy: the font must be a literal stack because xterm measures characters on a canvas where
// a CSS variable does not resolve; convertEol must stay off because the device already sends CRLF;
// the refit must be guarded twice or it either blanks the screen or loops. One copy, so a fix
// lands in both places.

/** The GitHub-dark palette the page's chrome is built around. */
const THEME = {
  background: "#0d1117",
  foreground: "#c9d1d9",
  cursor: "#4ade80",
  cursorAccent: "#0d1117",
  selectionBackground: "#2d4f76",
  selectionForeground: "#ffffff",
  black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922",
  blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39c5cf", white: "#b1bac4",
  brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364",
  brightYellow: "#e3b341", brightBlue: "#79c0ff", brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd", brightWhite: "#f0f6fc",
};

/** A terminal with this console's options. Not yet attached to the DOM — see attachTerminal. */
export function createTerminal(): Terminal {
  return new Terminal({
    convertEol: false,          // the device sends CRLF; converting would double the newlines
    cursorBlink: true,
    cursorStyle: "bar",
    cursorInactiveStyle: "outline", // shows at a glance whether the terminal has focus
    // A literal stack, not `var(--font-mono)`. xterm measures a character by rendering it to a
    // canvas, and a CSS custom property does not resolve in that context — the fallback would be
    // used for measurement while the DOM used the real font, so every column would be a fraction
    // off and long lines would drift.
    fontFamily: '"Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.3,
    letterSpacing: 0.2,
    // 10,000 lines. `show full-configuration` is ~33k lines on this device; the useful property is
    // being able to scroll back through a long dump without holding all of it in memory.
    scrollback: 10000,
    // Terminal conventions people expect from PuTTY: selecting copies, and the right mouse button
    // pastes. Without these, copying config out of the shell means fighting the browser.
    rightClickSelectsWord: true,
    macOptionIsMeta: true,
    // Smooth rather than instant scroll on a big dump — much easier to follow, and cheap now that
    // the renderer is on the GPU.
    smoothScrollDuration: 60,
    theme: THEME,
  });
}

/**
 * Opens `term` on `host` and wires everything that has to follow the element around: the GPU
 * renderer, clickable links, copy-on-select, and a refit that survives both a hidden pane and a
 * collapsing sidebar. Returns the teardown.
 */
export function attachTerminal(term: Terminal, host: HTMLDivElement): () => void {
  const fit = new FitAddon();
  term.loadAddon(fit);
  // FortiOS output regularly carries URLs (FortiGuard, documentation); making them clickable is
  // free and saves retyping.
  term.loadAddon(new WebLinksAddon());
  term.open(host);

  // The GPU renderer. The DOM renderer creates one element per cell, which on a 33k-line
  // `show full-configuration` is where the browser starts dropping frames. Loaded after open()
  // because it needs the canvas to exist, and guarded because a machine with no WebGL context (a
  // VM, a locked-down browser) must fall back to the DOM renderer rather than lose the terminal.
  void (async () => {
    try {
      const { WebglAddon } = await import("@xterm/addon-webgl");
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());   // a lost context must not freeze the screen
      term.loadAddon(webgl);
    } catch { /* DOM renderer is a perfectly good fallback */ }
  })();

  // Copy on select, the way a terminal does. Scoped to the terminal, and only when there IS a
  // selection — otherwise a stray click would clear the clipboard.
  const selection = term.onSelectionChange(() => {
    const sel = term.getSelection();
    if (sel) void navigator.clipboard?.writeText(sel).catch(() => { /* denied; ignore */ });
  });

  // Refit on a frame, and only when the box actually has a size.
  //
  // Both guards earn their place. Calling fit() on a zero-height element makes xterm compute NaN
  // rows and blank the screen — which happens on the very first paint and whenever the pane is
  // hidden. And coalescing to one rAF stops a ResizeObserver notification that fires *during* a fit
  // from scheduling another one synchronously, which the browser reports as "ResizeObserver loop
  // completed with undelivered notifications".
  let frame = 0;
  const refit = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (host.clientHeight < 20 || host.clientWidth < 20) return;
      try { fit.fit(); } catch { /* mid-teardown */ }
    });
  };

  refit();
  window.addEventListener("resize", refit);
  // The pane also changes size when the sidebar collapses, which fires no window resize.
  const ro = new ResizeObserver(refit);
  ro.observe(host);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", refit);
    ro.disconnect();
    selection.dispose();
    term.dispose();
  };
}

/** The whole scrollback as plain text, trailing blank lines trimmed. */
export function terminalText(term: Terminal): string {
  const buf = term.buffer.active;
  const out: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    // translateToString(true) trims each line's trailing whitespace; xterm pads every line to the
    // full column width, so without it every line carries ~100 spaces.
    out.push(buf.getLine(i)?.translateToString(true) ?? "");
  }
  // The scrollback is allocated ahead of what has been written, so the tail is blank lines.
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}
