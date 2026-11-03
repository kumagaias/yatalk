import { GoogleGenAI, type GenerateContentParameters } from "@google/genai";
import { z } from "zod";
import { chatModelOutputSchema, type ChatModelOutput } from "../../shared/schemas.js";
import type { AppConfig } from "../config.js";
import { ProviderError } from "../errors.js";
import type { Cart } from "../inventory.js";
import { getAudioDurationSeconds, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "../audio.js";

export interface ChatContext {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  cart: Cart;
  products: Array<{ id: string; name: string; description: string; available: number; dietaryNote: string }>;
}

export type SupportedAudioMimeType = "audio/webm" | "audio/ogg";

export interface AiProvider {
  interpretCart(context: ChatContext): Promise<ChatModelOutput>;
  explainFacts(question: string, facts: unknown): Promise<string>;
  transcribeAudio(audio: Buffer, mimeType: SupportedAudioMimeType): Promise<string>;
}

type JsonSchema = Record<string, unknown>;
type GeminiRequest = GenerateContentParameters;
export type GeminiModelCall = (request: GeminiRequest) => Promise<string>;

const chatJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    reply: { type: "string" },
    clarification: { type: ["string", "null"] },
    operations: {
      type: "array", items: {
        type: "object", properties: {
          action: { type: "string", enum: ["add", "set", "remove"] },
          productId: { type: "string" }, quantity: { type: "integer", minimum: 0, maximum: 20 },
        }, required: ["action", "productId", "quantity"], additionalProperties: false,
      }, maxItems: 12,
    },
  },
  required: ["reply", "clarification", "operations"], additionalProperties: false,
};

const organizerJsonSchema: JsonSchema = {
  type: "object", properties: { answer: { type: "string" } },
  required: ["answer"], additionalProperties: false,
};

const transcriptJsonSchema: JsonSchema = {
  type: "object", properties: { transcript: { type: "string" } },
  required: ["transcript"], additionalProperties: false,
};

const organizerAnswerSchema = z.object({ answer: z.string().trim().min(1).max(500) }).strict();
const transcriptSchema = z.object({ transcript: z.string().trim().max(800) }).strict();

function createModelCall(config: AppConfig): GeminiModelCall {
  if (!config.googleCloudProject) {
    return async () => { throw new ProviderError("gemini", "configuration", true, 503); };
  }
  const client = new GoogleGenAI({
    vertexai: true,
    project: config.googleCloudProject,
    location: config.googleCloudLocation,
    apiVersion: "v1",
    httpOptions: { apiVersion: "v1", timeout: 20_000, retryOptions: { attempts: 1 } },
  });
  return async (request) => {
    const response = await client.models.generateContent(request);
    return response.text ?? "";
  };
}

function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  if (!text.trim()) throw new Error("Gemini returned no text");
  return schema.parse(JSON.parse(text) as unknown);
}

export class GeminiVertex implements AiProvider {
  private readonly generate: GeminiModelCall;
  private readonly model: string;

  constructor(config: AppConfig, generate?: GeminiModelCall) {
    this.generate = generate ?? createModelCall(config);
    this.model = config.geminiModel;
  }

  async interpretCart(context: ChatContext): Promise<ChatModelOutput> {
    const history = context.history
      .filter(({ role }, index) => index !== 0 || role !== "assistant")
      .map(({ role, content }) => ({ role: role === "assistant" ? "model" : "user", parts: [{ text: content }] }));
    const contents = [
      ...history,
      { role: "user", parts: [{ text: JSON.stringify({
        request: context.message,
        currentCart: context.cart.items.map(({ id, quantity }) => ({ productId: id, quantity })),
        menu: context.products,
      }) }] },
    ];
    try {
      const output = await this.generate({
        model: this.model,
        contents,
        config: {
          systemInstruction: "You help a visitor order from a market menu. Return a concise reply and only cart operations using product IDs in the supplied menu. Ask a clarification and return no operations when the request is ambiguous. Never invent products or claim an operation succeeded; the server will validate each operation. Do not discuss prices, payment, refunds, organizer data, or actions outside cart editing. For remove, quantity must be 0. For add/set, quantity must be 1 through 20. If the user asks about allergens, use only the supplied dietary notes and advise asking the stall organizer when a note is missing or unclear.",
          responseMimeType: "application/json",
          responseJsonSchema: chatJsonSchema,
          maxOutputTokens: 450,
        },
      });
      return parseJson(output, chatModelOutputSchema);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("gemini", "cart_intent", false);
    }
  }

  async explainFacts(question: string, facts: unknown): Promise<string> {
    try {
      const output = await this.generate({
        model: this.model,
        contents: JSON.stringify({ question, facts }),
        config: {
          systemInstruction: "Answer the organizer's question using only the supplied database facts. Do not invent or recalculate numbers. If the facts do not answer the question, state that there is no matching data. Be concise and never propose payment, refund, or stock changes.",
          responseMimeType: "application/json",
          responseJsonSchema: organizerJsonSchema,
          maxOutputTokens: 220,
        },
      });
      return parseJson(output, organizerAnswerSchema).answer;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("gemini", "organizer_answer", false);
    }
  }

  async transcribeAudio(audio: Buffer, mimeType: SupportedAudioMimeType): Promise<string> {
    if (!audio.length) throw new ProviderError("gemini", "transcription_input", true, 400);
    if (audio.length > MAX_AUDIO_BYTES) throw new ProviderError("gemini", "transcription_input", true, 413);
    const durationSeconds = getAudioDurationSeconds(audio, mimeType);
    if (durationSeconds === null) throw new ProviderError("gemini", "transcription_input", true, 400);
    if (durationSeconds > MAX_AUDIO_SECONDS) throw new ProviderError("gemini", "transcription_duration", true, 413);
    try {
      const output = await this.generate({
        model: this.model,
        contents: [{ role: "user", parts: [
          { text: "Transcribe only the words spoken in this audio in the original language. Return the exact spoken order request, preserving product names and quantities. Do not answer the request or add commentary. If the audio has no intelligible speech, return an empty transcript." },
          { inlineData: { data: audio.toString("base64"), mimeType } },
        ] }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: transcriptJsonSchema,
          maxOutputTokens: 450,
        },
      });
      return parseJson(output, transcriptSchema).transcript;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("gemini", "transcription", false);
    }
  }
}
