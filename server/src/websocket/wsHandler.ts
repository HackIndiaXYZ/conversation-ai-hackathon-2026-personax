import type { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ComplianceEvent, Emotion, Message, Persona, WsClientMessage, WsServerMessage } from "../types/index.js";
import { streamClaudeResponse, stripEmotionTag, generateScoreCard } from "../services/claudeService.js";
import { synthesizeSentenceWithTimestamps } from "../services/elevenLabsService.js";
import { synthesizeSentenceToWavWithGroq } from "../services/groqTtsService.js";
import {
  alignVisemesToWavEnergy,
  bufferToBase64,
  makeSilenceWavForDuration,
  minimalSilenceWav,
  parseWavDurationSec,
  scaleVisemesToDuration,
} from "../services/audioService.js";
import { synthesizeVisemesFromText } from "../services/visemeFallbackService.js";
import { streamMuseTalkFrames } from "../services/museTalkService.js";
import { scanCompliance } from "../services/complianceService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadPersonas(): Persona[] {
  const envPath = process.env.PERSONAS_PATH;
  const path = envPath ?? join(__dirname, "../config/personas.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as Persona[];
}

interface ActiveTurnCtx {
  turnId: string;
  cancelled: boolean;
}

interface SessionCtx {
  personaId: string;
  messages: Message[];
  patientRequest: string;
  complianceEvents: ComplianceEvent[];
  activeTurn: ActiveTurnCtx | null;
}

interface LatencyCtx {
  t0: number;
  llmFirstTokenMs: number | null;
  ttsStartMs: number | null;
}

const MIN_CONTEXT_EXCHANGES = 15;
const RECENT_CONTEXT_MESSAGES = MIN_CONTEXT_EXCHANGES * 2;

function safeSend(ws: WebSocket, msg: WsServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function buildModelHistory(history: Message[]): Message[] {
  if (history.length <= RECENT_CONTEXT_MESSAGES) return history;
  return history.slice(-RECENT_CONTEXT_MESSAGES);
}

function cleanPatientRequest(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 1600);
}

function splitLeadingSentence(buffer: string): { sentence: string | null; rest: string } {
  const trimmed = buffer.trimStart();

  const sentencePunct = /([.!?])(\s|$)/;
  const sm = sentencePunct.exec(trimmed);
  if (sm && sm.index !== undefined) {
    const end = sm.index + 1;
    const sentence = trimmed.slice(0, end).trim();
    const rest = trimmed.slice(end).trimStart();
    if (sentence.length >= 4) return { sentence, rest };
  }

  const commaIdx = trimmed.indexOf(",");
  if (commaIdx > 0) {
    const before = trimmed.slice(0, commaIdx).trim();
    const wordCount = before.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 6) {
      const sentence = before + ",";
      const rest = trimmed.slice(commaIdx + 1).trimStart();
      return { sentence, rest };
    }
  }

  if (trimmed.length >= 100) {
    const slice = trimmed.slice(0, 100);
    const li = slice.lastIndexOf(" ");
    if (li > 30) {
      const sentence = trimmed.slice(0, li).trim();
      const rest = trimmed.slice(li).trimStart();
      return { sentence, rest };
    }
  }

  return { sentence: null, rest: buffer };
}

function isTurnCancelled(turn: ActiveTurnCtx) {
  return turn.cancelled;
}

