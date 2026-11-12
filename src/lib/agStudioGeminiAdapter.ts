import type { AgAiEvent, AgLlmAdapter, AgLlmExecuteTurnOptions, AgLlmRequest, AgLlmResponse, AgLlmResponseHandler } from "ag-studio";
import { requestJson } from "./api";

export function restoreStudioThoughtSignatures(input: AgLlmRequest["input"], signatures: ReadonlyMap<string, string>): AgLlmRequest["input"] {
  return input.map((item) => {
    const candidate = item as unknown as { type?: unknown; callId?: unknown; thoughtSignature?: unknown };
    if (candidate.type !== "function_call" || typeof candidate.callId !== "string" || typeof candidate.thoughtSignature === "string") return item;
    const thoughtSignature = signatures.get(candidate.callId);
    return thoughtSignature ? { ...item, thoughtSignature } : item;
  });
}

export class AgStudioGeminiAdapter implements AgLlmAdapter {
  private readonly thoughtSignatures = new Map<string, string>();

  constructor(private readonly endpoint = "/api/organizer/studio/turn") {}

  executeTurn(request: AgLlmRequest, options?: AgLlmExecuteTurnOptions): AgLlmResponseHandler {
    const { model: _model, input, ...turn } = request;
    const complete = requestJson<AgLlmResponse>(this.endpoint, {
      method: "POST",
      body: JSON.stringify({ ...turn, input: restoreStudioThoughtSignatures(input, this.thoughtSignatures) }),
      signal: options?.signal,
    }).then((response) => {
      for (const item of response.output) {
        const candidate = item as unknown as { type?: unknown; callId?: unknown; thoughtSignature?: unknown };
        if (candidate.type === "function_call" && typeof candidate.callId === "string" && typeof candidate.thoughtSignature === "string") {
          this.thoughtSignatures.set(candidate.callId, candidate.thoughtSignature);
        }
      }
      return response;
    });

    return {
      complete,
      stream: {
        async *[Symbol.asyncIterator](): AsyncIterator<AgAiEvent> {
          const response = await complete;
          for (const item of response.output) {
            if (item.type === "message") {
              const text = item.content.flatMap((part) => part.type === "text" ? [part.text] : part.type === "refusal" ? [part.refusal] : []).join("\n");
              if (text) yield { type: "TEXT_MESSAGE_CHUNK", messageId: item.id, role: "assistant", delta: text };
            } else if (item.type === "function_call") {
              yield { type: "TOOL_CALL_CHUNK", toolCallId: item.callId, toolCallName: item.name, delta: item.arguments };
            }
          }
        },
      },
    };
  }
}
