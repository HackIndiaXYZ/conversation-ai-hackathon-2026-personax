import { Buffer } from "node:buffer";
import type { VisemeKeyframe } from "../types/index.js";

/** Wrap raw PCM s16le mono in a WAV container for browser decode. */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

/** ~120ms of silence as WAV for graceful fallback when TTS fails. */
export function minimalSilenceWav(): Buffer {
  return makeSilenceWavForDuration(0.12);
}

/**
 * Generate a WAV buffer of pure silence with the given duration.
 * Used so the lip-sync viseme track stays alive for the full spoken duration
 * even when TTS audio is unavailable (silence fallback path).
 */
export function makeSilenceWavForDuration(durationSec: number): Buffer {
  const sampleRate = 22050;
  const n = Math.max(1, Math.floor(sampleRate * Math.max(0.12, durationSec)));
  const pcm = Buffer.alloc(n * 2);
  return pcmToWav(pcm, sampleRate, 1);
}

export function bufferToBase64(buf: Buffer): string {
  return buf.toString("base64");
}

/**
 * Parse the duration (in seconds) of a PCM WAV file from its header.
 * Returns null if the buffer is too short or not a valid WAV.
 */
export function parseWavDurationSec(buf: Buffer): number | null {
  const meta = parsePcmWavMeta(buf);
  if (!meta) return null;
  const bytesPerSample = meta.bitsPerSample / 8;
  const durationSec = meta.dataSize / (meta.sampleRate * meta.channels * bytesPerSample);
  return Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null;
}

/**
 * Scale text-derived viseme timestamps to match actual audio duration.
 * When Groq TTS produces a WAV with a known duration, this aligns the
 * mouth animation to the real speech rate instead of a fixed estimate.
 */
export function scaleVisemesToDuration(
  visemes: VisemeKeyframe[],
  targetDurationSec: number
): VisemeKeyframe[] {
  if (!visemes.length || targetDurationSec <= 0) return visemes;
  const lastTime = visemes[visemes.length - 1]?.time ?? 0;
  if (lastTime <= 0) return visemes;
  const scale = targetDurationSec / lastTime;
  if (Math.abs(scale - 1) < 0.05) return visemes;
  return visemes.map((f) => ({ ...f, time: f.time * scale }));
}

type WavMeta = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parsePcmWavMeta(buf: Buffer): WavMeta | null {
  if (buf.length < 44) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const bodyOffset = offset + 8;

    if (chunkId === "fmt " && chunkSize >= 16 && bodyOffset + 16 <= buf.length) {
      const format = buf.readUInt16LE(bodyOffset);
      channels = buf.readUInt16LE(bodyOffset + 2);
      sampleRate = buf.readUInt32LE(bodyOffset + 4);
      bitsPerSample = buf.readUInt16LE(bodyOffset + 14);
      if (format !== 1) return null;
    } else if (chunkId === "data") {
      dataOffset = bodyOffset;
      dataSize = Math.min(chunkSize, Math.max(0, buf.length - bodyOffset));
      break;
    }

    offset = bodyOffset + chunkSize + (chunkSize % 2);
  }

  if (!sampleRate || !channels || !bitsPerSample || !dataOffset || !dataSize) return null;
  return { sampleRate, channels, bitsPerSample, dataOffset, dataSize };
}

function dedupeVisemeFrames(frames: VisemeKeyframe[]): VisemeKeyframe[] {
  const out: VisemeKeyframe[] = [];
  for (const frame of frames) {
    const prev = out[out.length - 1];
    if (prev && prev.viseme === frame.viseme && Math.abs(prev.time - frame.time) < 0.012) {
      prev.weight = frame.weight;
      continue;
    }
    out.push(frame);
  }
  return out;
}

/**
 * Retimes text-derived visemes using the real audio envelope from a PCM WAV.
 * This gives practical audio-synced lip movement when timestamp APIs are unavailable.
 */
export function alignVisemesToWavEnergy(
  wav: Buffer,
  visemes: VisemeKeyframe[],
  windowMs = 42
): VisemeKeyframe[] {
  const meta = parsePcmWavMeta(wav);
  if (!meta || meta.bitsPerSample !== 16 || meta.channels < 1) return visemes;

  const bytesPerSample = meta.bitsPerSample / 8;
  const sampleStride = bytesPerSample * meta.channels;
  const totalSamples = Math.floor(meta.dataSize / sampleStride);
  if (totalSamples <= 0) return visemes;

  const samplesPerWindow = Math.max(128, Math.floor((meta.sampleRate * windowMs) / 1000));
  const windows: Array<{ time: number; energy: number }> = [];

  for (let start = 0; start < totalSamples; start += samplesPerWindow) {
    const end = Math.min(totalSamples, start + samplesPerWindow);
    let sumSquares = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      let mono = 0;
      for (let ch = 0; ch < meta.channels; ch++) {
        const sampleOffset = meta.dataOffset + i * sampleStride + ch * bytesPerSample;
        mono += wav.readInt16LE(sampleOffset) / 32768;
      }
      mono /= meta.channels;
      sumSquares += mono * mono;
      count++;
    }
    const rms = count ? Math.sqrt(sumSquares / count) : 0;
    windows.push({ time: start / meta.sampleRate, energy: rms });
  }

  if (!windows.length) return visemes;
  const peak = windows.reduce((m, x) => Math.max(m, x.energy), 0);
  if (peak <= 0.0001) return visemes;

  const normalized = windows.map((x) => ({ time: x.time, energy: clamp01(x.energy / peak) }));
  const voiced = normalized.filter((x) => x.energy > 0.12);
  const speechFrames = visemes.filter((f) => f.viseme !== "sil").sort((a, b) => a.time - b.time);
  const duration = parseWavDurationSec(wav) ?? normalized[normalized.length - 1]!.time;

  if (!voiced.length || !speechFrames.length || duration <= 0) {
    return scaleVisemesToDuration(visemes, duration);
  }

  const out: VisemeKeyframe[] = [{ time: 0, viseme: "sil", weight: 0 }];
  for (let i = 0; i < speechFrames.length; i++) {
    const src = speechFrames[i]!;
    const slotIndex = Math.min(voiced.length - 1, Math.floor((i / speechFrames.length) * voiced.length));
    const slot = voiced[slotIndex]!;
    const nextSlot = voiced[Math.min(voiced.length - 1, slotIndex + 1)] ?? slot;
    out.push({
      time: slot.time,
      viseme: src.viseme,
      weight: Number((0.34 + slot.energy * 0.66).toFixed(3)),
    });
    out.push({
      time: Math.min(duration, nextSlot.time + Math.max(0.018, windowMs / 2000)),
      viseme: "sil",
      weight: 0.04,
    });
  }

  out.push({ time: duration, viseme: "sil", weight: 0 });
  out.sort((a, b) => a.time - b.time);
  return dedupeVisemeFrames(out);
}
