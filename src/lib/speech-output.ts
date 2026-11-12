export function speechOutputAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined" &&
    typeof SpeechSynthesisUtterance !== "undefined";
}

export function speakText(text: string, language?: "en-US" | "ja-JP"): Promise<void> {
  if (!speechOutputAvailable()) return Promise.reject(new Error("Speech playback is not available in this browser."));
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language ?? (/[\u3040-\u30ff\u3400-\u9fff]/u.test(text) ? "ja-JP" : navigator.language || "en-US");
  return new Promise((resolve, reject) => {
    utterance.onend = () => resolve();
    utterance.onerror = (event) => reject(new Error(event.error || "Speech playback failed."));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeech(): void {
  if (speechOutputAvailable()) window.speechSynthesis.cancel();
}
