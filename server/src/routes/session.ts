import { Router } from "express";
import multer from "multer";
import Groq from "groq-sdk";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

export const sessionRouter = Router();

const STT_MODEL = process.env.GROQ_STT_MODEL ?? "whisper-large-v3-turbo";

function estimateWavDurationSec(buf: Buffer): number | null {
  if (buf.length < 44) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  const sampleRate = buf.readUInt32LE(24);
  const channels = buf.readUInt16LE(22);
  const bitsPerSample = buf.readUInt16LE(34);
  const dataBytes = buf.readUInt32LE(40);
  if (!sampleRate || !channels || !bitsPerSample) return null;
  const bytesPerSample = bitsPerSample / 8;
  if (!bytesPerSample) return null;
  const durationSec = dataBytes / (sampleRate * channels * bytesPerSample);
  return Number.isFinite(durationSec) ? durationSec : null;
}

/** Optional REST mirror for future clients; primary path is WebSocket. */
sessionRouter.post("/message", (_req, res) => {
  res.status(501).json({ error: "Use WebSocket user_input messages for the live pipeline." });
});

/**
 * POST /session/transcribe — transcribes a WAV/WebM audio clip via Groq Whisper.
 *
 * Uses `whisper-large-v3-turbo` with:
 *   - temperature 0  (deterministic, no hallucinations)
 *   - language "en"  (skip auto-detection step, faster)
 *   - verbose_json   (mirrors Groq playground behaviour)
 *
 * Falls back to OpenAI whisper-1 if GROQ_API_KEY is not set.
 */
sessionRouter.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({ error: "missing audio" });
      return;
    }

    const groqKey = process.env.GROQ_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!groqKey && !openaiKey) {
      res.status(501).json({
        text: "",
        error: "Whisper STT not configured — set GROQ_API_KEY or OPENAI_API_KEY in server/.env",
      });
      return;
    }

    let text = "";

    // ── Primary: Groq Whisper via SDK ─────────────────────────────────────────
    if (groqKey) {
      const groq = new Groq({ apiKey: groqKey });

      // Node 18 global File — turn the multer buffer into a proper File object
      // so the Groq SDK can set the correct filename/MIME in the multipart body.
      const mimeType =
        file.mimetype ||
        (file.originalname?.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/webm");
      // Copy Buffer into a plain ArrayBuffer so the global File constructor accepts it.
      const ab = file.buffer.buffer.slice(
        file.buffer.byteOffset,
        file.buffer.byteOffset + file.buffer.byteLength
      ) as ArrayBuffer;
      const audioFile = new File([ab], file.originalname || "audio.wav", {
        type: mimeType,
      });

      const transcription = await groq.audio.transcriptions.create({
        file: audioFile,
        model: STT_MODEL,          // whisper-large-v3-turbo (or GROQ_STT_MODEL override)
        temperature: 0,             // deterministic — eliminates random hallucinations
        language: "en",             // skip language-detection step for ~50ms latency saving
        response_format: "verbose_json", // mirrors Groq playground behaviour
      } as Parameters<typeof groq.audio.transcriptions.create>[0]);

      text = ((transcription as unknown as { text?: string }).text ?? "").trim();
      console.log(`[STT] Groq ${STT_MODEL} → "${text}"`);
    }

    // ── Fallback: OpenAI whisper-1 via raw fetch ──────────────────────────────
    if (!text && openaiKey) {
      const form = new FormData();
      const bytes = new Uint8Array(file.buffer);
      const blob = new Blob([bytes], { type: file.mimetype || "audio/webm" });
      form.append("file", blob, file.originalname || "audio.webm");
      form.append("model", "whisper-1");
      form.append("language", "en");
      form.append("temperature", "0");

      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: form,
      });
      if (r.ok) {
        const data = (await r.json()) as { text?: string };
        text = (data.text ?? "").trim();
        console.log(`[STT] OpenAI whisper-1 fallback → "${text}"`);
      } else {
        const err = await r.text().catch(() => "");
        console.warn(`[STT] OpenAI whisper-1 failed: ${r.status} ${err}`);
      }
    }

    // ── Hallucination filter ──────────────────────────────────────────────────
    const lower = text.toLowerCase().replace(/[.!?,]/g, "").trim();
    const durationSec = estimateWavDurationSec(file.buffer);
    const HALLUCINATIONS = new Set([
      "you", "you you", "you you you", "you you you you",
      "thank you", "thank you thank you", "thank you thank you thank you",
      "thanks", "thanks thanks",
      "thanks for watching", "thank you for watching", "thank you for listening",
      "the", "a", "i",
      "hmm", "um", "uh", "oh", "ah",
      "bye", "bye bye",
      "subtitles by", "captions by",
      "♪", "[music]", "[silence]", "[noise]", "[inaudible]", "www",
    ]);
    const likelyNoise =
      lower === "" || (HALLUCINATIONS.has(lower) && durationSec != null && durationSec < 2.5);
    if (likelyNoise) text = "";

    const durMsg = durationSec != null ? `${durationSec.toFixed(2)}s` : "?s";
    console.log(`[STT] Final transcript (${durMsg}): "${text}"`);
    res.json({ text });
  } catch (e) {
    console.error("[STT] transcribe error:", e);
    res.status(500).json({ text: "", error: e instanceof Error ? e.message : "transcribe failed" });
  }
});
