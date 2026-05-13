import type { AudioChunkPayload } from "../hooks/useWebSocket";
import type { ComplianceEvent, Emotion, ScoreCard } from "../types";

type TranscriptHandler = (payload: { turnId: string; text: string; emotion: Emotion }) => void;
type AudioHandler = (payload: AudioChunkPayload) => void;
type ComplianceHandler = (event: ComplianceEvent) => void;
type ScorecardHandler = (card: ScoreCard) => void;

type SessionActions = {
  startSession: (config: { sessionId: string; personaId: string; patientRequest?: string }) => void;
  sendText: (text: string, config: { sessionId: string; personaId: string; patientRequest?: string }) => string | null;
  sendAudio: (blob: Blob, config: { sessionId: string; personaId: string; patientRequest?: string }) => Promise<string | null>;
  interrupt: () => void;
  endSession: (sessionId: string) => void;
};

export class ProximAvatarSession {
  private transcriptHandlers = new Set<TranscriptHandler>();
  private audioHandlers = new Set<AudioHandler>();
  private complianceHandlers = new Set<ComplianceHandler>();
  private scorecardHandlers = new Set<ScorecardHandler>();

  constructor(private readonly actions: SessionActions) {}

  startSession(config: { sessionId: string; personaId: string; patientRequest?: string }) {
    this.actions.startSession(config);
  }

  sendText(text: string, config: { sessionId: string; personaId: string; patientRequest?: string }) {
    return this.actions.sendText(text, config);
  }

  sendAudio(blob: Blob, config: { sessionId: string; personaId: string; patientRequest?: string }) {
    return this.actions.sendAudio(blob, config);
  }

  interrupt() {
    this.actions.interrupt();
  }

  endSession(sessionId: string) {
    this.actions.endSession(sessionId);
  }

  onTranscript(handler: TranscriptHandler) {
    this.transcriptHandlers.add(handler);
    return () => this.transcriptHandlers.delete(handler);
  }

  onAudioChunk(handler: AudioHandler) {
    this.audioHandlers.add(handler);
    return () => this.audioHandlers.delete(handler);
  }

  onComplianceEvent(handler: ComplianceHandler) {
    this.complianceHandlers.add(handler);
    return () => this.complianceHandlers.delete(handler);
  }

  onScorecard(handler: ScorecardHandler) {
    this.scorecardHandlers.add(handler);
    return () => this.scorecardHandlers.delete(handler);
  }

  emitTranscript(payload: { turnId: string; text: string; emotion: Emotion }) {
    for (const handler of this.transcriptHandlers) handler(payload);
  }

  emitAudioChunk(payload: AudioChunkPayload) {
    for (const handler of this.audioHandlers) handler(payload);
  }

  emitComplianceEvent(event: ComplianceEvent) {
    for (const handler of this.complianceHandlers) handler(event);
  }

  emitScorecard(card: ScoreCard) {
    for (const handler of this.scorecardHandlers) handler(card);
  }
}
