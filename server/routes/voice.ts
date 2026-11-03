import express, { Router } from "express";
import { getAudioDurationSeconds, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "../audio.js";
import type { AppConfig } from "../config.js";
import type { Db } from "../database.js";
import { ApiError, ProviderError } from "../errors.js";
import { logStage } from "../logging.js";
import { createRateLimit, ipKey } from "../rate-limit.js";
import { requireExactOrigin, requireVisitor } from "../security.js";
import type { AiProvider, SupportedAudioMimeType } from "../services/ai.js";

const audioMimeTypes = new Set<SupportedAudioMimeType>(["audio/webm", "audio/ogg"]);

export function voiceRoutes(db: Db, config: AppConfig, ai: AiProvider): Router {
  const router = Router();
  const originOnly = requireExactOrigin(config);
  const visitorOnly = requireVisitor(db, config);
  const transcribePerIp = createRateLimit(12, 60_000, ipKey);
  const transcribePerSession = createRateLimit(6, 60_000, (request) => request.visitorSession?.hash ?? ipKey(request));

  router.post("/voice/transcribe", originOnly, visitorOnly, transcribePerIp, transcribePerSession,
    express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }), async (request, response) => {
    const mimeType = (request.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (!audioMimeTypes.has(mimeType as SupportedAudioMimeType)) {
      throw new ApiError(415, "unsupported_audio_type", "Use WebM or Ogg audio to dictate your order.");
    }
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      throw new ApiError(400, "invalid_audio", "No recorded audio was received. Please record your order again.");
    }
    if (request.body.length > MAX_AUDIO_BYTES) {
      throw new ApiError(413, "audio_too_large", "That recording is too large. Please record a shorter clip and try again.");
    }
    const durationSeconds = getAudioDurationSeconds(request.body, mimeType as SupportedAudioMimeType);
    if (durationSeconds === null) {
      throw new ApiError(400, "invalid_audio", "That recording is invalid. Please record it again.");
    }
    if (durationSeconds > MAX_AUDIO_SECONDS) {
      throw new ApiError(413, "audio_too_long", "Recordings must be 20 seconds or shorter. Please record a shorter clip.");
    }

    logStage(request.requestId, "gemini_transcription", "start");
    try {
      const transcript = await ai.transcribeAudio(request.body, mimeType as SupportedAudioMimeType);
      if (!transcript.trim()) {
        logStage(request.requestId, "gemini_transcription", "failure");
        throw new ApiError(422, "no_speech", "No clear speech was detected. Please record your order again.");
      }
      logStage(request.requestId, "gemini_transcription", "success");
      response.json({ transcript });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logStage(request.requestId, "gemini_transcription", "failure", error);
      const status = error instanceof ProviderError ? error.httpStatus : 503;
      if (status === 400) throw new ApiError(400, "invalid_audio", "That recording could not be understood. Please record it again.");
      if (status === 413) throw new ApiError(413, "audio_too_long", "Recordings must be 20 seconds or shorter. Please record a shorter clip.");
      throw new ApiError(503, "transcription_unavailable", "Voice transcription is unavailable. Please type your order instead.");
    }
  });

  return router;
}
