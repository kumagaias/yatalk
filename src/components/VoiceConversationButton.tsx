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

const finishPhrase = /(?:以上です|以上で(?:す|ーす)?|これで全部|それで全部|これで以上です|注文は以上(?:です)?|終わりです|おわりです|that[’']s all|that[’']s it|that[’']s everything|i[’']m done|we[’']re done|i[’']m all set)[。.!！\s]*$/iu;

function spokenCopy(language?: "en-US" | "ja-JP") {
  return language === "ja-JP" ? {
    welcome: "いらっしゃいませ。ご注文をどうぞ。",
    addFirst: "まず、ご希望の商品をお聞かせください。",
    complete: "ありがとうございます。PayPalのQRコードを画面に表示しました。",
  } : {
    welcome: "Welcome! What would you like today?",
    addFirst: "Please tell me what you would like first.",
    complete: "Thank you. Your order is ready. The PayPal QR code is on the screen.",
  };
}

function splitFinishPhrase(text: string): { orderText: string; finished: boolean } {
  if (!finishPhrase.test(text.trim())) return { orderText: text.trim(), finished: false };
  return { orderText: text.trim().replace(finishPhrase, "").replace(/[、,。.!！\s]+$/u, ""), finished: true };
}

export function VoiceConversationButton({ onVoiceTurn, onFinishOrder, onUnsupported, speechLanguage, disabled = false }: {
  onVoiceTurn: (transcript: string) => Promise<string | null>;
  onFinishOrder: () => boolean;
  onUnsupported?: () => void;
  speechLanguage?: "en-US" | "ja-JP";
  disabled?: boolean;
}) {
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const copy = spokenCopy(speechLanguage);
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
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try { recognition?.abort(); } catch { /* The browser may already have ended recognition. */ }
    stopSpeech();
    setActive(false);
    setListening(false);
  }, []);

  const finish = useCallback(async () => {
    processingRef.current = false;
    if (!onFinishOrder()) {
      setError("Tell me an item before finishing the order.");
      try { await speakText(copy.addFirst, speechLanguage); } catch { /* Keep the visible message when speech playback is unavailable. */ }
      if (activeRef.current) startRef.current();
      return;
    }
    activeRef.current = false;
    setActive(false);
    setListening(false);
    setStatus("Preparing the PayPal QR code…");
    try { await speakText(copy.complete, speechLanguage); }
    catch { /* The order and QR flow continue even when speech playback is unavailable. */ }
  }, [copy.addFirst, copy.complete, onFinishOrder, speechLanguage]);

  const handleTranscript = useCallback(async (rawText: string) => {
    const { orderText, finished } = splitFinishPhrase(rawText);
    if (finished && !orderText) { await finish(); return; }
    const reply = await onVoiceTurn(orderText);
    if (reply) {
      setStatus("Speaking…");
      try { await speakText(reply, speechLanguage); }
      catch { setError("Voice playback is unavailable. The reply is shown as text."); }
    }
    if (finished) { await finish(); return; }
    processingRef.current = false;
    if (activeRef.current) {
      setStatus("Listening…");
      startRef.current();
    }
  }, [finish, onVoiceTurn]);

  const start = useCallback(() => {
    if (!activeRef.current) return;
    const recognitionConstructor = (window as RecognitionWindow).SpeechRecognition ??
      (window as RecognitionWindow).webkitSpeechRecognition;
    if (!recognitionConstructor) {
      activeRef.current = false;
      setActive(false);
      setError("Live voice ordering is not supported here. Use the microphone recorder or type instead.");
      onUnsupported?.();
      return;
    }
    const recognition = new recognitionConstructor();
    recognitionRef.current = recognition;
    recognition.lang = speechLanguage ?? (navigator.language?.toLowerCase().startsWith("en") ? "en-US" : "ja-JP");
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const finalText: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal && result[0]?.transcript.trim()) finalText.push(result[0].transcript.trim());
      }
      const transcript = finalText.join(" ").trim();
      if (!transcript || processingRef.current) return;
      processingRef.current = true;
      setListening(false);
      recognition.stop();
      void handleTranscript(transcript);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      setError(event.error === "not-allowed" ? "Allow microphone access to place a voice order." : "Voice recognition stopped. Retry or type your order.");
      activeRef.current = false;
      setActive(false);
      setListening(false);
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (!activeRef.current || processingRef.current) return;
      restartTimerRef.current = window.setTimeout(() => startRef.current(), 300);
    };
    try {
      recognition.start();
      setListening(true);
      setStatus(recognition.lang === "en-US" ? "Listening… Say “That’s all” when you are done." : "Listening… Say “以上です” when you are done.");
      setError("");
    } catch {
      recognitionRef.current = null;
      activeRef.current = false;
      setActive(false);
      setListening(false);
      setError("Microphone access is unavailable. Retry or type your order.");
    }
  }, [handleTranscript, onUnsupported, speechLanguage]);
  startRef.current = start;

  useEffect(() => () => stop(), [stop]);

  const toggle = () => {
    if (activeRef.current) { stop(); setStatus("Voice ordering stopped."); return; }
    setError("");
    activeRef.current = true;
    setActive(true);
    setStatus(copy.welcome);
    void speakText(copy.welcome, speechLanguage).catch(() => undefined).finally(() => {
      if (activeRef.current) startRef.current();
    });
  };

  return <div className="voice-conversation">
    <button className={`voice-session-button${active ? " active" : ""}`} type="button" onClick={toggle} aria-pressed={active} disabled={disabled && !active}>
      {active ? <MicOff size={23} aria-hidden="true" /> : <Mic size={23} aria-hidden="true" />}
      <span>{active ? "Stop voice order" : "Start voice order"}</span>
    </button>
    {status && <p className="voice-status" role="status">{status}</p>}
    {error && <p className="voice-error" role="alert">{error}</p>}
    <span className="sr-only">{listening ? "Microphone is listening" : "Microphone is not listening"}</span>
  </div>;
}
