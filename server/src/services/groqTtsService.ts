import Groq from "groq-sdk";
import { Buffer } from "node:buffer";
import type { Emotion } from "../types/index.js";

/**
 * Valid Orpheus v1 English voices currently accepted by Groq.
 * Older persona configs used tara/leah/leo/dan/mia/zac/jess; keep aliases so
 * old config values do not break TTS.
 */
function resolveOrpheusVoice(voice: string): string {
  const aliases: Record<string, string> = {
    tara: "autumn",
    leah: "diana",
    mia: "hannah",
    jess: "hannah",
    leo: "austin",
    dan: "daniel",
    zac: "troy",
  };
  const valid = new Set(["autumn", "diana", "hannah", "austin", "daniel", "troy"]);
  const v = (voice || "autumn").toLowerCase();
  const resolved = aliases[v] ?? v;
  return valid.has(resolved) ? resolved : "autumn";
}

function isTermsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("model_terms_required") || msg.includes("terms");
}

function shapeTextForEmotion(text: string, emotion: Emotion | undefined): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  switch (emotion) {
    case "concerned":
      return trimmed
        .replace(/\. /g, "... ")
        .replace(/\bI want\b/gi, "I really want")
        .replace(/\bconcern\b/gi, "real concern");
    case "skeptical":
      return trimmed
        .replace(/\bI think\b/gi, "I'm not convinced")
        .replace(/\bCan you\b/gi, "Can you clearly")
        .replace(/!+/g, ".");
    case "positive":
      return trimmed.replace(/\.$/, "!").replace(/\bThat is\b/gi, "That's genuinely");
    case "engaged":
      return trimmed.replace(/\bTell me\b/gi, "Tell me a bit more").replace(/\?$/, "?");
    default:
      return trimmed;
  }
}

async function tryOrpheusTts(
  client: Groq,
  voice: string,
  text: string
): Promise<Buffer> {
  const resolvedVoice = resolveOrpheusVoice(voice);
  const res = await client.audio.speech.create({
    model: "canopylabs/orpheus-v1-english",
    voice: resolvedVoice,
    input: text,
    response_format: "wav",
  } as Parameters<typeof client.audio.speech.create>[0]);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Synthesise speech using Groq Orpheus TTS.
 *
 * Returns a WAV buffer the browser can decode directly. If Orpheus is unavailable
 * or terms are not accepted, the caller falls back to browser speech.
 */
export async function synthesizeSentenceToWavWithGroq(
  apiKey: string | undefined,
  voice: string,
  text: string,
  emotion?: Emotion
): Promise<Buffer> {
  if (!apiKey) return Buffer.alloc(0);
  if (!text.trim()) return Buffer.alloc(0);

  const client = new Groq({ apiKey });
  const spokenText = shapeTextForEmotion(text, emotion);
  const resolvedVoice = resolveOrpheusVoice(voice);

  try {
    const buf = await tryOrpheusTts(client, resolvedVoice, spokenText);
    if (buf.length > 0) {
      console.log(`[TTS] Groq Orpheus (voice=${resolvedVoice}): ${buf.length}B WAV`);
      return buf;
    }
  } catch (err) {
    if (isTermsError(err)) {
      console.warn(
        "[TTS] Orpheus terms not accepted.\n" +
          "      Accept Orpheus at: https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english"
      );
    } else {
      console.warn("[TTS] Orpheus failed:", err instanceof Error ? err.message : err);
    }
  }

  return Buffer.alloc(0);
}
