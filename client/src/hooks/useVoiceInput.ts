import { useCallback, useEffect, useRef, useState } from "react";

const SILENCE_MS_WEBSPEECH = 900;
const FAST_FINAL_SUBMIT_MS = 450;
const PCM_SAMPLE_RATE = 16_000;
const PCM_SPEECH_THRESHOLD = 0.0025;
const PCM_PEAK_THRESHOLD = 0.035;
const PCM_SILENCE_FRAMES = 6;
const PCM_MIN_SPEECH_FRAMES = 3;
const PCM_ROLLING_MAX_FRAMES = 320;
const PCM_MAX_FRAMES = 160;
const PCM_BUFFER_SIZE = 1024;
const PCM_MANUAL_TAIL_FRAMES = 32;
const POST_SPEAK_COOLDOWN_MS = 180;

const DEBUG = true;
const log = (...args: unknown[]) => { if (DEBUG) console.log("[voice]", ...args); };
const logErr = (...args: unknown[]) => { if (DEBUG) console.error("[voice]", ...args); };

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const s4 = (o: number, t: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s4(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  s4(8, "WAVE");
  s4(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  s4(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

export interface UseVoiceInputOptions {
  enabled: boolean;
  avatarSpeaking?: boolean;
  interruptAvatarPlayback?: boolean;
  onUtterance: (text: string) => void;
  onPartial?: (text: string) => void;
  onError?: (message: string) => void;
  onInterruptionStart?: () => void;
}

type InputMode = "webspeech" | "server_stt" | "unsupported";

export function useVoiceInput({
  enabled,
  avatarSpeaking = false,
  interruptAvatarPlayback = false,
  onUtterance,
  onPartial,
  onError,
  onInterruptionStart,
}: UseVoiceInputOptions) {
  const [listening, setListening] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [mode, setMode] = useState<InputMode>("webspeech");

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const partialRecognitionRef = useRef<SpeechRecognition | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fastSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTextRef = useRef("");
  const committedTextRef = useRef("");
  const lastSubmittedRef = useRef({ text: "", at: 0 });

  const pipelineActiveRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const pcmSamplesRef = useRef<Float32Array[]>([]);
  const pcmSpeakingRef = useRef(false);
  const pcmSilenceFramesRef = useRef(0);
  const pcmSpeechFramesRef = useRef(0);
  const pcmTotalFramesRef = useRef(0);
  const pcmFlushingRef = useRef(false);

  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const mutedRef = useRef(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onUtteranceRef = useRef(onUtterance);
  const onErrorRef = useRef(onError);
  const onPartialRef = useRef(onPartial);
  const onInterruptionStartRef = useRef(onInterruptionStart);
  const interruptionTriggeredRef = useRef(false);

  useEffect(() => {
    onUtteranceRef.current = onUtterance;
    onErrorRef.current = onError;
    onPartialRef.current = onPartial;
    onInterruptionStartRef.current = onInterruptionStart;
  }, [onUtterance, onError, onPartial, onInterruptionStart]);

  const triggerInterruptionIfNeeded = useCallback(() => {
    if (!interruptAvatarPlayback || !avatarSpeaking || interruptionTriggeredRef.current) return;
    interruptionTriggeredRef.current = true;
    onInterruptionStartRef.current?.();
  }, [avatarSpeaking, interruptAvatarPlayback]);

  useEffect(() => {
    if (avatarSpeaking && !interruptAvatarPlayback) {
      if (cooldownTimerRef.current) { clearTimeout(cooldownTimerRef.current); cooldownTimerRef.current = null; }
      if (fastSubmitTimerRef.current) {
        clearTimeout(fastSubmitTimerRef.current);
        fastSubmitTimerRef.current = null;
      }
      mutedRef.current = true;
      pcmSamplesRef.current = [];
      pcmSpeakingRef.current = false;
      pcmSilenceFramesRef.current = 0;
      pcmSpeechFramesRef.current = 0;
      lastTextRef.current = "";
      committedTextRef.current = "";
      onPartialRef.current?.("");
      setPartialTranscript("");
    } else {
      interruptionTriggeredRef.current = false;
      if (interruptAvatarPlayback) {
        mutedRef.current = false;
      } else {
        cooldownTimerRef.current = setTimeout(() => {
          mutedRef.current = false;
          cooldownTimerRef.current = null;
          log("mic unmuted after post-speak cooldown");
        }, POST_SPEAK_COOLDOWN_MS);
      }
    }
    return () => {
      if (cooldownTimerRef.current) { clearTimeout(cooldownTimerRef.current); cooldownTimerRef.current = null; }
    };
  }, [avatarSpeaking, interruptAvatarPlayback]);

  const reportError = useCallback((msg: string) => {
    logErr(msg);
    onErrorRef.current?.(msg);
  }, []);

  const getSpeechRecognitionCtor = useCallback(() => {
    return (
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition ||
      null
    );
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearFastSubmitTimer = useCallback(() => {
    if (fastSubmitTimerRef.current) {
      clearTimeout(fastSubmitTimerRef.current);
      fastSubmitTimerRef.current = null;
    }
  }, []);

  const submitRecognizedText = useCallback(
    (text: string, source: string) => {
      const t = text.trim();
      if (!t || mutedRef.current || !enabledRef.current) return;

      const now = performance.now();
      if (lastSubmittedRef.current.text === t && now - lastSubmittedRef.current.at < 1200) return;
      lastSubmittedRef.current = { text: t, at: now };

      clearSilenceTimer();
      clearFastSubmitTimer();
      pcmSamplesRef.current = [];
      pcmSpeakingRef.current = false;
      pcmSilenceFramesRef.current = 0;
      pcmSpeechFramesRef.current = 0;
      pcmTotalFramesRef.current = 0;
      lastTextRef.current = "";
      committedTextRef.current = "";
      onPartialRef.current?.("");
      setPartialTranscript("");
      log(`${source} utterance ->`, t);
      onUtteranceRef.current(t);
    },
    [clearFastSubmitTimer, clearSilenceTimer]
  );

  const scheduleFastSubmit = useCallback(
    (text: string, source: string) => {
      clearFastSubmitTimer();
      fastSubmitTimerRef.current = setTimeout(() => {
        fastSubmitTimerRef.current = null;
        submitRecognizedText(text, source);
      }, FAST_FINAL_SUBMIT_MS);
    },
    [clearFastSubmitTimer, submitRecognizedText]
  );

  const stopPartialWebSpeech = useCallback(() => {
    clearFastSubmitTimer();
    try { partialRecognitionRef.current?.stop(); } catch { /* ignore */ }
    partialRecognitionRef.current = null;
    committedTextRef.current = "";
  }, [clearFastSubmitTimer]);

  const startPartialWebSpeech = useCallback(() => {
    const SR = getSpeechRecognitionCtor();
    if (!SR || partialRecognitionRef.current) return false;

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onspeechstart = () => {
      triggerInterruptionIfNeeded();
      if (!lastTextRef.current.trim()) {
        setPartialTranscript("Listening...");
        onPartialRef.current?.("Listening...");
      }
    };

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let interim = "";
      let finalChunk = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalChunk += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finalChunk.trim()) {
        committedTextRef.current = `${committedTextRef.current} ${finalChunk}`.trim();
        scheduleFastSubmit(committedTextRef.current, "fast webspeech");
      }
      const combined = `${committedTextRef.current} ${interim}`.trim();
      if (!combined) return;
      triggerInterruptionIfNeeded();
      lastTextRef.current = combined;
      setPartialTranscript(combined);
      onPartialRef.current?.(combined);
    };

    rec.onerror = () => {
      // Best-effort interim transcript only.
    };

    rec.onend = () => {
      if (partialRecognitionRef.current === rec && pipelineActiveRef.current && enabledRef.current) {
        try { rec.start(); } catch { /* ignore */ }
      }
    };

    partialRecognitionRef.current = rec;
    try {
      rec.start();
      return true;
    } catch {
      partialRecognitionRef.current = null;
      return false;
    }
  }, [getSpeechRecognitionCtor, scheduleFastSubmit, triggerInterruptionIfNeeded]);

  const transcribeBlob = useCallback(async (blob: Blob, label = "") => {
    const api = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
    log(`POST /session/transcribe (${blob.size}B${label ? ` ${label}` : ""})`);
    try {
      const fd = new FormData();
      fd.append("audio", blob, "clip.wav");
      const res = await fetch(`${api}/session/transcribe`, { method: "POST", body: fd });
      if (!res.ok) {
        const raw = await res.text();
        throw new Error(raw || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { text?: string; error?: string };
      if (data.error && !data.text) throw new Error(data.error);
      const text = (data.text ?? "").trim();
      if (text) {
        log("whisper ->", text);
        onUtteranceRef.current(text);
      } else {
        log("whisper returned empty (noise/hallucination filtered)");
      }
    } catch (e) {
      reportError(`Transcription error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [reportError]);

  const flushPcmBuffer = useCallback(async (manualFlush = false) => {
    if (pcmFlushingRef.current) return;
    if (pcmSamplesRef.current.length === 0) {
      log("PCM flush: buffer empty, nothing to send");
      return;
    }

    const speechFrames = pcmSpeechFramesRef.current;
    if (!manualFlush && speechFrames < PCM_MIN_SPEECH_FRAMES) {
      log(`PCM auto-flush skipped - ${speechFrames} speech frames < ${PCM_MIN_SPEECH_FRAMES} min`);
      pcmSamplesRef.current = [];
      pcmSpeakingRef.current = false;
      pcmSilenceFramesRef.current = 0;
      pcmSpeechFramesRef.current = 0;
      pcmTotalFramesRef.current = 0;
      lastTextRef.current = "";
      committedTextRef.current = "";
      onPartialRef.current?.("");
      setPartialTranscript("");
      return;
    }

    pcmFlushingRef.current = true;
    clearFastSubmitTimer();

    let chunks = pcmSamplesRef.current;
    if (manualFlush && speechFrames < PCM_MIN_SPEECH_FRAMES && chunks.length > PCM_MANUAL_TAIL_FRAMES) {
      chunks = chunks.slice(-PCM_MANUAL_TAIL_FRAMES);
      log(`PCM manual tail fallback: using last ${chunks.length} frames`);
    }

    pcmSamplesRef.current = [];
    pcmSpeakingRef.current = false;
    pcmSilenceFramesRef.current = 0;
    pcmSpeechFramesRef.current = 0;
    pcmTotalFramesRef.current = 0;

    const total = chunks.reduce((a, b) => a + b.length, 0);
    log(`PCM flush (manual=${manualFlush}): ${chunks.length} frames, ${(total / PCM_SAMPLE_RATE).toFixed(2)}s audio`);
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }

    setPartialTranscript(lastTextRef.current.trim() || "...");
    const blob = encodeWav(merged, PCM_SAMPLE_RATE);
    await transcribeBlob(blob);
    lastTextRef.current = "";
    committedTextRef.current = "";
    onPartialRef.current?.("");
    setPartialTranscript("");
    pcmFlushingRef.current = false;
  }, [clearFastSubmitTimer, transcribeBlob]);

  const stopPcmPipeline = useCallback(() => {
    log("stopPcmPipeline");
    pipelineActiveRef.current = false;
    try { processorRef.current?.disconnect(); } catch { /* ignore */ }
    processorRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    pcmSamplesRef.current = [];
    pcmSpeakingRef.current = false;
    pcmSilenceFramesRef.current = 0;
    pcmSpeechFramesRef.current = 0;
    pcmTotalFramesRef.current = 0;
    pcmFlushingRef.current = false;
    lastTextRef.current = "";
    committedTextRef.current = "";
    onPartialRef.current?.("");
    stopPartialWebSpeech();
    setListening(false);
    setPartialTranscript("");
  }, [stopPartialWebSpeech]);

  const startPcmWhisperPipeline = useCallback(async () => {
    if (pipelineActiveRef.current) {
      log("PCM pipeline already active");
      return;
    }
    log("starting PCM WAV -> Whisper pipeline");
    pipelineActiveRef.current = true;
    setMode("server_stt");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      log("mic stream acquired");

      const audioCtx = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === "suspended") {
        await audioCtx.resume().catch(() => {});
      }
      log(`AudioContext state=${audioCtx.state} sampleRate=${audioCtx.sampleRate}`);
      void startPartialWebSpeech();

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(PCM_BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (ev) => {
        if (!pipelineActiveRef.current || !enabledRef.current || pcmFlushingRef.current) return;

        if (mutedRef.current) {
          pcmSamplesRef.current = [];
          pcmSpeakingRef.current = false;
          pcmSilenceFramesRef.current = 0;
          pcmSpeechFramesRef.current = 0;
          lastTextRef.current = "";
          committedTextRef.current = "";
          onPartialRef.current?.("");
          setPartialTranscript("");
          return;
        }

        const input = ev.inputBuffer.getChannelData(0);
        pcmTotalFramesRef.current += 1;

        let sum = 0;
        let peak = 0;
        for (let i = 0; i < input.length; i++) {
          const v = input[i]!;
          sum += v * v;
          const a = Math.abs(v);
          if (a > peak) peak = a;
        }
        const rms = Math.sqrt(sum / input.length);

        pcmSamplesRef.current.push(new Float32Array(input));
        if (pcmSamplesRef.current.length > PCM_ROLLING_MAX_FRAMES) {
          pcmSamplesRef.current.shift();
        }

        if (rms > PCM_SPEECH_THRESHOLD || peak > PCM_PEAK_THRESHOLD) {
          if (!pcmSpeakingRef.current) {
            log(`speech start (rms=${rms.toFixed(4)} peak=${peak.toFixed(4)})`);
            triggerInterruptionIfNeeded();
          }
          pcmSpeakingRef.current = true;
          pcmSilenceFramesRef.current = 0;
          pcmSpeechFramesRef.current += 1;
          if (!lastTextRef.current.trim()) {
            setPartialTranscript("Listening...");
            onPartialRef.current?.("Listening...");
          }
        } else if (pcmSpeakingRef.current) {
          pcmSilenceFramesRef.current += 1;
          if (pcmSilenceFramesRef.current >= PCM_SILENCE_FRAMES) {
            log(`auto-flush: silence after ${pcmSpeechFramesRef.current} speech frames`);
            void flushPcmBuffer(false);
          }
        }

        if (pcmTotalFramesRef.current >= PCM_MAX_FRAMES) {
          log("PCM max frames reached, flushing");
          void flushPcmBuffer(false);
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
      setListening(true);
    } catch (e) {
      pipelineActiveRef.current = false;
      reportError(`Microphone error: ${e instanceof Error ? e.message : String(e)}`);
      setListening(false);
      setMode("unsupported");
    }
  }, [flushPcmBuffer, reportError, startPartialWebSpeech, triggerInterruptionIfNeeded]);

  const scheduleUtteranceEnd = useCallback((text: string) => {
    clearSilenceTimer();
    lastTextRef.current = text;
    silenceTimerRef.current = setTimeout(() => {
      const t = lastTextRef.current.trim();
      if (t) {
        log("webspeech utterance ->", t);
        onUtteranceRef.current(t);
      }
      lastTextRef.current = "";
      committedTextRef.current = "";
      onPartialRef.current?.("");
      setPartialTranscript("");
      silenceTimerRef.current = null;
    }, SILENCE_MS_WEBSPEECH);
  }, [clearSilenceTimer]);

  const stopWebSpeech = useCallback(() => {
    clearSilenceTimer();
    clearFastSubmitTimer();
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    recognitionRef.current = null;
    lastTextRef.current = "";
    committedTextRef.current = "";
    onPartialRef.current?.("");
    setPartialTranscript("");
  }, [clearFastSubmitTimer, clearSilenceTimer]);

  const startWebSpeech = useCallback((): boolean => {
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      log("Web Speech API not available");
      return false;
    }
    if (recognitionRef.current) return true;

    log("starting Web Speech API");
    setMode("webspeech");
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onspeechstart = () => {
      triggerInterruptionIfNeeded();
      if (!lastTextRef.current.trim()) {
        setPartialTranscript("Listening...");
        onPartialRef.current?.("Listening...");
      }
    };

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let interim = "";
      let finalChunk = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalChunk += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finalChunk.trim()) {
        committedTextRef.current = `${committedTextRef.current} ${finalChunk}`.trim();
      }
      const combined = `${committedTextRef.current} ${interim}`.trim();
      if (combined) {
        triggerInterruptionIfNeeded();
        setPartialTranscript(combined);
        onPartialRef.current?.(combined);
        scheduleUtteranceEnd(combined);
      }
    };

    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      logErr(`Web Speech error: ${ev.error}`);
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        reportError("Microphone permission denied.");
      } else if (ev.error === "network") {
        recognitionRef.current = null;
        try { rec.stop(); } catch { /* ignore */ }
        reportError("Web Speech unavailable (network). Switching to Whisper...");
        void startPcmWhisperPipeline();
      }
    };

    rec.onend = () => {
      if (recognitionRef.current === rec && enabledRef.current) {
        try { rec.start(); } catch { /* ignore */ }
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
      return true;
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Could not start speech recognition");
      return false;
    }
  }, [getSpeechRecognitionCtor, reportError, scheduleUtteranceEnd, startPcmWhisperPipeline, triggerInterruptionIfNeeded]);

  const stopListening = useCallback(() => {
    log("stopListening");
    stopWebSpeech();
    stopPcmPipeline();
  }, [stopPcmPipeline, stopWebSpeech]);

  const startListening = useCallback(async () => {
    const forceServer = import.meta.env.VITE_FORCE_SERVER_STT === "true";
    log(`startListening (forceServer=${forceServer})`);
    if (forceServer) {
      await startPcmWhisperPipeline();
      return;
    }
    const ok = startWebSpeech();
    if (!ok) await startPcmWhisperPipeline();
  }, [startPcmWhisperPipeline, startWebSpeech]);

  const tapToSpeak = useCallback(() => {
    if (mode === "server_stt") {
      log("tapToSpeak: manual flush (bypasses speech-frame guard)");
      void flushPcmBuffer(true);
    }
  }, [flushPcmBuffer, mode]);

  useEffect(() => {
    if (enabled) {
      const forceServer = import.meta.env.VITE_FORCE_SERVER_STT === "true";
      if (forceServer) {
        void startPcmWhisperPipeline();
      } else {
        const ok = startWebSpeech();
        if (!ok) void startPcmWhisperPipeline();
      }
    } else {
      stopListening();
    }
    return () => { stopListening(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { listening, partialTranscript, mode, startListening, stopListening, tapToSpeak };
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onspeechstart?: ((this: SpeechRecognition, ev: Event) => void) | null;
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}
declare const SpeechRecognition: { prototype: SpeechRecognition; new(): SpeechRecognition };
