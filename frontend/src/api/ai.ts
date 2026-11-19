import { aiApi, apiUrl, defaultHeaders } from "./http";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// An image attached to a chat message. `data` is base64 WITHOUT the `data:` URL prefix, and
// `media_type` is one of the four the Anthropic vision API accepts. The backend validates both
// (≤4 images per message, ≤4 MiB each) before they reach Claude.
export interface AttachedImage {
  media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  data: string;
}

// The model's impact analysis, as fields on the tool call rather than as a headed section inside
// the explanation prose.
//
// It used to be prose, and applyImpact.ts found it again with a regex over the model's free text.
// That read the dialog's most load-bearing section out of whatever shape the model happened to
// write — a translated heading, a bold variant, an extra sentence before the bullets, and the
// section came back empty with nothing to distinguish "no impact stated" from "stated in a shape
// we could not parse". Now the API guarantees the three fields on a config answer (`strict: true`),
// and the regex survives only as a fallback for an answer that carries no impact object.
export interface ConfigImpact {
  /** Subnets affected, as CIDR or network+mask. */
  subnets: string[];
  /** Which hosts / users / zones / interfaces this changes things for. */
  affected: string[];
  /** Where the policy must sit and what would shadow it; "-" when the answer creates no policy. */
  placement: string;
}

export interface ConfigSuggestion {
  commands: string[];
  explanation: string;
  warning?: string;
  // Present on mode="config" answers from the current backend; absent on query answers, on an
  // older persisted session, and if the model fills only the explanation.
  impact?: ConfigImpact;
  // "query" =  (get/show/diagnose) —  /config-deploys/query
  // "config" = a config change — applied via the REST device-proxy (or /config-deploys as a fallback)
  mode?: "config" | "query";
}

export interface GenerateConfigPayload {
  device_id: number;
  prompt: string;
  history?: ChatMessage[];
  // Attached images for the CURRENT turn only (never history). Sent to Claude as image content
  // blocks before the prompt text. Omitted/empty on a text-only request.
  images?: AttachedImage[];
}

// ── Streaming variant ────────────────────────────────────────────────────────
// The model needs ~30s to write a full multi-object proposal. Buffered, that is 30s of blank
// spinner; streamed, the text appears as it is written. Same result either way — the `done` event
// carries the identical, server-validated ConfigSuggestion.
//
// ⚠️ The `delta` text is a PREVIEW for display only. The CLI that gets deployed is the one on the
// resolved ConfigSuggestion (server-side it has been through signature-id validation and profile
// de-duplication). Never build a wizard draft out of accumulated deltas.
export type AIStreamEvent =
  | { type: "status"; phase: "device" | "model" }
  | { type: "delta"; explanation: string; cli: string } // both are text to APPEND
  | { type: "done"; data: ConfigSuggestion }
  | { type: "error"; error: string };

// EventSource cannot POST, so the SSE frames are read off a fetch() body stream by hand.
export const GenerateConfigStream = async (
  payload: GenerateConfigPayload,
  onEvent: (ev: AIStreamEvent) => void,
  signal?: AbortSignal
): Promise<ConfigSuggestion> => {
  const res = await fetch(`${apiUrl}/ai/generate-config/stream`, {
    method: "POST",
    credentials: "include",
    headers: defaultHeaders,
    body: JSON.stringify(payload),
    signal,
  });

  // Validation failures answer with ordinary JSON before the stream starts.
  if (!res.ok || !res.body) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent("session:expired"));
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `The AI assistant request failed (HTTP ${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done: ConfigSuggestion | null = null;
  let failure: string | null = null;

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });

    // SSE frames are separated by a blank line; a chunk can split one anywhere.
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);

      const dataLine = frame
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!dataLine) continue;

      // One decoded SSE frame. Every field is optional because which ones are present depends
      // on the event name two lines below, and `data` is handed on as a ConfigSuggestion by the
      // caller — the server's contract, not something this parser can check.
      let parsed: {
        phase?: string;
        explanation?: string;
        cli?: string;
        data?: unknown;
        error?: string;
      };
      try {
        parsed = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }
      const eventName = frame.split("\n").find((l) => l.startsWith("event:"))?.slice(6).trim();

      switch (eventName) {
        case "status":
          // The union is the SERVER's contract; this frame was parsed from JSON, so the cast
          // is the honest statement of where the guarantee comes from. It passes the value
          // through unchanged, as the `any` did.
          onEvent({ type: "status", phase: parsed.phase as "device" | "model" });
          break;
        case "delta":
          onEvent({ type: "delta", explanation: parsed.explanation ?? "", cli: parsed.cli ?? "" });
          break;
        case "done":
          done = parsed.data as ConfigSuggestion;
          onEvent({ type: "done", data: done });
          break;
        case "error":
          failure = parsed.error || "The AI request failed";
          onEvent({ type: "error", error: failure! });
          break;
      }
    }
  }

  if (failure) throw new Error(failure);
  if (!done) throw new Error("The model's answer was cut short — the connection dropped mid-stream. Please try again.");
  return done;
};

// ── AI:  automation  ─────────────────────────────────────
export interface DiagnosisResult {
  summary: string;
  likely_cause: string;
  suggested_fix: string;
  severity: "low" | "medium" | "high";
}

//  AutomationJob  FAILED  AI
export const DiagnoseJob = async (jobId: number): Promise<DiagnosisResult> => {
  const res = await aiApi.post<{ data: DiagnosisResult }>("/ai/diagnose-job", { job_id: jobId });
  return res.data.data;
};

// ── AI:  config deploy/query (diff/output) ────────────────────────────
export interface ExplainResult {
  summary: string;
  impact: string;
  next_steps: string;
}
