import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ComplianceEvent,
  Emotion,
  ScoreCard,
  VisemeKeyframe,
  VisemeSource,
  WsClientMessage,
  WsServerMessage,
} from "../types";
import { useSessionStore } from "../store/sessionStore";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:3001";

export interface AudioChunkPayload {
  turnId: string;
  audioBase64: string;
  audioMimeType: string;
  visemes: VisemeKeyframe[];
  visemeSource?: VisemeSource;
  emotion?: Emotion;
  isLast: boolean;
  sentenceIndex: number;
  text?: string;
  isSilence?: boolean;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const intentionalCloseRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const connectAttemptRef = useRef(0);
  const onAudioChunkRef = useRef<(p: AudioChunkPayload) => void>(() => {});
  const onTranscriptRef = useRef<(payload: { turnId: string; text: string; emotion: Emotion }) => void>(() => {});
  const onErrorRef = useRef<(msg: string) => void>(() => {});
  const onScoreCardRef = useRef<(card: ScoreCard) => void>(() => {});
  const onComplianceEventRef = useRef<(event: ComplianceEvent) => void>(() => {});

  const setCurrentEmotion = useSessionStore((s) => s.setCurrentEmotion);
  const clearAssistantStream = useSessionStore((s) => s.clearAssistantStream);
  const setAssistantStreamingText = useSessionStore((s) => s.setAssistantStreamingText);
  const markLlmLatencyIfNeeded = useSessionStore((s) => s.markLlmLatencyIfNeeded);
  const setCapabilities = useSessionStore((s) => s.setCapabilities);
  const setWsProtocolVersion = useSessionStore((s) => s.setWsProtocolVersion);
  const setServerLatency = useSessionStore((s) => s.setServerLatency);

  const candidateUrls = useCallback((): string[] => {
    const out = [WS_URL];
    if (/^ws:\/\/localhost(:\d+)?/i.test(WS_URL)) {
      out.push(WS_URL.replace(/^ws:\/\/localhost/i, "ws://127.0.0.1"));
    }
    return Array.from(new Set(out));
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    intentionalCloseRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const urls = candidateUrls();
    const attempt = connectAttemptRef.current % urls.length;
    const url = urls[attempt];
    connectAttemptRef.current += 1;

    let opened = false;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      opened = true;
      reconnectAttemptRef.current = 0;
      setConnected(true);
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      setWsProtocolVersion(null);
      if (!opened && urls.length > 1 && attempt === 0) {
        onErrorRef.current(`WebSocket failed at ${url}, retrying ${urls[1]}...`);
        queueMicrotask(() => connect());
        return;
      }

      const state = useSessionStore.getState();
      if (!intentionalCloseRef.current && (state.isSessionActive || state.isGeneratingDebrief) && opened && reconnectAttemptRef.current < 8) {
        reconnectAttemptRef.current += 1;
        const delay = Math.min(10_000, 600 * reconnectAttemptRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, delay);
        onErrorRef.current(`WebSocket disconnected - reconnecting (${reconnectAttemptRef.current}/8)...`);
      }
    };

    ws.onerror = () => {
      onErrorRef.current(`WebSocket connection error (${url})`);
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as WsServerMessage;
        if (data.type === "error") {
          onErrorRef.current(data.message);
          return;
        }
        if (data.type === "hello") {
          setWsProtocolVersion(data.protocolVersion);
          return;
        }
        if (data.type === "audio_chunk") {
          onAudioChunkRef.current({
            turnId: data.turnId,
            audioBase64: data.audioBase64,
            audioMimeType: data.audioMimeType,
            visemes: data.visemes,
            visemeSource: data.visemeSource,
            emotion: data.emotion,
            isLast: data.isLast,
            sentenceIndex: data.sentenceIndex,
            text: data.text,
            isSilence: data.isSilence,
          });
          return;
        }
        if (data.type === "capabilities") {
          setCapabilities({
            alignmentAvailable: data.alignment.available,
            elevenLabsConfigured: data.tts.elevenLabsConfigured,
            groqConfigured: data.tts.groqConfigured,
          });
          return;
        }
        if (data.type === "transcript_update") {
          setCurrentEmotion(data.emotion);
          markLlmLatencyIfNeeded(data.text);
          setAssistantStreamingText(data.text);
          onTranscriptRef.current({ turnId: data.turnId, text: data.text, emotion: data.emotion });
          return;
        }
        if (data.type === "session_end") {
          clearAssistantStream();
          return;
        }
        if (data.type === "session_scorecard") {
          onScoreCardRef.current(data.scoreCard);
          return;
        }
        if (data.type === "compliance_event") {
          onComplianceEventRef.current(data.event);
          return;
        }
        if (data.type === "emotion") {
          setCurrentEmotion(data.tag);
          return;
        }
        if (data.type === "latency") {
          setServerLatency({
            stt_ms: data.stt_ms,
            llm_first_token_ms: data.llm_first_token_ms,
            tts_start_ms: data.tts_start_ms,
            total_ms: data.total_ms,
          });
          console.log(
            `[Latency] Server reported - LLM: ${data.llm_first_token_ms}ms, TTS: ${data.tts_start_ms}ms, Total: ${data.total_ms}ms`
          );
        }
      } catch {
        onErrorRef.current("Invalid message from server");
      }
    };
  }, [
    candidateUrls,
    clearAssistantStream,
    markLlmLatencyIfNeeded,
    setAssistantStreamingText,
    setCapabilities,
    setCurrentEmotion,
    setServerLatency,
    setWsProtocolVersion,
  ]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  const send = useCallback((msg: WsClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      onErrorRef.current("Not connected");
      return false;
    }
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  const setOnAudioChunk = useCallback((fn: (p: AudioChunkPayload) => void) => {
    onAudioChunkRef.current = fn;
  }, []);

  const setOnTranscriptUpdate = useCallback((fn: (payload: { turnId: string; text: string; emotion: Emotion }) => void) => {
    onTranscriptRef.current = fn;
  }, []);

  const setOnError = useCallback((fn: (msg: string) => void) => {
    onErrorRef.current = fn;
  }, []);

  const setOnScoreCard = useCallback((fn: (card: ScoreCard) => void) => {
    onScoreCardRef.current = fn;
  }, []);

  const setOnComplianceEvent = useCallback((fn: (event: ComplianceEvent) => void) => {
    onComplianceEventRef.current = fn;
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  return {
    connected,
    connect,
    disconnect,
    send,
    setOnAudioChunk,
    setOnTranscriptUpdate,
    setOnError,
    setOnScoreCard,
    setOnComplianceEvent,
  };
}
