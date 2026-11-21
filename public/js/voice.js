// Voice: dictation, read-aloud, and simple voice commands.
//
// Cost-conscious defaults: the device's own speech engines are used first
// (free). The premium ElevenLabs voice runs only when the server has it
// configured AND the user picked it in Settings, and only on an explicit tap.

import * as api from "./api.js";

const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

export function capabilities(premiumAvailable) {
  const secure = globalThis.isSecureContext === true;
  const canRecord = secure && typeof globalThis.MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  return {
    secure,
    deviceSpeech: "speechSynthesis" in globalThis,
    deviceRecognition: secure && Boolean(Recognition),
    premiumDictation: premiumAvailable && canRecord,
    premiumSpeech: premiumAvailable,
  };
}

function micErrorMessage(error) {
  const name = error?.name || error?.error || "";
  if (name === "NotAllowedError" || name === "not-allowed" || name === "service-not-allowed") {
    return "Microphone access is blocked. Allow the microphone for this site in your browser settings.";
  }
  if (name === "NotFoundError" || name === "audio-capture") return "No microphone was found on this device.";
  if (name === "no-speech") return "Didn't hear anything. Tap the mic and try again.";
  if (name === "network") return "Speech recognition needs an internet connection.";
  return "Voice input didn't work. You can type instead.";
}

// ---------- dictation ----------

/**
 * Starts one dictation session. Returns a controller with stop(). The final
 * transcript is delivered to onText; status strings go to onStatus.
 */
export function startDictation({ engine, onText, onStatus, onEnd }) {
  if (engine === "device") return deviceDictation({ onText, onStatus, onEnd });
  return premiumDictation({ onText, onStatus, onEnd });
}

function deviceDictation({ onText, onStatus, onEnd }) {
  const recognition = new Recognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  let finished = false;
  recognition.onresult = (event) => {
    const text = [...event.results].map((result) => result[0]?.transcript ?? "").join(" ").trim();
    if (text) onText(text);
  };
  recognition.onerror = (event) => {
    onStatus(micErrorMessage(event), true);
  };
  recognition.onend = () => {
    if (finished) return;
    finished = true;
    onEnd();
  };
  try {
    recognition.start();
    onStatus("Listening… tap the mic again to stop.");
  } catch (error) {
    onStatus(micErrorMessage(error), true);
    finished = true;
    onEnd();
  }
  return { stop: () => recognition.stop() };
}

function premiumDictation({ onText, onStatus, onEnd }) {
  const MAX_MS = 60_000;
  let recorder = null;
  let stream = null;
  let chunks = [];
  let startedAt = 0;
  let stopped = false;
  let timer = null;

  const pickType = () => ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((type) => MediaRecorder.isTypeSupported?.(type)) ?? "";

  function release() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  async function finish() {
    release();
    const type = recorder?.mimeType || "audio/webm";
    const blob = new Blob(chunks, { type });
    chunks = [];
    if (!blob.size) {
      onStatus("Didn't catch anything — try again.", true);
      onEnd();
      return;
    }
    onStatus("Transcribing…");
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const { transcript } = await api.transcribe(dataUrl, blob.type, Date.now() - startedAt);
      if (transcript?.trim()) {
        onText(transcript.trim());
        onStatus("");
      } else {
        onStatus("Didn't catch any words — try again.", true);
      }
    } catch (error) {
      onStatus(error.message || "Couldn't transcribe that.", true);
    } finally {
      onEnd();
    }
  }

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      onStatus(micErrorMessage(error), true);
      onEnd();
      return;
    }
    if (stopped) {
      release();
      onEnd();
      return;
    }
    const type = pickType();
    recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", finish);
    recorder.start();
    startedAt = Date.now();
    onStatus("Recording… tap the mic again to stop (60 seconds max).");
    timer = setTimeout(stop, MAX_MS);
  })();

  function stop() {
    stopped = true;
    clearTimeout(timer);
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }
  return { stop };
}

// ---------- read aloud ----------

