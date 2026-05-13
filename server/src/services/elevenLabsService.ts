import { Buffer } from "node:buffer";
import type { Emotion, VisemeKey, VisemeKeyframe, VisemeSource } from "../types/index.js";

function voiceSettingsForEmotion(emotion: Emotion | undefined) {
  const base = { stability: 0.42, similarity_boost: 0.78, style: 0.35, use_speaker_boost: true };
  switch (emotion) {
    case "concerned":
      return { ...base, stability: 0.58, style: 0.55 };
    case "skeptical":
      return { ...base, stability: 0.62, style: 0.28 };
    case "positive":
      return { ...base, stability: 0.34, style: 0.72 };
    case "engaged":
      return { ...base, stability: 0.38, style: 0.58 };
    default:
      return base;
  }
}

/**
 * Streams ElevenLabs TTS into a single buffer (per sentence) using fetch ReadableStream.
 * Uses PCM 22050 mono for predictable WAV assembly.
 */
export async function synthesizeSentenceToPcm(
  apiKey: string | undefined,
  voiceId: string,
  text: string,
  emotion?: Emotion
): Promise<{ pcm: Buffer; sampleRate: number }> {
  const defaultVoice = process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  const vid =
    voiceId && !voiceId.includes("ELEVENLABS_VOICE_ID_HERE") ? voiceId : defaultVoice;
  if (!apiKey || !vid) {
    return { pcm: Buffer.alloc(0), sampleRate: 22050 };
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${vid}/stream?output_format=pcm_22050`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      Accept: "audio/pcm",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: voiceSettingsForEmotion(emotion),
    }),
  });

  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${err}`);
  }

  const chunks: Buffer[] = [];
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.length) chunks.push(Buffer.from(value));
  }
  return { pcm: Buffer.concat(chunks), sampleRate: 22050 };
}

type ElevenAlignment = {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
  start_times?: number[];
  end_times?: number[];
};

type ElevenWithTimestampsResponse = {
  audio_base64?: string;
  audioBase64?: string;
  audio?: string;
  alignment?: ElevenAlignment;
};

const CHAR_TO_VISEME: Record<string, VisemeKey> = {
  // Silence / separators
  " ": "sil",
  "\n": "sil",
  "\t": "sil",
  ".": "sil",
  ",": "sil",
  "!": "sil",
  "?": "sil",
  ":": "sil",
  ";": "sil",
  "-": "sil",
  "—": "sil",
  "(": "sil",
  ")": "sil",
  "[": "sil",
  "]": "sil",
  "{": "sil",
  "}": "sil",
  "\"": "sil",
  "'": "sil",

  // Bilabials
  p: "PP",
  b: "PP",
  m: "PP",

  // Labiodentals
  f: "FF",
  v: "FF",

  // Dentals / alveolars
  t: "DD",
  d: "DD",
  n: "nn",
  l: "nn",

  // Velars
  k: "kk",
  g: "kk",

  // Sibilants
  s: "SS",
  z: "SS",

  // Affricates-ish (rough)
  j: "CH",

  // Rhotics
  r: "RR",

  // Vowels (very rough; this is why this is “good hackathon path”, not perfect phonetics)
  a: "aa",
  e: "E",
  i: "ih",
  o: "oh",
  u: "ou",
};

function weightForViseme(v: VisemeKey): number {
  if (v === "sil") return 0;
  if (v === "PP" || v === "DD" || v === "kk") return 0.9;
  if (v === "FF" || v === "SS" || v === "TH" || v === "CH") return 0.82;
  if (v === "nn") return 0.75;
  if (v === "RR") return 0.7;
  return 0.72;
}

function toSecondsArray(x: number[] | undefined): number[] {
  if (!x?.length) return [];
  // Heuristic: if timestamps are in milliseconds, values will often exceed 1000 quickly.
  const max = x.reduce((m, v) => Math.max(m, v), 0);
  return max > 1000 ? x.map((v) => v / 1000) : x;
}

export function visemesFromElevenAlignment(alignment: ElevenAlignment | undefined): VisemeKeyframe[] {
  const chars = alignment?.characters ?? [];
  const starts = toSecondsArray(alignment?.start_times ?? alignment?.character_start_times_seconds);
  const ends = toSecondsArray(alignment?.end_times ?? alignment?.character_end_times_seconds);
  if (!chars.length || !starts.length) return [{ time: 0, viseme: "sil", weight: 0 }];

  const frames: VisemeKeyframe[] = [{ time: 0, viseme: "sil", weight: 0 }];
  let i = 0;
  while (i < chars.length && i < starts.length) {
    const c0 = String(chars[i] ?? "").toLowerCase();
    const c1 = i + 1 < chars.length ? String(chars[i + 1] ?? "").toLowerCase() : "";

    const digraph = (c0 + c1).replace(/\s+/g, "");
    const start = Math.max(0, starts[i] ?? 0);
    const end = Math.max(start, ends[i] ?? start);

    // Simple digraph handling where alignment is per-character.
    if (digraph === "th" || digraph === "sh" || digraph === "ch") {
      const v: VisemeKey = digraph === "th" ? "TH" : "CH";
      frames.push({ time: start, viseme: v, weight: weightForViseme(v) });
      i += 2;
      continue;
    }

    const v = CHAR_TO_VISEME[c0] ?? (/[0-9]/.test(c0) ? "sil" : "sil");
    // Skip redundant silence frames to keep animation stable.
    const prev = frames[frames.length - 1];
    if (!(v === "sil" && prev?.viseme === "sil")) {
      frames.push({ time: start, viseme: v, weight: weightForViseme(v) });
    }

    i += 1;
    // Ensure we end with silence once.
    if (i >= chars.length) {
      frames.push({ time: end, viseme: "sil", weight: 0 });
    }
  }

  frames.sort((a, b) => a.time - b.time);
  return frames.length ? frames : [{ time: 0, viseme: "sil", weight: 0 }];
}

/**
 * ElevenLabs TTS + alignment timestamps (pure HTTP, no binaries).
 * Returns base64 audio and viseme keyframes derived from alignment timing.
 */
export async function synthesizeSentenceWithTimestamps(
  apiKey: string | undefined,
  voiceId: string,
  text: string,
  emotion?: Emotion
): Promise<{ audioBase64: string; audioMimeType: string; visemes: VisemeKeyframe[]; source: VisemeSource }> {
  const defaultVoice = process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  const vid =
    voiceId && !voiceId.includes("ELEVENLABS_VOICE_ID_HERE") ? voiceId : defaultVoice;
  if (!apiKey || !vid || !text.trim()) {
    return {
      audioBase64: "",
      audioMimeType: "audio/mpeg",
      visemes: [{ time: 0, viseme: "sil", weight: 0 }],
      source: "fallback_static",
    };
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${vid}/with-timestamps`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: voiceSettingsForEmotion(emotion),
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`ElevenLabs with-timestamps failed: ${res.status} ${err}`);
  }

  const json = (await res.json()) as ElevenWithTimestampsResponse;
  const audioBase64 =
    json.audio_base64 ?? json.audioBase64 ?? json.audio ?? "";
  const visemes = visemesFromElevenAlignment(json.alignment);

  return {
    audioBase64,
    audioMimeType: "audio/mpeg",
    visemes,
    source: "elevenlabs_alignment",
  };
}
