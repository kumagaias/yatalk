import type { AgAiEvent, AgLlmAdapter, AgLlmExecuteTurnOptions, AgLlmRequest, AgLlmResponse, AgLlmResponseHandler } from "ag-studio";
import { requestJson } from "./api";

export class AgStudioGeminiAdapter implements AgLlmAdapter {
  constructor(private readonly endpoint = "/api/organizer/studio/turn") {}

  executeTurn(request: AgLlmRequest, options?: AgLlmExecuteTurnOptions): AgLlmResponseHandler {
    const { model: _model, ...turn } = request;
    const complete = requestJson<AgLlmResponse>(this.endpoint, {
      method: "POST",
      body: JSON.stringify(turn),
      signal: options?.signal,
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
