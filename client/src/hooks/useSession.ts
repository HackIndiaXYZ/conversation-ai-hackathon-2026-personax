import { useCallback, useEffect, useMemo, useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import type { Message, Persona } from "../types";
import personasJson from "../config/personas.json";

export function useSession() {
  const personas = personasJson as Persona[];
  const sessionId = useSessionStore((s) => s.sessionId);
  const personaId = useSessionStore((s) => s.personaId);
  const isSessionActive = useSessionStore((s) => s.isSessionActive);
  const startedAt = useSessionStore((s) => s.startedAt);
  const messages = useSessionStore((s) => s.messages);
  const patientRequest = useSessionStore((s) => s.patientRequest);
  const setPatientRequest = useSessionStore((s) => s.setPatientRequest);
  const setSessionId = useSessionStore((s) => s.setSessionId);
  const setPersonaId = useSessionStore((s) => s.setPersonaId);
  const setSessionActive = useSessionStore((s) => s.setSessionActive);
  const setStartedAt = useSessionStore((s) => s.setStartedAt);
  const addMessage = useSessionStore((s) => s.addMessage);
  const resetSession = useSessionStore((s) => s.resetSession);
  const finalizeAssistantMessage = useSessionStore((s) => s.finalizeAssistantMessage);
  const clearAssistantStream = useSessionStore((s) => s.clearAssistantStream);
  const assistantStreamingText = useSessionStore((s) => s.assistantStreamingText);
  const currentEmotion = useSessionStore((s) => s.currentEmotion);
  const liveUserTranscript = useSessionStore((s) => s.liveUserTranscript);
  const isGeneratingDebrief = useSessionStore((s) => s.isGeneratingDebrief);
  const setGeneratingDebrief = useSessionStore((s) => s.setGeneratingDebrief);
  const clearComplianceEvents = useSessionStore((s) => s.clearComplianceEvents);

  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!isSessionActive || !startedAt) {
      setElapsedSec(0);
      return;
    }
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isSessionActive, startedAt]);

  const startSession = useCallback(() => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sess_${Date.now()}`;
    setSessionId(id);
    setSessionActive(true);
    setStartedAt(Date.now());
    clearAssistantStream();
    setGeneratingDebrief(false);
    clearComplianceEvents();
  }, [clearAssistantStream, clearComplianceEvents, setGeneratingDebrief, setSessionActive, setSessionId, setStartedAt]);

  const endSession = useCallback(() => {
    setSessionActive(false);
    setStartedAt(null);
    clearAssistantStream();
  }, [clearAssistantStream, setSessionActive, setStartedAt]);

  const appendUserMessage = useCallback(
    (text: string) => {
      const m: Message = { role: "user", content: text, timestamp: Date.now() };
      addMessage(m);
    },
    [addMessage]
  );

  const completeAssistantTurn = useCallback(() => {
    const text = useSessionStore.getState().assistantStreamingText.trim();
    if (!text) return;
    finalizeAssistantMessage(text, useSessionStore.getState().currentEmotion);
    clearAssistantStream();
  }, [clearAssistantStream, finalizeAssistantMessage]);

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === personaId),
    [personaId, personas]
  );

  return {
    personas,
    personaId,
    setPersonaId,
    selectedPersona,
    sessionId,
    isSessionActive,
    startedAt,
    messages,
    patientRequest,
    setPatientRequest,
    elapsedSec,
    startSession,
    endSession,
    resetSession,
    appendUserMessage,
    completeAssistantTurn,
    assistantStreamingText,
    currentEmotion,
    liveUserTranscript,
    isGeneratingDebrief,
    setGeneratingDebrief,
  };
}
