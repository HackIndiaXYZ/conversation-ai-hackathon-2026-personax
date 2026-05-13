import Anthropic from "@anthropic-ai/sdk";
import Groq from "groq-sdk";
import type { Emotion, Message, Persona } from "../types/index.js";

/**
 * LLM provider selection:
 *  - If GROQ_API_KEY is set → use Groq (free tier, Llama 3.3 70B, very fast)
 *  - Else if ANTHROPIC_API_KEY is set → use Anthropic Claude Sonnet
 *  - Otherwise → yield the "no key" fallback message
 *
 * Set GROQ_API_KEY in server/.env to use Groq for free:
 *   https://console.groq.com/keys
 */

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1";

type LlmProvider = "groq" | "anthropic" | "openai";

function configuredProviderOrder(): LlmProvider[] {
  const requested = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (requested === "groq" || requested === "anthropic" || requested === "openai") {
    return [requested];
  }
  // Keep existing behavior by default. OpenAI is reached only after Groq/Claude.
  return ["groq", "anthropic", "openai"];
}

function buildSystemPrompt(persona: Persona, patientRequest?: string): string {
  const complianceClause = persona.complianceMode
    ? `\n\nCOMPLIANCE GUARDRAIL: If the sales representative makes any off-label claim, cites unapproved data, or promotes a product outside its approved indication, respond with appropriate physician skepticism (e.g., "I'm not aware of that being an approved use — can you share the label details?"). Note the compliance concern naturally in your response.`
    : "";

  const baseline = persona.moodBaseline ?? persona.mood;
  const genderClause = persona.gender
    ? `\nIn this simulation you are a ${persona.gender === "male" ? "male" : "female"} physician (match tone and lived experience accordingly).`
    : "";
  const patientContext = patientRequest?.trim()
    ? `\n\nPATIENT SITUATION TO REACT TO:\n${patientRequest.trim()}\n\nUse this patient situation as active context. Let it influence your emotional tag and body-language tone:\n- Use [CONCERNED] when the patient issue involves safety, anxiety, adherence barriers, caregiver worry, frailty, cost distress, or unresolved risk.\n- Use [SKEPTICAL] when the representative's answer glosses over the patient concern, overclaims, or lacks evidence.\n- Use [ENGAGED] when you are exploring the patient's needs or asking practical follow-up questions.\n- Use [POSITIVE] only when the representative gives a credible, patient-centered answer.\nRespond like a real physician thinking about this specific patient, not like an AI assistant summarizing. Speak in first person, use natural clinical phrasing, and include brief empathy where appropriate.`
    : "";
  return `You are ${persona.name}, a ${persona.specialty} at ${persona.hospital}.
Personality: ${persona.personality}
Current mood: ${persona.mood} (baseline affect: ${baseline})${genderClause}

You are in a meeting with a pharmaceutical sales representative. Respond naturally as this HCP would — be realistic, sometimes skeptical, sometimes curious. Keep responses to 2–4 sentences unless asked something complex.

IMPORTANT: Before every response, output exactly one tag on its own line (uppercase), then your spoken reply immediately after with no blank line:
[NEUTRAL] or [ENGAGED] or [SKEPTICAL] or [CONCERNED] or [POSITIVE]
Do not explain the tag. Choose the emotion an HCP would naturally feel at this moment.

For compatibility you may instead use the legacy form on its own line:
[EMOTION:neutral] through [EMOTION:positive] plus [EMOTION:concerned]
The system strips tags before text-to-speech.

STYLE: Do not sound like a generic AI assistant. Avoid phrases like "as an AI", "here is a summary", "it is important to note", or bullet-point lecture style. Answer as a busy clinician in a live conversation, with human hesitation, warmth, doubt, or pressure when the situation calls for it.${patientContext}${complianceClause}`;
}

