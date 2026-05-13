import { useEffect, useMemo, useRef } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSessionStore } from "../store/sessionStore";
import { ProximAvatarSession } from "./ProximAvatarSession";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const SCORECARD_TIMEOUT_MS = 4500;

function makeTurnId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `turn_${Date.now()}`;
}

export function useProximAvatarSession() {
  const {
    connected,
    connect,
    disconnect,
    send,
    setOnAudioChunk,
    setOnTranscriptUpdate,
    setOnError,
    setOnScoreCard,
    setOnComplianceEvent,
  } = useWebSocket();

  const setGeneratingDebrief = useSessionStore((s) => s.setGeneratingDebrief);
  const addComplianceEvent = useSessionStore((s) => s.addComplianceEvent);
  const pendingStartRef = useRef<{ sessionId: string; personaId: string; patientRequest?: string } | null>(null);
  const expectedTurnIdRef = useRef<string | null>(null);
  const activeAssistantTurnIdRef = useRef<string | null>(null);
  const scorecardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearScorecardTimeout = () => {
    if (scorecardTimeoutRef.current) {
      clearTimeout(scorecardTimeoutRef.current);
      scorecardTimeoutRef.current = null;
    }
  };

  const sendTextImpl = (text: string, config: { sessionId: string; personaId: string; patientRequest?: string }) => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const turnId = makeTurnId();
    expectedTurnIdRef.current = turnId;
    activeAssistantTurnIdRef.current = turnId;
    send({
      type: "user_input",
      text: trimmed,
      turnId,
      sessionId: config.sessionId,
      personaId: config.personaId,
      patientRequest: config.patientRequest,
    });
    return turnId;
  };

  const session = useMemo(
    () =>
      new ProximAvatarSession({
        startSession: (config) => {
          pendingStartRef.current = config;
          clearScorecardTimeout();
          setGeneratingDebrief(false);
          connect();
        },
        sendText: sendTextImpl,
        sendAudio: async (blob, config) => {
          const fd = new FormData();
          fd.append("audio", blob, "clip.wav");
          const res = await fetch(`${API_URL}/session/transcribe`, { method: "POST", body: fd });
          if (!res.ok) return null;
          const data = (await res.json()) as { text?: string };
          if (!data.text?.trim()) return null;
          return sendTextImpl(data.text, config);
        },
        interrupt: () => {
          const state = useSessionStore.getState();
          if (!state.sessionId) return;
          send({
            type: "interrupt",
            sessionId: state.sessionId,
            turnId: activeAssistantTurnIdRef.current ?? undefined,
          });
        },
        endSession: (sessionId) => {
          clearScorecardTimeout();
          setGeneratingDebrief(true);
          send({ type: "session_end", sessionId });
          scorecardTimeoutRef.current = setTimeout(() => {
            scorecardTimeoutRef.current = null;
            setGeneratingDebrief(false);
            disconnect();
          }, SCORECARD_TIMEOUT_MS);
        },
      }),
    [connect, disconnect, send, setGeneratingDebrief]
  );

  useEffect(() => {
    setOnAudioChunk((chunk) => {
      if (chunk.turnId.startsWith("intro:") || !expectedTurnIdRef.current || chunk.turnId === expectedTurnIdRef.current) {
        activeAssistantTurnIdRef.current = chunk.turnId;
        session.emitAudioChunk(chunk);
      }
    });
    setOnTranscriptUpdate((payload) => {
      if (payload.turnId.startsWith("intro:") || !expectedTurnIdRef.current || payload.turnId === expectedTurnIdRef.current) {
        activeAssistantTurnIdRef.current = payload.turnId;
        session.emitTranscript(payload);
      }
    });
    setOnComplianceEvent((event) => {
      addComplianceEvent(event);
      session.emitComplianceEvent(event);
    });
    setOnScoreCard((card) => {
      clearScorecardTimeout();
      setGeneratingDebrief(false);
      session.emitScorecard(card);
      disconnect();
    });
  }, [addComplianceEvent, disconnect, session, setGeneratingDebrief, setOnAudioChunk, setOnComplianceEvent, setOnScoreCard, setOnTranscriptUpdate]);

  useEffect(() => {
    if (!connected || !pendingStartRef.current) return;
    send({
      type: "session_start",
      sessionId: pendingStartRef.current.sessionId,
      personaId: pendingStartRef.current.personaId,
      patientRequest: pendingStartRef.current.patientRequest,
    });
  }, [connected, send]);

  useEffect(() => () => clearScorecardTimeout(), []);

  return { session, connected, disconnect, setOnError };
}
