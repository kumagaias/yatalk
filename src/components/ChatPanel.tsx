import { ArrowUp, MessageCircle, Mic, MicOff, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Cart, Product } from "../types";
import { postAudio } from "../lib/api";
import { Alert } from "./Feedback";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ChatResponse = { reply: string; clarification: string | null; cart: Cart };
type Props = {
  cart: Cart | null;
  mutationBusy: boolean;
  onSend: (message: string, history: ChatMessage[]) => Promise<ChatResponse>;
  products: Product[];
};
const MAX_AUDIO_BYTES = 256 * 1024;
const RECORDING_LIMIT_MS = 19_800;

export function ChatPanel({ cart, mutationBusy, onSend, products }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Welcome to the stall. Tell me what sounds good, and I’ll help build your order." },
  ]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastFailed, setLastFailed] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  const voiceIdRef = useRef("");
  const sendLockRef = useRef(false);
  const mountedRef = useRef(false);

  const logVoice = (stage: string, outcome: "start" | "success" | "failure", reason?: unknown) => {
    const errorName = reason instanceof Error ? reason.name : undefined;
    console.info(JSON.stringify({ timestamp: new Date().toISOString(), correlationId: voiceIdRef.current,
      stage, outcome, ...(errorName ? { errorName } : {}) }));
  };

  const releaseMicrophone = () => {
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      releaseMicrophone();
    };
  }, []);

  const transcribe = async (audio: Blob) => {
    if (audio.size > MAX_AUDIO_BYTES) {
      setTranscribing(false);
      setVoiceError("That recording is too large. Please record a shorter clip and try again.");
      logVoice("audio_validation", "failure");
      return;
    }
    const mimeType = audio.type.split(";", 1)[0]?.toLowerCase();
    if (!mimeType || !["audio/webm", "audio/ogg"].includes(mimeType)) {
      setTranscribing(false);
      setVoiceError("This browser recorded an unsupported format. Please type your order instead.");
      logVoice("audio_validation", "failure");
      return;
    }
    logVoice("gemini_transcription", "start");
    try {
      const result = await postAudio<{ transcript: string }>("/api/voice/transcribe", new Blob([audio], { type: mimeType }));
      if (typeof result.transcript !== "string" || !result.transcript.trim() || result.transcript.length > 800) {
        throw new Error("Invalid transcription response");
      }
      setValue(result.transcript);
      setVoiceStatus("Review the transcript, then send your order.");
      setVoiceError("");
      logVoice("gemini_transcription", "success");
    } catch (reason) {
      setVoiceError(reason instanceof Error ? reason.message : "Voice transcription failed. Please type your order instead.");
      setVoiceStatus("");
      logVoice("gemini_transcription", "failure", reason);
    } finally {
      setTranscribing(false);
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        setRecording(false);
        setTranscribing(true);
        setVoiceStatus("Transcribing your order…");
        logVoice("microphone_recording", "success");
        recorder.stop();
      }
      return;
    }
    if (busy || mutationBusy || transcribing) return;
    voiceIdRef.current = crypto.randomUUID();
    setVoiceError("");
    setVoiceStatus("");
    logVoice("microphone_permission", "start");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Voice recording is not supported by this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/ogg"];
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) throw new Error("This browser cannot record a supported audio format.");
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onerror = (event) => {
        const reason = event.error;
        setRecording(false);
        setTranscribing(false);
        setVoiceError("Recording stopped unexpectedly. Please try again or type your order.");
        logVoice("microphone_recording", "failure", reason);
        releaseMicrophone();
      };
      recorder.onstop = () => {
        const audio = new Blob(chunksRef.current, { type: recorder.mimeType });
        releaseMicrophone();
        if (audio.size === 0) {
          setTranscribing(false);
          setVoiceStatus("");
          setVoiceError("No speech was recorded. Please try again or type your order.");
          logVoice("microphone_recording", "failure");
          return;
        }
        void transcribe(audio);
      };
      recorder.start();
      setRecording(true);
      setVoiceStatus("Recording… Speak clearly, then stop to review the transcript.");
      logVoice("microphone_permission", "success");
      logVoice("microphone_recording", "start");
      stopTimerRef.current = window.setTimeout(() => {
        if (recorder.state !== "inactive") {
          setRecording(false);
          setTranscribing(true);
          setVoiceStatus("Recording limit reached. Transcribing your order…");
          logVoice("microphone_recording", "success");
          recorder.stop();
        }
      }, RECORDING_LIMIT_MS);
    } catch (reason) {
      if (!mountedRef.current) {
        releaseMicrophone();
        return;
      }
      setRecording(false);
      setTranscribing(false);
      setVoiceStatus("");
      setVoiceError(reason instanceof Error && reason.name === "NotAllowedError"
        ? "Microphone access was denied. Allow microphone access or type your order."
        : "Microphone recording is unavailable. Please type your order instead.");
      logVoice("microphone_permission", "failure", reason);
      releaseMicrophone();
    }
  };

  const send = async (text: string) => {
    if (!cart || !text.trim() || busy || mutationBusy || recording || transcribing || sendLockRef.current) return;
    sendLockRef.current = true;
    const userMessage = text.trim();
    const prior = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    setBusy(true);
    setError("");
    setLastFailed("");
    setVoiceStatus("");
    setMessages((current) => [...current, { role: "user", content: userMessage }]);
    setValue("");
    try {
      const result = await onSend(userMessage, prior);
      const answer = result.clarification ? `${result.reply} ${result.clarification}` : result.reply;
      setMessages((current) => [...current, { role: "assistant", content: answer }]);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Chat is taking a break. Check your order summary before retrying.";
      setMessages((current) => current.at(-1)?.role === "user" ? current.slice(0, -1) : current);
      setError(message);
      setLastFailed(userMessage);
      setValue(userMessage);
    } finally {
      sendLockRef.current = false;
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(value);
  };

  return (
    <section className="panel chat-panel" aria-labelledby="chat-heading">
      <div className="panel-heading">
        <div className="heading-icon chat-icon"><MessageCircle size={18} aria-hidden="true" /></div>
        <div><p className="eyebrow">A friendly helper</p><h2 id="chat-heading">Order by chat</h2></div>
        <span className="ai-badge"><Sparkles size={14} aria-hidden="true" />AI</span>
      </div>
      <div className="chat-thread" aria-live="polite" aria-label="Order conversation">
        {messages.map((message, index) => (
          <div className={`chat-message ${message.role}`} key={`${index}-${message.role}`}>
            {message.role === "assistant" && <span className="chat-avatar" aria-hidden="true">y</span>}
            <p>{message.content}</p>
          </div>
        ))}
        {busy && <p className="typing-indicator" role="status"><span /><span /><span />Thinking through the menu…</p>}
        <div ref={bottomRef} />
      </div>
      {products.length > 0 && !messages.some((message) => message.role === "user") && (
        <div className="suggestions"><span>Try:</span><button type="button" onClick={() => void send("Two yakisoba and one iced tea")} disabled={mutationBusy || busy}>“Two yakisoba and one iced tea”</button></div>
      )}
      {error && <Alert onRetry={() => void send(lastFailed)} retryDisabled={mutationBusy || busy || transcribing || recording}>{error}</Alert>}
      {voiceStatus && <p className="voice-status" role="status">{voiceStatus}</p>}
      {voiceError && <p className="voice-error" role="alert">{voiceError}</p>}
      <form className="chat-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-input">Describe what you’d like</label>
        <textarea id="chat-input" rows={2} maxLength={800} value={value} onChange={(event) => setValue(event.target.value)} placeholder="What are you in the mood for?" disabled={mutationBusy || busy || transcribing || !cart} />
        <button className={`voice-button${recording ? " recording" : ""}`} type="button" onClick={() => void toggleRecording()}
          aria-label={recording ? "Stop recording" : "Record an order"} aria-pressed={recording} disabled={busy || transcribing || (!recording && mutationBusy) || !cart}>
          {recording ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
        </button>
        <button className="send-button" type="submit" aria-label="Send message" disabled={!value.trim() || mutationBusy || busy || transcribing || recording || !cart}><ArrowUp size={20} aria-hidden="true" /></button>
      </form>
  <p className="chat-note">Audio is sent to Google Cloud for transcription. Yatalk does not store recordings. Review the text before sending.</p>
    </section>
  );
}
