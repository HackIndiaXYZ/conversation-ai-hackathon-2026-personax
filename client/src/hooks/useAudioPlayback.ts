import { useCallback, useRef, useState } from "react";
import { useAvatarStore } from "../store/avatarStore";
import { useSessionStore } from "../store/sessionStore";
import personasJson from "../config/personas.json";
import type { Emotion, Persona, VisemeKeyframe, VisemeSource } from "../types";

type QueueItem = {
  audioBase64: string;
  audioMimeType: string;
  visemes: VisemeKeyframe[];
  visemeSource?: VisemeSource;
  emotion?: Emotion;
  isLast: boolean;
  sentenceIndex: number;
  /** Sentence text for Web Speech Synthesis fallback when TTS audio is silent */
  text?: string;
  /** True when the server sent silence because ElevenLabs/Groq TTS is unavailable */
  isSilence?: boolean;
  /** performance.now() when this chunk was received by client */
  receivedAt?: number;
};

type VoiceProfile = {
  gender: "female" | "male";
  patterns: RegExp[];
  avoid: RegExp[];
  rate: number;
  pitch: number;
};

function prosodyForEmotion(profile: VoiceProfile, emotion: Emotion | undefined) {
  switch (emotion) {
    case "concerned":
      return { rate: profile.rate * 0.9, pitch: profile.pitch * 0.94, volume: 0.96 };
    case "skeptical":
      return { rate: profile.rate * 0.95, pitch: profile.pitch * 0.9, volume: 0.98 };
    case "positive":
      return { rate: profile.rate * 1.06, pitch: profile.pitch * 1.08, volume: 1 };
    case "engaged":
      return { rate: profile.rate * 1.02, pitch: profile.pitch * 1.04, volume: 1 };
    default:
      return { rate: profile.rate, pitch: profile.pitch, volume: 1 };
  }
}

function shapeFallbackSpeechText(text: string, emotion: Emotion | undefined) {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  switch (emotion) {
    case "concerned":
      return trimmed.replace(/\. /g, "... ");
    case "positive":
      return trimmed.replace(/\.$/, "!");
    case "skeptical":
      return trimmed.replace(/!+/g, ".");
    default:
      return trimmed;
  }
}

const FEMALE_VOICE_PATTERNS = [
  /zira/i,
  /samantha/i,
  /karen/i,
  /susan/i,
  /moira/i,
  /tessa/i,
  /ava/i,
  /victoria/i,
  /serena/i,
  /female/i,
];
const MALE_VOICE_PATTERNS = [/david/i, /mark/i, /daniel/i, /alex/i, /\bmale\b/i, /google uk english male/i];
const FEMALE_AVOID_PATTERNS = [/david/i, /mark/i, /daniel/i, /jorge/i, /\bmale\b/i];
const MALE_AVOID_PATTERNS = [/zira/i, /samantha/i, /karen/i, /susan/i, /moira/i, /tessa/i, /female/i];