/** Preferred: [NEUTRAL]\\nAnswer… */
const BRACKET_EMOTION_RE = /^\[(NEUTRAL|ENGAGED|SKEPTICAL|CONCERNED|POSITIVE)\]\s*\n?/i;
/** Legacy: [EMOTION:neutral]\\n… */
const LEGACY_EMOTION_RE = /^\[EMOTION:(neutral|engaged|skeptical|concerned|positive)\]\s*\n?/i;

export function stripEmotionTag(raw: string): { emotion: Emotion; displayText: string } {
  const bracket = raw.match(BRACKET_EMOTION_RE);
  if (bracket) {
    const emotion = bracket[1].toLowerCase() as Emotion;
    return { emotion, displayText: raw.replace(BRACKET_EMOTION_RE, "").trim() };
  }
  const legacy = raw.match(LEGACY_EMOTION_RE);
  if (legacy) {
    const emotion = legacy[1].toLowerCase() as Emotion;
    return { emotion, displayText: raw.replace(LEGACY_EMOTION_RE, "").trim() };
  }
  return { emotion: "neutral", displayText: raw.trim() };
}

// ── Groq streaming ────────────────────────────────────────────────────────────

async function* streamGroqResponse(
  apiKey: string,
  persona: Persona,
  history: Message[],
  patientRequest?: string
): AsyncGenerator<{ textDelta: string }> {
  const client = new Groq({ apiKey });
  const system = `${buildSystemPrompt(persona, patientRequest)}\n\nAdditional persona notes:\n${persona.systemPrompt}`;

  const messages = [
    { role: "system" as const, content: system },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const stream = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages,
    max_tokens: 1024,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield { textDelta: delta };
  }
}

// ── Anthropic streaming ───────────────────────────────────────────────────────

async function* streamAnthropicResponse(
  apiKey: string,
  persona: Persona,
  history: Message[],
  patientRequest?: string
): AsyncGenerator<{ textDelta: string }> {
  const client = new Anthropic({ apiKey });
  const system = `${buildSystemPrompt(persona, patientRequest)}\n\nAdditional persona notes:\n${persona.systemPrompt}`;

  const anthropicMessages = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const stream = await client.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system,
    messages: anthropicMessages,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { textDelta: event.delta.text };
    }
  }
}

type OpenAIChatChunk = {
  choices?: Array<{ delta?: { content?: string } }>;
};

