import { Mic, MicOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { speakText, stopSpeech } from "../lib/speech-output";

type RecognitionAlternative = { transcript: string };
type RecognitionResult = ArrayLike<RecognitionAlternative> & { isFinal: boolean };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionError = { error: string };
type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionError) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionWindow = Window & {
  SpeechRecognition?: new () => RecognitionLike;
  webkitSpeechRecognition?: new () => RecognitionLike;
};

export function VoiceAssistantButton({ onVoiceTurn, disabled = false }: {
  onVoiceTurn: (transcript: string) => Promise<string | null>;
  disabled?: boolean;
}) {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const activeRef = useRef(false);
  const processingRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const startRef = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    activeRef.current = false;
    processingRef.current = false;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
    try { recognitionRef.current?.abort(); } catch { /* Recognition can already be closed. */ }
    recognitionRef.current = null;
    stopSpeech();
    setActive(false);
  }, []);

  const start = useCallback(() => {
    if (!activeRef.current) return;
    const Recognition = (window as RecognitionWindow).SpeechRecognition ?? (window as RecognitionWindow).webkitSpeechRecognition;
    if (!Recognition) {
      activeRef.current = false;
      setActive(false);
      setError("Live voice chat is not supported in this browser. You can still type a question.");
      return;
    }
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = navigator.language?.toLowerCase().startsWith("ja") ? "ja-JP" : "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length - event.resultIndex }, (_, offset) => event.results[event.resultIndex + offset])
        .filter((result) => result?.isFinal && result[0]?.transcript.trim())
        .map((result) => result![0]!.transcript.trim()).join(" ").trim();
      if (!transcript || processingRef.current) return;
      processingRef.current = true;
      recognition.stop();
      setStatus("Checking your live shop data…");
      void onVoiceTurn(transcript).then(async (reply) => {
        if (!reply) return;
        setStatus("Speaking…");
        try { await speakText(reply); }
        catch { setError("Voice playback is unavailable. The reply is still shown in the chat."); }
      }).catch(() => undefined).finally(() => {
        processingRef.current = false;
        if (activeRef.current) {
          setStatus("Listening… Ask another question, or press Stop.");
          startRef.current();
        }
      });
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      activeRef.current = false;
      setActive(false);
      setError(event.error === "not-allowed" ? "Allow microphone access to use voice chat." : "Voice recognition stopped. Retry or type your question.");
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (!activeRef.current || processingRef.current) return;
      restartTimerRef.current = window.setTimeout(() => startRef.current(), 300);
    };
    try {
      recognition.start();
      setStatus("Listening… Ask about sales, pickups, stock, or tomorrow.");
      setError("");
    } catch {
      recognitionRef.current = null;
      activeRef.current = false;
      setActive(false);
      setError("Microphone access is unavailable. Retry or type your question.");
    }
  }, [onVoiceTurn]);
  startRef.current = start;

  useEffect(() => () => stop(), [stop]);

  const toggle = () => {
    if (activeRef.current) {
      stop();
      setStatus("Voice chat stopped.");
      return;
    }
    activeRef.current = true;
    setActive(true);
    setError("");
    setStatus("Starting voice chat…");
    startRef.current();
  };

  return <div className="voice-assistant">
    <button className={`text-button voice-assistant-button${active ? " active" : ""}`} type="button" onClick={toggle} disabled={disabled && !active} aria-pressed={active}>
      {active ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
      {active ? "Stop voice chat" : "Ask by voice"}
    </button>
    {status && <p className="voice-assistant-status" role="status">{status}</p>}
    {error && <p className="voice-assistant-error" role="alert">{error}</p>}
  </div>;
}
