import type { VisemeKeyframe, VisemeKey } from "../types/index.js";

// ---------------------------------------------------------------------------
// Phoneme-ish fallback synthesizer (used when alignment data is unavailable).
// Produces realistic mouth movement from text at ~11 phonemes/sec.
// ---------------------------------------------------------------------------

const PHONEME_MAP: Array<{ pattern: RegExp; viseme: VisemeKey; durationMs: number }> = [
  { pattern: /^(sh|ch)/i, viseme: "CH", durationMs: 100 },
  { pattern: /^(th)/i, viseme: "TH", durationMs: 95 },
  { pattern: /^(ph|ff|f|v)/i, viseme: "FF", durationMs: 85 },
  { pattern: /^(oo|ou|ow|oe|ue)/i, viseme: "ou", durationMs: 110 },
  { pattern: /^(oh|oa)/i, viseme: "oh", durationMs: 110 },
  { pattern: /^(ee|ea|ie|ei)/i, viseme: "E", durationMs: 100 },
  { pattern: /^(ih|in|im|it)/i, viseme: "ih", durationMs: 90 },
  { pattern: /^(aa|ar|ah|al)/i, viseme: "aa", durationMs: 110 },
  { pattern: /^[aeiou]/i, viseme: "aa", durationMs: 95 },
  { pattern: /^[pb]/i, viseme: "PP", durationMs: 70 },
  { pattern: /^[mn]/i, viseme: "nn", durationMs: 75 },
  { pattern: /^[dt]/i, viseme: "DD", durationMs: 70 },
  { pattern: /^[kg]/i, viseme: "kk", durationMs: 70 },
  { pattern: /^[szxc]/i, viseme: "SS", durationMs: 80 },
  { pattern: /^[rl]/i, viseme: "RR", durationMs: 80 },
  { pattern: /^[yw]/i, viseme: "ih", durationMs: 65 },
  { pattern: /^[hj]/i, viseme: "DD", durationMs: 65 },
  { pattern: /^\s+/, viseme: "sil", durationMs: 120 },
  { pattern: /^[^a-z]/i, viseme: "sil", durationMs: 60 },
];

export function synthesizeVisemesFromText(text: string): VisemeKeyframe[] {
  const frames: VisemeKeyframe[] = [];
  let cursorMs = 0;
  let remaining = text.trim();

  if (!remaining) return [{ time: 0, viseme: "sil", weight: 0 }];

  frames.push({ time: 0, viseme: "sil", weight: 0 });

  while (remaining.length > 0) {
    let matched = false;
    for (const { pattern, viseme, durationMs } of PHONEME_MAP) {
      const m = remaining.match(pattern);
      if (m) {
        const seg = m[0];
        const startSec = cursorMs / 1000;
        const endSec = (cursorMs + durationMs) / 1000;
        const weight = viseme === "sil" ? 0.1 : 0.75 + Math.random() * 0.15;
        frames.push({ time: startSec, viseme, weight });
        frames.push({ time: endSec, viseme: "sil", weight: 0.1 });
        cursorMs += durationMs;
        remaining = remaining.slice(seg.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      remaining = remaining.slice(1);
      cursorMs += 60;
    }
  }

  frames.push({ time: cursorMs / 1000, viseme: "sil", weight: 0 });
  frames.sort((a, b) => a.time - b.time);
  return frames;
}