async function* streamOpenAIResponse(
  apiKey: string,
  persona: Persona,
  history: Message[],
  patientRequest?: string
): AsyncGenerator<{ textDelta: string }> {
  const system = `${buildSystemPrompt(persona, patientRequest)}\n\nAdditional persona notes:\n${persona.systemPrompt}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: "system", content: system },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ],
      max_tokens: 1024,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI chat failed: ${res.status} ${err}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice("data:".length).trim();
      if (!data || data === "[DONE]") continue;
      const parsed = JSON.parse(data) as OpenAIChatChunk;
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) yield { textDelta: delta };
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function* streamClaudeResponse(
  apiKey: string | undefined,
  persona: Persona,
  history: Message[],
  patientRequest?: string
): AsyncGenerator<{ textDelta: string }> {
  const groqKey = process.env.GROQ_API_KEY;
  const anthropicKey = apiKey;
  const openaiKey = process.env.OPENAI_API_KEY;

  for (const provider of configuredProviderOrder()) {
    if (provider === "groq" && groqKey) {
      console.log("[LLM] Using Groq (llama-3.3-70b-versatile)");
      yield* streamGroqResponse(groqKey, persona, history, patientRequest);
      return;
    }

    if (provider === "anthropic" && anthropicKey) {
      console.log("[LLM] Using Anthropic Claude Sonnet");
      yield* streamAnthropicResponse(anthropicKey, persona, history, patientRequest);
      return;
    }

    if (provider === "openai" && openaiKey) {
      console.log(`[LLM] Using OpenAI (${OPENAI_CHAT_MODEL})`);
      yield* streamOpenAIResponse(openaiKey, persona, history, patientRequest);
      return;
    }
  }

  // No key configured
  yield {
    textDelta:
      "[NEUTRAL]\nI'm having trouble reaching my reasoning service right now. Please set GROQ_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY in server/.env",
  };
}

// ── Scorecard evaluation ──────────────────────────────────────────────────────

import type { ScoreCard } from "../types/index.js";

const SCORECARD_PROMPT = `You are an expert pharmaceutical sales trainer evaluating a practice call transcript.
Analyze the SALES REP turns only and return a JSON object (no markdown, no extra text) with this exact shape:
{
  "score": <integer 0-100>,
  "readiness": <one of: "Field Ready" | "Almost Ready" | "Needs Practice" | "Not Ready">,
  "items": [
    { "label": "<criterion>", "status": <"pass" | "warn" | "fail"> }
  ],
  "summary": "<one coaching sentence>"
}

Always include exactly these 5 criteria in items (evaluate each from the rep's dialogue):
1. Clinical data cited
2. Objections handled
3. Side effect profile addressed
4. Dosing / administration covered
5. Compliant messaging (no off-label claims)

Score reflects overall call quality. Readiness: 80-100=Field Ready, 60-79=Almost Ready, 40-59=Needs Practice, <40=Not Ready.`;

/**
 * Evaluates a completed conversation and returns a structured score card.
 * Uses Groq (free) as primary, falls back to Anthropic.
 * Returns null if no LLM key is configured — caller must handle gracefully.
 */
export async function generateScoreCard(
  messages: import("../types/index.js").Message[]
): Promise<ScoreCard | null> {
  const groqKey = process.env.GROQ_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // Build a readable transcript of only the conversation (no system)
  const transcript = messages
    .map((m) => `${m.role === "user" ? "REP" : "HCP"}: ${m.content}`)
    .join("\n");

  if (!transcript.trim() || messages.filter((m) => m.role === "user").length === 0) {
    return null; // Not enough conversation to score
  }

  const userContent = `Here is the call transcript:\n\n${transcript}\n\nReturn only the JSON object.`;

  try {
    let rawJson = "";

    for (const provider of configuredProviderOrder()) {
      if (provider === "groq" && groqKey) {
        const client = new Groq({ apiKey: groqKey });
        const res = await client.chat.completions.create({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: SCORECARD_PROMPT },
            { role: "user", content: userContent },
          ],
          max_tokens: 512,
          stream: false,
        });
        rawJson = res.choices[0]?.message?.content ?? "";
        break;
      }

      if (provider === "anthropic" && anthropicKey) {
        const client = new Anthropic({ apiKey: anthropicKey });
        const res = await client.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 512,
          system: SCORECARD_PROMPT,
          messages: [{ role: "user", content: userContent }],
        });
        const block = res.content[0];
        rawJson = block.type === "text" ? block.text : "";
        break;
      }

      if (provider === "openai" && openaiKey) {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: OPENAI_CHAT_MODEL,
            messages: [
              { role: "system", content: SCORECARD_PROMPT },
              { role: "user", content: userContent },
            ],
            max_tokens: 512,
            stream: false,
          }),
        });
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          throw new Error(`OpenAI scorecard failed: ${res.status} ${err}`);
        }
        const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        rawJson = json.choices?.[0]?.message?.content ?? "";
        break;
      }
    }

    if (!rawJson) return null; // No LLM configured

    // Strip possible markdown fences
    const cleaned = rawJson.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as ScoreCard;

    // Basic validation
    if (
      typeof parsed.score !== "number" ||
      !parsed.readiness ||
      !Array.isArray(parsed.items) ||
      !parsed.summary
    ) {
      console.warn("[ScoreCard] LLM returned unexpected shape:", cleaned);
      return null;
    }

    return parsed;
  } catch (err) {
    console.warn("[ScoreCard] Evaluation failed (non-fatal):", err instanceof Error ? err.message : err);
    return null;
  }
}
