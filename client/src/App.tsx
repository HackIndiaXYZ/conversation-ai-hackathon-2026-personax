import { useCallback, useEffect, useState } from "react";
import { AvatarCanvas } from "./components/AvatarCanvas";
import { LatencyHud } from "./components/LatencyHud";
import { SpeakingWaveform } from "./components/SpeakingWaveform";
import { ComplianceMonitor } from "./components/ComplianceMonitor";
import { PersonaSelector } from "./components/PersonaSelector";
import { PatientRequestPanel } from "./components/PatientRequestPanel";
import { SessionControls } from "./components/SessionControls";
import { Transcript } from "./components/Transcript";
import { TextQuestionInput } from "./components/TextQuestionInput";
import { VoiceInput } from "./components/VoiceInput";
import { LipSyncDiagnostics } from "./components/LipSyncDiagnostics";
import { ThemeToggle } from "./components/ThemeToggle";
import { ScoreCard } from "./components/ScoreCard";
import { useAudioPlayback } from "./hooks/useAudioPlayback";
import { useSession } from "./hooks/useSession";
import { useTheme } from "./hooks/useTheme";
import { useVoiceInput } from "./hooks/useVoiceInput";
import { useProximAvatarSession } from "./sdk/useProximAvatarSession";
import { useAvatarStore } from "./store/avatarStore";
import { useSessionStore } from "./store/sessionStore";
import type { ScoreCard as ScoreCardType } from "./types";

const INTERRUPTIBLE_VOICE_ENABLED = import.meta.env.VITE_ENABLE_BARGE_IN === "true";