function pickVoice(voices: SpeechSynthesisVoice[], profile: VoiceProfile): SpeechSynthesisVoice | undefined {
  const englishVoices = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const scored = englishVoices
    .map((voice) => {
      const name = voice.name;
      const preferredScore = profile.patterns.reduce((score, pattern) => score + (pattern.test(name) ? 3 : 0), 0);
      const avoidScore = profile.avoid.reduce((score, pattern) => score + (pattern.test(name) ? 10 : 0), 0);
      const localScore = voice.localService ? 1 : 0;
      return { voice, score: preferredScore + localScore - avoidScore };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  return best && best.score > -5 ? best.voice : englishVoices[0];
}

/**
 * Decodes base64 audio and plays through Web Audio API.
 * When the server sends silence (both TTS providers unavailable), uses the
 * browser's Web Speech Synthesis API instead so the user always hears a voice.
 * Schedules viseme track start aligned with playback start.
 */
export function useAudioPlayback(onLastChunkEnded?: () => void) {
  const personaId = useSessionStore((s) => s.personaId);
  const personas = personasJson as Persona[];
  const selectedPersona = personas.find((p) => p.id === personaId) ?? null;
  const ctxRef = useRef<AudioContext | null>(null);
  /** TTS passes through here so we can visualize levels without changing loudness. */
  const masterGainRef = useRef<GainNode | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const playingRef = useRef(false);
  /** Reactive version of playingRef — consumed by useVoiceInput to mute the mic while avatar talks. */
  const [isPlaying, setIsPlaying] = useState(false);
  // Cancel any pending Web Speech utterance when a new chunk starts.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const stopRequestedRef = useRef(false);

  const ensureCtx = useCallback(async () => {
    let ctx = ctxRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      ctxRef.current = ctx;
      const gain = ctx.createGain();
      gain.gain.value = 1;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      gain.connect(analyser);
      analyser.connect(ctx.destination);
      masterGainRef.current = gain;
      setAnalyserNode(analyser);
    }
    if (ctx.state === "suspended") await ctx.resume();
    return ctx;
  }, []);

  /**
   * Speak text via Web Speech Synthesis (browser-native, free, works offline).
   * Returns a Promise that resolves when speaking ends.
   */
  function speakWithWebSpeech(text: string, emotion?: Emotion, onStart?: () => void): Promise<void> {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window) || !text.trim()) {
        resolve();
        return;
      }
      // Cancel any ongoing utterance first.
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(shapeFallbackSpeechText(text, emotion));
      utteranceRef.current = utterance;

      const voices = window.speechSynthesis.getVoices();
      const profiles: Record<string, VoiceProfile> = {
        dr_chen_oncologist: {
          gender: "female",
          patterns: [/zira/i, /moira/i, /tessa/i, /ava/i, /serena/i, /female/i],
          avoid: FEMALE_AVOID_PATTERNS,
          rate: 0.9,
          pitch: 0.98,
        },
        dr_patel_cardiologist: {
          gender: "male",
          patterns: [/david/i, /mark/i, /alex/i, /\bmale\b/i, /google uk english male/i],
          avoid: MALE_AVOID_PATTERNS,
          rate: 0.98,
          pitch: 0.9,
        },
        dr_williams_gp: {
          gender: "female",
          patterns: [/samantha/i, /karen/i, /susan/i, /victoria/i, /zira/i, /female/i],
          avoid: FEMALE_AVOID_PATTERNS,
          rate: 0.93,
          pitch: 1.12,
        },
        dr_kim_rheumatologist: {
          gender: "female",
          patterns: [/tessa/i, /zira/i, /moira/i, /ava/i, /female/i],
          avoid: FEMALE_AVOID_PATTERNS,
          rate: 0.88,
          pitch: 1.06,
        },
        dr_rodriguez_hospitalist: {
          gender: "male",
          patterns: [/daniel/i, /jorge/i, /alex/i, /\bmale\b/i, /google us english/i],
          avoid: MALE_AVOID_PATTERNS,
          rate: 1.0,
          pitch: 0.94,
        },
      };
      const fallbackGender = selectedPersona?.gender === "male" ? "male" : "female";
      const profile = (selectedPersona && profiles[selectedPersona.id]) ?? {
        gender: fallbackGender,
        patterns: fallbackGender === "male" ? MALE_VOICE_PATTERNS : FEMALE_VOICE_PATTERNS,
        avoid: fallbackGender === "male" ? MALE_AVOID_PATTERNS : FEMALE_AVOID_PATTERNS,
        rate: fallbackGender === "male" ? 0.97 : 0.93,
        pitch: fallbackGender === "male" ? 0.92 : 1.07,
      };
      const preferred = pickVoice(voices, profile);
      if (preferred) utterance.voice = preferred;

      const prosody = prosodyForEmotion(profile, emotion);
      utterance.rate = prosody.rate;
      utterance.pitch = prosody.pitch;
      utterance.volume = prosody.volume;

      utterance.onstart = () => onStart?.();
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      window.speechSynthesis.speak(utterance);
    });
  }

  const pump = useCallback(async () => {
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    playingRef.current = true;
    setIsPlaying(true);
    stopRequestedRef.current = false;

    try {
      if (next.isSilence && next.text?.trim()) {
        // ── Silence fallback path ──
        // Use Web Speech Synthesis for voice + let viseme track run for the
        // natural speech duration (Web Speech handles its own timing).
        await speakWithWebSpeech(next.text, next.emotion, () => {
          useSessionStore.getState().markLipSyncLatencyIfNeeded();
          useAvatarStore.getState().setVisemeTrack(next.visemes, performance.now(), {
            sentenceIndex: next.sentenceIndex,
            isSilence: !!next.isSilence,
            visemeSource: next.visemeSource ?? null,
            receivedAt: next.receivedAt ?? null,
          });
        });
      } else {
        // ── Real audio path (ElevenLabs or Groq WAV) ──
        const ctx = await ensureCtx();
        const out = masterGainRef.current ?? ctx.destination;
        const bytes = Uint8Array.from(atob(next.audioBase64), (c) =>
          c.charCodeAt(0)
        );
        const copy = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        );
        const buffer = await ctx.decodeAudioData(copy);
        await new Promise<void>((resolve) => {
          const src = ctx.createBufferSource();
          sourceRef.current = src;
          src.buffer = buffer;
          src.connect(out);
          src.onended = () => {
            sourceRef.current = null;
            resolve();
          };
          // One render frame of lead time keeps lip motion visibly aligned while staying well under 300ms.
          const leadSec = 0.016;
          const when = ctx.currentTime + leadSec;
          const perfStart = performance.now() + leadSec * 1000;
          const st = useAvatarStore.getState();
          const meta = {
            sentenceIndex: next.sentenceIndex,
            isSilence: !!next.isSilence,
            visemeSource: next.visemeSource ?? null,
            receivedAt: next.receivedAt ?? null,
          };
          const isSameChunk =
            st.lastChunk.sentenceIndex === next.sentenceIndex &&
            st.lastChunk.receivedAt === next.receivedAt &&
            st.visemes.length > 0;
          useSessionStore.getState().markLipSyncLatencyIfNeeded();
          // Reuse only when we are re-syncing the exact same chunk to actual playback.
          if (isSameChunk) st.setChunkStartedAt(perfStart, meta);
          else st.setVisemeTrack(next.visemes, perfStart, meta);
          src.start(when);
        });
      }
    } catch {
      // If Web Audio decoding fails, also try Web Speech as last resort.
      if (next.text?.trim()) {
        try {
          await speakWithWebSpeech(next.text, next.emotion, () => {
            useSessionStore.getState().markLipSyncLatencyIfNeeded();
            useAvatarStore.getState().setVisemeTrack(next.visemes, performance.now(), {
              sentenceIndex: next.sentenceIndex,
              isSilence: !!next.isSilence,
              visemeSource: next.visemeSource ?? null,
              receivedAt: next.receivedAt ?? null,
            });
          });
        } catch {
          // ignore
        }
      }
    }

    playingRef.current = false;

    if (!stopRequestedRef.current && next.isLast) {
      setIsPlaying(false);
      useAvatarStore.getState().clearVisemeTrack();
      onLastChunkEnded?.();
    }

    if (stopRequestedRef.current) {
      setIsPlaying(false);
    }

    // Process next item in queue.
    void pump();
  }, [ensureCtx, onLastChunkEnded]);

  const enqueue = useCallback(
    (item: QueueItem) => {
      queueRef.current.push(item);
      void pump();
    },
    [pump]
  );

  const clearQueue = useCallback(() => {
    queueRef.current = [];
  }, []);

  const stopCurrent = useCallback(() => {
    stopRequestedRef.current = true;
    queueRef.current = [];
    try {
      sourceRef.current?.stop();
    } catch {
      // ignore stop races
    }
    sourceRef.current = null;
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    playingRef.current = false;
    setIsPlaying(false);
    useAvatarStore.getState().clearVisemeTrack();
  }, []);

  return { enqueue, ensureCtx, analyserNode, isPlaying, clearQueue, stopCurrent };
}