export function createWsHandler() {
  const personas = loadPersonas();
  const sessions = new Map<string, SessionCtx>();

  const getPersona = (id: string): Persona | undefined => personas.find((p) => p.id === id);

  async function processSentencePipeline(
    ws: WebSocket,
    persona: Persona,
    sentence: string,
    sentenceIndex: number,
    isLast: boolean,
    emotion: Emotion,
    latency: LatencyCtx,
    turn: ActiveTurnCtx
  ) {
    if (isTurnCancelled(turn)) return;

    const elevenKey = process.env.ELEVENLABS_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const groqVoice = persona.groqVoice ?? process.env.GROQ_TTS_VOICE ?? "autumn";

    let wav: Buffer | null = null;
    let audioBase64: string | null = null;
    let audioMimeType = "audio/wav";
    let isSilence = false;
    let visemes = synthesizeVisemesFromText(sentence);
    let visemeSource: "elevenlabs_alignment" | "fallback_audio" | "fallback_text" | "fallback_static" = "fallback_text";

    if (latency.ttsStartMs === null) {
      latency.ttsStartMs = Date.now() - latency.t0;
      console.log(`[Latency] TTS start: ${latency.ttsStartMs}ms`);
    }

    if (elevenKey) {
      try {
        const res = await synthesizeSentenceWithTimestamps(elevenKey, persona.voiceId, sentence, emotion);
        if (!isTurnCancelled(turn) && res.audioBase64) {
          audioBase64 = res.audioBase64;
          audioMimeType = res.audioMimeType;
          visemes = res.visemes;
          visemeSource = res.source;
          console.log(`[TTS] ElevenLabs alignment: ${visemes.length} viseme frames`);
        }
      } catch (err) {
        console.warn("[TTS] ElevenLabs failed, trying Groq:", err instanceof Error ? err.message : err);
      }
    }

    if (!audioBase64 && groqKey && !isTurnCancelled(turn)) {
      try {
        const groqWav = await synthesizeSentenceToWavWithGroq(groqKey, groqVoice, sentence, emotion);
        if (!isTurnCancelled(turn) && groqWav.length > 0) {
          wav = groqWav;
          const rawVisemes = synthesizeVisemesFromText(sentence);
          const audioDurationSec = parseWavDurationSec(groqWav);
          const durationScaled = audioDurationSec ? scaleVisemesToDuration(rawVisemes, audioDurationSec) : rawVisemes;
          visemes = alignVisemesToWavEnergy(groqWav, durationScaled);
          visemeSource = "fallback_audio";
          console.log(
            `[TTS] Groq audio-synced visemes (voice=${groqVoice}): ${groqWav.length}B WAV, duration=${audioDurationSec?.toFixed(2) ?? "?"}s, visemes=${visemes.length}`
          );
        }
      } catch (err2) {
        console.warn("[TTS] Groq TTS failed:", err2 instanceof Error ? err2.message : String(err2));
      }
    }

    if (!audioBase64 && !wav && !isTurnCancelled(turn)) {
      isSilence = true;
      const lastFrame = visemes.reduce((max, f) => Math.max(max, f.time), 0);
      const durationSec = Math.max(0.5, lastFrame + 0.25);
      wav = makeSilenceWavForDuration(durationSec);
      console.warn(`[TTS] Both providers unavailable - sending ${durationSec.toFixed(2)}s silence for lip-sync.`);
    }

    if (wav && process.env.MUSETALK_URL && !isTurnCancelled(turn)) {
      const wavSnapshot = Buffer.from(wav);
      void (async () => {
        let frameIndex = 0;
        try {
          for await (const frameBase64 of streamMuseTalkFrames(wavSnapshot, persona.id)) {
            if (isTurnCancelled(turn)) break;
            safeSend(ws, { type: "video_frame", frameBase64, sentenceIndex, frameIndex });
            frameIndex++;
          }
        } catch (err) {
          console.warn("[MuseTalk] Frame stream error:", err instanceof Error ? err.message : err);
        }
      })();
    }

    if (isTurnCancelled(turn)) return;

    safeSend(ws, {
      type: "audio_chunk",
      turnId: turn.turnId,
      audioBase64: audioBase64 ?? bufferToBase64(wav ?? minimalSilenceWav()),
      audioMimeType: audioBase64 ? audioMimeType : "audio/wav",
      visemes,
      visemeSource,
      emotion,
      isLast,
      sentenceIndex,
      text: sentence,
      isSilence,
    });
  }

  async function emitCompleteSentences(
    ws: WebSocket,
    persona: Persona,
    buffer: { value: string },
    sentenceCounter: { value: number },
    emotion: Emotion,
    latency: LatencyCtx,
    turn: ActiveTurnCtx
  ) {
    while (!isTurnCancelled(turn)) {
      const { sentence, rest } = splitLeadingSentence(buffer.value);
      if (!sentence) break;
      buffer.value = rest;
      await processSentencePipeline(ws, persona, sentence, sentenceCounter.value, false, emotion, latency, turn);
      sentenceCounter.value += 1;
    }
  }

  async function emitFinalTail(
    ws: WebSocket,
    persona: Persona,
    buffer: { value: string },
    sentenceCounter: { value: number },
    emotion: Emotion,
    latency: LatencyCtx,
    turn: ActiveTurnCtx
  ) {
    if (isTurnCancelled(turn)) return;

    await emitCompleteSentences(ws, persona, buffer, sentenceCounter, emotion, latency, turn);
    if (isTurnCancelled(turn)) return;

    const tail = buffer.value.trim();
    if (tail.length) {
      await processSentencePipeline(ws, persona, tail, sentenceCounter.value, true, emotion, latency, turn);
      sentenceCounter.value += 1;
      buffer.value = "";
      return;
    }

    if (sentenceCounter.value === 0) {
      await processSentencePipeline(ws, persona, "Thanks for your time.", 0, true, emotion, latency, turn);
      return;
    }

    safeSend(ws, {
      type: "audio_chunk",
      turnId: turn.turnId,
      audioBase64: bufferToBase64(minimalSilenceWav()),
      audioMimeType: "audio/wav",
      visemes: [{ time: 0, viseme: "sil", weight: 0 }],
      emotion,
      isLast: true,
      sentenceIndex: sentenceCounter.value,
    });
  }

  async function streamAssistantTurn(
    ws: WebSocket,
    persona: Persona,
    history: Message[],
    patientRequest: string,
    latency: LatencyCtx,
    turn: ActiveTurnCtx
  ): Promise<{ displayText: string; emotion: Emotion } | "cancelled" | null> {
    let raw = "";
    let lastDisplayLen = 0;
    let lastEmit = 0;
    const ttsBuf = { value: "" };
    const sentenceCounter = { value: 0 };
    let emotionEmitted = false;

    try {
      for await (const { textDelta } of streamClaudeResponse(
        process.env.ANTHROPIC_API_KEY,
        persona,
        buildModelHistory(history),
        patientRequest
      )) {
        if (isTurnCancelled(turn)) return "cancelled";

        raw += textDelta;
        const { emotion, displayText } = stripEmotionTag(raw);

        if (latency.llmFirstTokenMs === null && displayText.trim().length > 0) {
          latency.llmFirstTokenMs = Date.now() - latency.t0;
          console.log(`[Latency] LLM first token: ${latency.llmFirstTokenMs}ms`);
        }

        if (!emotionEmitted && displayText.trim().length > 0) {
          safeSend(ws, { type: "emotion", turnId: turn.turnId, tag: emotion });
          emotionEmitted = true;
          console.log(`[Emotion] Emitted early: ${emotion}`);
        }

        const chunk = displayText.slice(lastDisplayLen);
        lastDisplayLen = displayText.length;
        ttsBuf.value += chunk;

        const now = Date.now();
        if (now - lastEmit > 85) {
          lastEmit = now;
          safeSend(ws, {
            type: "transcript_update",
            turnId: turn.turnId,
            role: "assistant",
            text: displayText,
            emotion,
          });
        }

        await emitCompleteSentences(ws, persona, ttsBuf, sentenceCounter, emotion, latency, turn);
      }

      if (isTurnCancelled(turn)) return "cancelled";

      const { emotion, displayText } = stripEmotionTag(raw);

      if (!emotionEmitted) {
        safeSend(ws, { type: "emotion", turnId: turn.turnId, tag: emotion });
      }

      safeSend(ws, {
        type: "transcript_update",
        turnId: turn.turnId,
        role: "assistant",
        text: displayText,
        emotion,
      });

      await emitFinalTail(ws, persona, ttsBuf, sentenceCounter, emotion, latency, turn);
      if (isTurnCancelled(turn)) return "cancelled";

      const totalMs = Date.now() - latency.t0;
      safeSend(ws, {
        type: "latency",
        turnId: turn.turnId,
        stt_ms: 0,
        llm_first_token_ms: latency.llmFirstTokenMs ?? 0,
        tts_start_ms: latency.ttsStartMs ?? 0,
        total_ms: totalMs,
      });
      console.log(
        `[Latency] Turn complete - LLM: ${latency.llmFirstTokenMs ?? "?"}ms, TTS start: ${latency.ttsStartMs ?? "?"}ms, Total: ${totalMs}ms`
      );

      return { displayText, emotion };
    } catch (err) {
      if (isTurnCancelled(turn)) return "cancelled";

      const msg = err instanceof Error ? err.message : String(err);
      console.error("[streamAssistantTurn] error:", msg);
      let clientMsg = "An error occurred while generating the response.";
      if (msg.includes("credit balance is too low") || msg.includes("billing")) {
        clientMsg = "API: insufficient credits. Please check your API keys and billing.";
      } else if (msg.includes("401") || msg.includes("authentication")) {
        clientMsg = "API: invalid API key. Check GROQ_API_KEY / ANTHROPIC_API_KEY in server/.env";
      } else if (msg.includes("rate")) {
        clientMsg = "API: rate limited. Please wait a moment and try again.";
      }
      safeSend(ws, { type: "error", message: clientMsg });
      return null;
    }
  }

  function buildIntroGreeting(persona: Persona, patientRequest = "") {
    return patientRequest.trim()
      ? `[CONCERNED]\nHello - I'm ${persona.name}. I saw the patient context you shared. Before we talk product, I want to understand how your data helps with that specific concern.`
      : `[ENGAGED]\nHello - I'm ${persona.name}. I only have a few minutes, but I'm listening. What should we focus on today?`;
  }

  async function sendIntro(
    ws: WebSocket,
    persona: Persona,
    latency: LatencyCtx,
    patientRequest = "",
    turn: ActiveTurnCtx
  ) {
    const greeting = buildIntroGreeting(persona, patientRequest);
    const { emotion, displayText } = stripEmotionTag(greeting);
    safeSend(ws, { type: "emotion", turnId: turn.turnId, tag: emotion });
    safeSend(ws, {
      type: "transcript_update",
      turnId: turn.turnId,
      role: "assistant",
      text: displayText,
      emotion,
    });
    const ttsBuf = { value: displayText };
    const sentenceCounter = { value: 0 };
    await emitFinalTail(ws, persona, ttsBuf, sentenceCounter, emotion, latency, turn);
    return { emotion, displayText };
  }

  return async function handleMessage(ws: WebSocket, raw: string) {
    let msg: WsClientMessage;
    try {
      msg = JSON.parse(raw) as WsClientMessage;
    } catch {
      safeSend(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    if (msg.type === "session_start") {
      const persona = getPersona(msg.personaId);
      if (!persona) {
        safeSend(ws, { type: "error", message: "Unknown persona" });
        return;
      }

      const patientRequest = cleanPatientRequest(msg.patientRequest);
      const existing = sessions.get(msg.sessionId);
      const cap = {
        type: "capabilities" as const,
        sessionId: msg.sessionId,
        alignment: { available: !!process.env.ELEVENLABS_API_KEY || !!process.env.GROQ_API_KEY },
        tts: {
          elevenLabsConfigured: !!process.env.ELEVENLABS_API_KEY,
          groqConfigured: !!process.env.GROQ_API_KEY,
        },
        musetalk: { available: !!process.env.MUSETALK_URL },
      };

      if (existing) {
        existing.patientRequest = patientRequest || existing.patientRequest;
        safeSend(ws, { type: "session_start", sessionId: msg.sessionId, personaId: msg.personaId });
        safeSend(ws, cap);
        return;
      }

      const session: SessionCtx = {
        personaId: persona.id,
        messages: [],
        patientRequest,
        complianceEvents: [],
        activeTurn: null,
      };
      sessions.set(msg.sessionId, session);
      safeSend(ws, { type: "session_start", sessionId: msg.sessionId, personaId: msg.personaId });
      safeSend(ws, cap);

      const introLatency: LatencyCtx = { t0: Date.now(), llmFirstTokenMs: null, ttsStartMs: null };
      const introTurn: ActiveTurnCtx = { turnId: `intro:${msg.sessionId}`, cancelled: false };
      session.activeTurn = introTurn;
      const intro = await sendIntro(ws, persona, introLatency, patientRequest, introTurn);
      if (!introTurn.cancelled) {
        session.messages.push({
          role: "assistant",
          content: intro.displayText,
          emotion: intro.emotion,
          timestamp: Date.now(),
        });
      }
      if (session.activeTurn === introTurn) {
        session.activeTurn = null;
      }
      return;
    }

    if (msg.type === "interrupt") {
      const ctx = sessions.get(msg.sessionId);
      if (!ctx?.activeTurn) return;
      if (!msg.turnId || ctx.activeTurn.turnId === msg.turnId) {
        ctx.activeTurn.cancelled = true;
      }
      return;
    }

    if (msg.type === "session_end") {
      const ctx = sessions.get(msg.sessionId);
      if (!ctx) {
        safeSend(ws, { type: "session_end", sessionId: msg.sessionId });
        return;
      }

      if (ctx.activeTurn) {
        ctx.activeTurn.cancelled = true;
        ctx.activeTurn = null;
      }

      const history = [...ctx.messages];
      sessions.delete(msg.sessionId);
      safeSend(ws, { type: "session_end", sessionId: msg.sessionId });

      if (history.length > 0) {
        generateScoreCard(history)
          .then((scoreCard) => {
            if (scoreCard) {
              safeSend(ws, { type: "session_scorecard", sessionId: msg.sessionId, scoreCard });
            }
          })
          .catch((err) => {
            console.warn("[ScoreCard] Async error (non-fatal):", err instanceof Error ? err.message : err);
          });
      }
      return;
    }

    if (msg.type === "user_input") {
      const ctx = sessions.get(msg.sessionId);
      const persona = getPersona(msg.personaId);
      if (!ctx || !persona) {
        safeSend(ws, { type: "error", message: "Unknown session or persona" });
        return;
      }

      if (ctx.activeTurn) {
        ctx.activeTurn.cancelled = true;
      }

      const latency: LatencyCtx = { t0: Date.now(), llmFirstTokenMs: null, ttsStartMs: null };
      const turn: ActiveTurnCtx = { turnId: msg.turnId, cancelled: false };
      ctx.activeTurn = turn;
      console.log(`[Latency] Turn started for session ${msg.sessionId.slice(0, 8)} turn ${msg.turnId.slice(0, 8)}`);

      const nextPatientRequest = cleanPatientRequest(msg.patientRequest);
      if (nextPatientRequest) ctx.patientRequest = nextPatientRequest;

      const complianceEvents = scanCompliance(msg.text, msg.turnId);
      if (complianceEvents.length > 0) {
        ctx.complianceEvents.push(...complianceEvents);
        for (const event of complianceEvents) {
          safeSend(ws, { type: "compliance_event", sessionId: msg.sessionId, event });
        }
      }

      ctx.messages.push({ role: "user", content: msg.text, timestamp: Date.now() });
      const history = [...ctx.messages];
      const result = await streamAssistantTurn(ws, persona, history, ctx.patientRequest, latency, turn);

      if (ctx.activeTurn === turn) {
        ctx.activeTurn = null;
      }

      if (result && result !== "cancelled") {
        ctx.messages.push({
          role: "assistant",
          content: result.displayText,
          emotion: result.emotion,
          timestamp: Date.now(),
        });
      }
    }
  };
}