export default function App() {
  const {
    personas,
    personaId,
    setPersonaId,
    selectedPersona,
    sessionId,
    isSessionActive,
    elapsedSec,
    startSession,
    endSession,
    appendUserMessage,
    completeAssistantTurn,
    assistantStreamingText,
    messages,
    patientRequest,
    setPatientRequest,
    liveUserTranscript,
    isGeneratingDebrief,
  } = useSession();

  const sidebarOpen = useSessionStore((s) => s.sidebarOpen);
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar);
  const setMicError = useSessionStore((s) => s.setMicError);
  const micError = useSessionStore((s) => s.micError);
  const audioUnlocked = useSessionStore((s) => s.audioUnlocked);
  const setAudioUnlocked = useSessionStore((s) => s.setAudioUnlocked);
  const setLiveUserTranscript = useSessionStore((s) => s.setLiveUserTranscript);
  const capabilities = useSessionStore((s) => s.capabilities);
  const beginLatencyTurn = useSessionStore((s) => s.beginLatencyTurn);
  const markAudioLatencyIfNeeded = useSessionStore((s) => s.markAudioLatencyIfNeeded);
  const clearLatencyTurn = useSessionStore((s) => s.clearLatencyTurn);
  const clearAssistantStream = useSessionStore((s) => s.clearAssistantStream);
  const { session, connected, disconnect, setOnError } = useProximAvatarSession();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [scoreCard, setScoreCard] = useState<ScoreCardType | null>(null);
  const { theme, toggleTheme } = useTheme();

  const { enqueue, ensureCtx, analyserNode, isPlaying: avatarSpeaking, clearQueue, stopCurrent } = useAudioPlayback(() => {
    completeAssistantTurn();
  });

  const handleUserText = useCallback(
    (text: string) => {
      if (!sessionId || !personaId || !text.trim()) return;
      setLiveUserTranscript("");
      beginLatencyTurn();
      appendUserMessage(text.trim());
      session.sendText(text.trim(), { sessionId, personaId, patientRequest });
    },
    [appendUserMessage, beginLatencyTurn, patientRequest, personaId, session, sessionId, setLiveUserTranscript]
  );

  const { listening, partialTranscript, mode, startListening, stopListening, tapToSpeak } =
    useVoiceInput({
      enabled: isSessionActive && audioUnlocked,
      avatarSpeaking,
      interruptAvatarPlayback: INTERRUPTIBLE_VOICE_ENABLED,
      onInterruptionStart: () => {
        stopCurrent();
        clearQueue();
        clearAssistantStream();
        session.interrupt();
      },
      onUtterance: handleUserText,
      onPartial: (text) => setLiveUserTranscript(text),
      onError: (m) => setMicError(m),
    });

  useEffect(() => {
    const offAudio = session.onAudioChunk((chunk) => {
      // Diagnostics: record chunk metadata as soon as it arrives (playback may start later).
      const receivedAt = performance.now();
      useAvatarStore.getState().setLastChunkMeta({
        sentenceIndex: chunk.sentenceIndex,
        isSilence: !!chunk.isSilence,
        visemeSource: chunk.visemeSource ?? null,
        receivedAt,
      });

      markAudioLatencyIfNeeded();
      enqueue({
        audioBase64: chunk.audioBase64,
        audioMimeType: chunk.audioMimeType,
        visemes: chunk.visemes,
        visemeSource: chunk.visemeSource,
        emotion: chunk.emotion,
        isLast: chunk.isLast,
        sentenceIndex: chunk.sentenceIndex,
        text: chunk.text,
        isSilence: chunk.isSilence,
        receivedAt,
      });
    });
    setOnError((m) => setMicError(m));
    const offScorecard = session.onScorecard((card) => setScoreCard(card));
    return () => {
      offAudio();
      offScorecard();
    };
  }, [enqueue, markAudioLatencyIfNeeded, session, setOnError, setMicError]);

  const handleStart = async () => {
    if (!personaId) return;
    setMicError(null);
    setScoreCard(null);
    clearLatencyTurn();
    await ensureCtx();
    setAudioUnlocked(true);
    startSession();
    session.startSession({
      sessionId: useSessionStore.getState().sessionId ?? "",
      personaId,
      patientRequest: useSessionStore.getState().patientRequest,
    });
    void startListening();
  };

  const handleEnd = () => {
    const sid = sessionId;
    if (sid) session.endSession(sid);
    stopListening();
    clearLatencyTurn();
    setLiveUserTranscript("");
    endSession();
  };

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return (
    <div className="app-shell flex flex-col">
      {/* Post-call ScoreCard modal */}
      {scoreCard && !isSessionActive ? (
        <ScoreCard
          scoreCard={scoreCard}
          personaName={selectedPersona?.name ?? "Physician"}
          onClose={() => setScoreCard(null)}
        />
      ) : null}

      <header className="topbar px-4 py-4 md:px-8">
        <div className="container-app flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-display text-2xl font-bold tracking-tight">Proxim</p>
            <p className="text-sm text-muted">AI-powered HCP roleplay platform for pharmaceutical sales</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <SessionControls
              active={isSessionActive}
              elapsedSec={elapsedSec}
              canStart={!!personaId && !isSessionActive}
              generatingDebrief={isGeneratingDebrief}
              onStart={handleStart}
              onEnd={handleEnd}
            />
          </div>
        </div>
      </header>

      <main className="container-app flex min-h-0 flex-1 flex-col gap-6 py-6 md:flex-row">
        <section className="flex min-h-0 flex-1 flex-col gap-4">
          {!isSessionActive ? (
            <>
              <h2 className="font-display text-lg font-semibold">Choose a Simulated Physician</h2>
              <PersonaSelector
                personas={personas}
                selectedId={personaId}
                onSelect={setPersonaId}
                disabled={false}
              />
              <PatientRequestPanel
                value={patientRequest}
                onChange={setPatientRequest}
                disabled={false}
              />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="kicker">Active Simulated Physician</p>
                  <p className="font-display text-lg font-semibold">
                    {selectedPersona?.name}{" "}
                    <span className="text-sm font-normal text-muted">
                      · {selectedPersona?.specialty}
                    </span>
                    {selectedPersona?.complianceMode ? (
                      <span
                        style={{
                          marginLeft: 8,
                          display: "inline-block",
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "rgba(34,197,94,0.15)",
                          color: "#22c55e",
                          border: "1px solid rgba(34,197,94,0.3)",
                          verticalAlign: "middle",
                        }}
                      >
                        MLR-Safe
                      </span>
                    ) : null}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="btn px-3 py-1.5 text-xs md:hidden"
                >
                  {sidebarOpen ? "Hide Call Log" : "Show Call Log"}
                </button>
              </div>

              <div className="relative">
                <LatencyHud />
                <AvatarCanvas key={personaId ?? "none"} avatarUrl={selectedPersona?.avatarUrl ?? ""} personaId={personaId} />
                <SpeakingWaveform analyser={analyserNode} />
              </div>

              <VoiceInput
                partialTranscript={partialTranscript}
                listening={listening}
                mode={mode}
                onTapToSpeak={() => {
                  void ensureCtx();
                  void tapToSpeak();
                }}
              />

              <PatientRequestPanel
                value={patientRequest}
                onChange={setPatientRequest}
                disabled={false}
              />

              <TextQuestionInput onSend={handleUserText} disabled={!connected} />

              {micError ? (
                <p className="panel border border-border px-4 py-2 text-sm" style={{ borderColor: "rgba(245, 158, 11, 0.45)" }}>
                  {micError}
                </p>
              ) : null}

              {!audioUnlocked ? (
                <p className="text-xs text-muted">
                  Audio unlocks when you begin a practice call (required on mobile browsers).
                </p>
              ) : null}

              <p className="text-xs text-muted">
                WebSocket: {connected ? "connected" : "disconnected"}
                {capabilities.alignmentAvailable != null ? (
                  <>
                    {" "}
                    · Lip-sync: {capabilities.alignmentAvailable ? "alignment" : "fallback"}
                  </>
                ) : null}
                {capabilities.elevenLabsConfigured != null && capabilities.groqConfigured != null ? (
                  <>
                    {" "}
                    · TTS:{" "}
                    {capabilities.elevenLabsConfigured ? "ElevenLabs" : null}
                    {capabilities.elevenLabsConfigured && capabilities.groqConfigured ? " + " : null}
                    {capabilities.groqConfigured ? "Groq" : null}
                    {!capabilities.elevenLabsConfigured && !capabilities.groqConfigured ? "none" : null}
                  </>
                ) : null}{" "}
                · Voice: Web Speech API (Google, free) → server Whisper fallback.
              </p>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowDiagnostics((v) => !v)}
                  className="btn px-3 py-1.5 text-xs"
                >
                  {showDiagnostics ? "Hide lip-sync diagnostics" : "Show lip-sync diagnostics"}
                </button>
              </div>

              {showDiagnostics ? <LipSyncDiagnostics /> : null}
            </>
          )}
        </section>

        {isSessionActive ? (
          <Transcript
            open={sidebarOpen}
            onToggle={toggleSidebar}
            messages={messages}
            streamingAssistant={assistantStreamingText}
            liveUserTranscript={liveUserTranscript}
            footer={<ComplianceMonitor />}
          />
        ) : null}
      </main>

      <footer className="border-t border-border px-4 py-4 text-center text-[11px] text-muted">
        Proxim · Conversation AI Hackathon 2026 · MIT License
      </footer>
    </div>
  );
}
