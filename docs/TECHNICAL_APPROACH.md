# Proxim Technical Approach

## Objective

Proxim is a browser-based conversational avatar system for pharmaceutical sales training. The product simulates short live calls with healthcare professionals (HCPs), accepts spoken rep input, generates persona-grounded responses in real time, animates a 3D avatar while speaking, and closes each session with a coaching scorecard. The goal of the implementation is not just to produce an answer, but to make the interaction feel like a realistic objection-handling rehearsal inside a React application.

## System Design

The solution is split into two deployable services:

- `client/`: a React 18 + Vite single-page application that handles microphone capture, 3D rendering, transcript display, playback, and operator controls.
- `server/`: a Node.js + Express + WebSocket service that manages session orchestration, persona loading, LLM calls, TTS generation, viseme production, scorecard generation, and avatar asset proxying.

This separation keeps the browser focused on low-latency interaction and rendering, while the server owns model orchestration and API key usage. It also maps well to the stated Proxa Echo integration model, where a React host app launches sessions and a backend coordinates model calls.

## Conversational Runtime

Each session begins with a persona selection and an optional patient-context prompt. On the server, every persona defines identity, specialty, demeanor, compliance posture, voice settings, and a system prompt. That prompt acts as the HCP persona contract for the session.

During a live call:

1. The browser captures rep speech.
2. Speech is transcribed locally when supported, with a server-side fallback path available for more controlled environments.
3. The transcript is sent to the backend over WebSocket.
4. The backend appends the new utterance to session history and streams an LLM response from the configured provider: Groq, Anthropic Claude, or OpenAI GPT-4 family models.
5. Partial assistant text is emitted to the client as transcript updates.
6. Completed sentence fragments are synthesized to audio immediately instead of waiting for the full answer.
7. Audio, viseme timing, and emotion tags are streamed back to the browser.
8. The avatar speaks, animates, and displays the ongoing transcript in real time.

The key design choice here is sentence-buffered streaming. It reduces perceived latency because audio generation can begin while the LLM is still producing the remainder of the response. The demo also captures first-token, first-audio, and first-visible-lip-sync timing so latency claims can be measured during evaluation.

## Voice and Lip Sync Strategy

The system supports a layered voice pipeline:

- Primary TTS path: ElevenLabs aligned speech, which supplies timing data that can be converted into higher-quality visemes.
- Fallback TTS path: Groq TTS, paired with synthesized visemes aligned to the produced WAV timing and energy.
- Final fallback: silent timing buffers that still let the avatar animate instead of freezing.

This fallback ladder was a deliberate resilience decision. In hackathon conditions and real demos, third-party voice providers can fail for quota, latency, or network reasons. The system therefore prioritizes graceful degradation over brittle “all-or-nothing” behavior.

For speech-to-text, the app can use browser-native speech recognition for immediacy, while preserving a server Whisper route for environments where browser STT is unreliable or unavailable.

## Avatar Layer

The avatar experience is powered by React Three Fiber and Three.js. Personas are mapped to GLB assets, and the runtime attempts to identify the most face-like morph target host in each model so mouth, jaw, blink, and expression controls can be driven consistently. The avatar system also applies idle motion, gaze shifts, subtle head motion, and emotion-specific pose offsets so the interaction feels less mechanical.

At least five persona configurations are already included, satisfying the requirement for multiple HCP appearances. The implementation also includes upload and proxy utilities so evaluators are not blocked by external asset fetch issues.

## Coaching and Evaluation

The conversation does not end at audio playback. When a session closes, the server submits the dialogue history for scorecard generation. The resulting evaluation focuses on criteria that matter in pharma roleplay:

- clinical accuracy
- objection handling
- safety messaging
- dosing accuracy
- compliance language

This creates a practical training loop instead of a novelty avatar demo.

## Deployment and Containerization

The project is structured to run locally for development and also as a containerized stack. The repository now includes:

- a client container image
- a server container image
- a compose file for multi-service startup

That aligns with the AWS/container-first deployment expectations in the brief. In a production rollout, the same split could be moved behind managed load balancing, object storage for assets, and secrets management for model credentials.

## Key Design Decisions

### 1. Browser-native front end

Using a React/Vite front end keeps the solution aligned with the target embedding environment and lowers integration friction for Proxa Echo.

### 2. Streaming before full completion

Streaming transcript and audio sentence-by-sentence improves responsiveness and makes the avatar feel conversational instead of turn-based.

### 3. Persona configuration as data

Keeping persona identity and behavior in JSON allows the team to add or tune HCPs without rewriting application logic.

### 4. Fallback-oriented media pipeline

Multiple STT and TTS fallbacks were chosen to keep demos and evaluations running even when one provider is unavailable.

### 5. Diagnostics included in the product

Latency and lip-sync diagnostics are exposed in the UI to speed up debugging, benchmarking, and evaluator confidence during live review.

## Known Limitations

- Session memory is in-process only; there is no persistence layer yet for transcript history or analytics.
- Audio transport currently uses base64 in WebSocket payloads, which is simple and portable but not the most bandwidth-efficient format.
- Some quality features depend on optional third-party services such as ElevenLabs and Anthropic.
- The upload path for custom avatars is intended for demos and local evaluation rather than hardened multi-tenant production use.
- MuseTalk integration is present but not enabled by default, so the current submission focuses on real-time 3D avatar animation rather than generated video frames.

## Next Steps

If extended beyond the hackathon, the highest-value next steps would be persistent session analytics, admin persona authoring tools, more structured compliance evaluation, and a production media pipeline using binary streaming and managed asset storage.