/** Splits long text so device engines (notably Chrome) don't cut off mid-way. */
export function chunkForSpeech(text, maxLength = 220) {
  const sentences = String(text).match(/[^.!?]+[.!?]*\s*/g) ?? [String(text)];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > maxLength && current) {
      chunks.push(current.trim());
      current = "";
    }
    if (sentence.length > maxLength) {
      for (let index = 0; index < sentence.length; index += maxLength) chunks.push(sentence.slice(index, index + maxLength).trim());
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

/**
 * One reader for the whole app, so starting a new read-aloud always stops the
 * previous one. `onState` receives "idle" | "loading" | "playing" | "paused".
 */
export class Reader {
  constructor(onState = () => {}) {
    this.onState = onState;
    this.audio = null;
    this.objectUrl = null;
    this.abort = null;
    this.mode = null;
    this.state = "idle";
  }

  set(state) {
    this.state = state;
    this.onState(state);
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
    if (this.mode === "device" && "speechSynthesis" in globalThis) speechSynthesis.cancel();
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.mode = null;
    this.set("idle");
  }

  async speak(text, { engine = "device" } = {}) {
    this.stop();
    if (!text) return;
    if (engine === "premium") {
      this.mode = "premium";
      this.set("loading");
      const controller = new AbortController();
      this.abort = controller;
      const blob = await api.synthesize(text.slice(0, 3000), controller.signal);
      if (controller.signal.aborted) return;
      this.objectUrl = URL.createObjectURL(blob);
      this.audio = new Audio(this.objectUrl);
      this.audio.addEventListener("ended", () => this.set("idle"));
      await this.audio.play();
      this.set("playing");
      return;
    }
    if (!("speechSynthesis" in globalThis)) throw new Error("This browser can't read aloud.");
    this.mode = "device";
    const chunks = chunkForSpeech(text);
    chunks.forEach((chunk, index) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.rate = 1;
      if (index === chunks.length - 1) {
        utterance.onend = () => {
          if (this.mode === "device") this.set("idle");
        };
      }
      utterance.onerror = (event) => {
        if (event.error !== "interrupted" && event.error !== "canceled") this.set("idle");
      };
      speechSynthesis.speak(utterance);
    });
    this.set("playing");
  }

  toggle() {
    if (this.mode === "device") {
      if (speechSynthesis.paused) {
        speechSynthesis.resume();
        this.set("playing");
      } else {
        speechSynthesis.pause();
        this.set("paused");
      }
    } else if (this.audio) {
      if (this.audio.paused) {
        this.audio.play();
        this.set("playing");
      } else {
        this.audio.pause();
        this.set("paused");
      }
    }
  }
}

// ---------- voice commands (hands-free step mode) ----------

export function parseCommand(transcript) {
  const text = String(transcript).toLowerCase();
  if (/\b(next|continue|done|go on|forward)\b/.test(text)) return "next";
  if (/\b(back|previous|go back|last one)\b/.test(text)) return "back";
  if (/\b(repeat|again|say that again|what)\b/.test(text)) return "repeat";
  if (/\b(stop|exit|close|quit|finish)\b/.test(text)) return "exit";
  return null;
}

/** Listens continuously for step commands until stop() is called. */
export function listenForCommands(onCommand, onStatus) {
  if (!Recognition || !globalThis.isSecureContext) return null;
  const recognition = new Recognition();
  recognition.lang = navigator.language || "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;
  let active = true;
  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const command = parseCommand(result?.[0]?.transcript ?? "");
    if (command) onCommand(command);
  };
  recognition.onerror = (event) => {
    if (event.error === "no-speech") return;
    onStatus(micErrorMessage(event));
    if (event.error === "not-allowed" || event.error === "service-not-allowed") active = false;
  };
  recognition.onend = () => {
    // Browsers end continuous sessions periodically; resume while active.
    if (active) {
      try {
        recognition.start();
      } catch {
        active = false;
      }
    }
  };
  try {
    recognition.start();
  } catch (error) {
    onStatus(micErrorMessage(error));
    return null;
  }
  return {
    stop() {
      active = false;
      recognition.stop();
    },
  };
}
