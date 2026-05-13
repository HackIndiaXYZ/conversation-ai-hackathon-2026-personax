export type VisemeKey =
  | "sil"
  | "PP"
  | "FF"
  | "TH"
  | "DD"
  | "kk"
  | "CH"
  | "SS"
  | "nn"
  | "RR"
  | "aa"
  | "E"
  | "ih"
  | "oh"
  | "ou";

export interface VisemeKeyframe {
  time: number;
  viseme: VisemeKey;
  weight: number;
}

export type Emotion = "neutral" | "engaged" | "skeptical" | "concerned" | "positive";

export interface Message {
  role: "user" | "assistant";
  content: string;
  emotion?: Emotion;
  timestamp: number;
}

export interface Persona {
  id: string;
  name: string;
  specialty: string;
  hospital: string;
  personality: string;
  mood: string;
  /** Optional default affect tag for prompting (e.g. skeptical baseline). */
  moodBaseline?: string;
  gender?: "female" | "male";
  avatarUrl: string;
  voiceId: string;
  /** Groq Orpheus voice name for this persona (autumn | diana | hannah | austin | daniel | troy). */
  groqVoice?: string;
  systemPrompt: string;
  /** When true, the system prompt includes MLR/off-label compliance guardrails. */
  complianceMode?: boolean;
}

export type ScoreItemStatus = "pass" | "warn" | "fail";

export interface ScoreItem {
  label: string;
  status: ScoreItemStatus;
}

export interface ScoreCard {
  score: number;
  readiness: string;
  items: ScoreItem[];
  summary: string;
}

export type ComplianceSeverity = "low" | "medium" | "high";

export interface ComplianceEvent {
  id: string;
  turnId: string;
  ruleId:
    | "off_label_language"
    | "unsupported_superiority_claim"
    | "missing_safety_qualifier"
    | "absolute_efficacy_claim"
    | "guaranteed_or_risk_free";
  title: string;
  severity: ComplianceSeverity;
  excerpt: string;
  rationale: string;
  suggestion: string;
  timestamp: number;
}

export type VisemeSource =
  | "elevenlabs_alignment"
  | "fallback_audio"
  | "fallback_text"
  | "fallback_static";

/** Bump when WS payload shape changes (helps detect stale clients/servers during dev). */
export const WS_PROTOCOL_VERSION = 3;

export type WsClientMessage =
  | { type: "session_start"; sessionId: string; personaId: string; patientRequest?: string }
  | { type: "session_end"; sessionId: string }
  | { type: "interrupt"; sessionId: string; turnId?: string }
  | {
      type: "user_input";
      text: string;
      turnId: string;
      sessionId: string;
      personaId: string;
      patientRequest?: string;
    };

export type WsServerMessage =
  | {
      type: "hello";
      protocolVersion: number;
      service: "proxim-server";
    }
  | {
      type: "audio_chunk";
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
  | {
      type: "transcript_update";
      turnId: string;
      role: "assistant";
      text: string;
      emotion: Emotion;
    }
  | {
      type: "capabilities";
      sessionId: string;
      alignment: { available: boolean };
      tts: { elevenLabsConfigured: boolean; groqConfigured: boolean };
      musetalk: { available: boolean };
    }
  | { type: "session_start"; sessionId: string; personaId: string }
  | { type: "session_end"; sessionId: string }
  | { type: "session_scorecard"; sessionId: string; scoreCard: ScoreCard }
  | { type: "compliance_event"; sessionId: string; event: ComplianceEvent }
  | {
      type: "video_frame";
      frameBase64: string;
      sentenceIndex: number;
      frameIndex: number;
    }
  | {
      type: "emotion";
      turnId: string;
      tag: Emotion;
    }
  | {
      type: "latency";
      turnId: string;
      stt_ms: number;
      llm_first_token_ms: number;
      tts_start_ms: number;
      total_ms: number;
    }
  | { type: "error"; message: string };
