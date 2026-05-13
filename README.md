# Proxim

Proxim is a browser-based conversational avatar trainer for pharmaceutical sales teams. A rep speaks to a simulated healthcare professional, the system transcribes the question, generates a persona-grounded response, streams audio back in real time, animates a 3D avatar while speaking, and then produces a post-call coaching scorecard.

The project is built to match the Proxa Echo integration model: React front end, live multi-turn sessions, configurable HCP personas, and container-friendly deployment.

## Submission Checklist

- Public GitHub repository with full source code: this repository
- Open-source license: [MIT](LICENSE)
- README with setup, dependencies, and architecture overview: this file
- Working demo video: add your recording link before submission
- Brief written technical document: [docs/TECHNICAL_APPROACH.md](docs/TECHNICAL_APPROACH.md)
- AWS/Docker deployment guide: [docs/AWS_DOCKER_DEPLOYMENT.md](docs/AWS_DOCKER_DEPLOYMENT.md)
- Third-party API/model documentation with licensing notes: [docs/THIRD_PARTY_APIS_AND_LICENSES.md](docs/THIRD_PARTY_APIS_AND_LICENSES.md)

## What the project demonstrates

- Real-time voice-in, avatar-response conversational flow
- Continuous multi-turn dialogue over WebSocket
- Five distinct HCP personas with different specialties, moods, and compliance styles
- Browser-rendered 3D avatar animation with lip sync and emotional motion cues
- Session-end scorecard for coaching and objection-handling review
- Reliable post-call debrief delivery with a scorecard wait state
- Real-time compliance flagging for risky rep phrasing
- Interruptible voice-to-voice turns for natural barge-in
- Containerizable client/server deployment

## Architecture Overview

```text
Browser (React + Vite)
  - microphone capture
  - transcript UI
  - persona selection
  - 3D avatar rendering
  - audio playback and diagnostics
            |
            | HTTP + WebSocket
            v
Server (Node.js + Express + ws)
  - session orchestration
  - persona loading
  - LLM response streaming
  - TTS generation
  - viseme generation
  - scorecard evaluation
  - avatar asset proxy/upload
```

### Front end

- React 18 + TypeScript + Vite
- React Three Fiber / Three.js avatar rendering
- Zustand state management
- Voice input, transcript, playback, diagnostics, and scorecard UI

### Back end

- Node.js + Express + TypeScript
- WebSocket session transport
- Persona-driven prompt orchestration
- Groq, Anthropic, OpenAI, and ElevenLabs integration points

## Repository Structure

```text
client/   React application and avatar UI
server/   Express/WebSocket orchestration service
docs/     Submission-ready technical and licensing notes
```

## Personas Included

The current build ships with five physician personas:

- Dr. Sarah Chen, Oncology
- Dr. Raj Patel, Cardiology
- Dr. Linda Williams, General Practice
- Dr. Ji-Yeon Kim, Rheumatology
- Dr. Miguel Rodriguez, Hospital Medicine

Persona definitions live in:

- `client/src/config/personas.json`
- `server/src/config/personas.json`

## Local Setup

### Prerequisites

- Node.js 20 or newer
- npm
- At least one LLM/TTS/STT provider key

### Required and optional API keys

Minimum recommended setup:

- `GROQ_API_KEY`

Optional quality/fallback providers:

- `ELEVENLABS_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `LLM_PROVIDER` (`auto`, `groq`, `anthropic`, or `openai`)
- `OPENAI_CHAT_MODEL` (defaults to `gpt-4.1`)

### 1. Install dependencies

```bash
npm install --prefix server
npm install --prefix client
```

### 2. Configure environment files

```bash
copy server\.env.example server\.env
copy client\.env.example client\.env
```

Then fill in your API keys in `server/.env`.

### 3. Start the server

```bash
npm run dev --prefix server
```

The API and WebSocket server run on `http://localhost:3001`.

### 4. Start the client

```bash
npm run dev --prefix client
```

The web app runs on `http://localhost:5173`.

## Docker Deployment

The repo includes a client container and a server container.

### Start both services

```bash
copy server\.env.example server\.env
docker compose up --build
```

Endpoints:

- Client: `http://localhost:8080`
- Server health: `http://localhost:3001/health`

For AWS EC2 deployment, scalability notes, and reviewer checks, see [docs/AWS_DOCKER_DEPLOYMENT.md](docs/AWS_DOCKER_DEPLOYMENT.md).

## Key Runtime Behavior

### Voice input

- Browser speech recognition is used when available.
- A server-side transcription route is available as a fallback.

### Response generation

- Persona prompts shape the HCP identity, specialty, tone, and objection style.
- Responses stream back progressively rather than waiting for a full completion.

### Speech output and lip sync

- ElevenLabs is the preferred TTS path when configured.
- Groq TTS is used as a fallback.
- Visemes are generated from alignment data or synthesized from speech/text fallbacks.

### Scorecard

When the session ends, the conversation is evaluated across categories such as:

- clinical accuracy
- objection handling
- safety messaging
- dosing accuracy
- compliance language

The client now keeps the session transport alive briefly after `End Call` so the debrief can arrive reliably. If scoring fails or times out, the UI still falls back safely to the non-scorecard end state.

### Live compliance monitor

During a live session, rep messages are scanned immediately for rule-based concerns such as:

- off-label language
- unsupported superiority claims
- benefit claims without safety qualifiers
- absolute efficacy claims
- "guaranteed" or "risk-free" phrasing

Flags stream into a sidebar compliance monitor without blocking the physician response loop.

### Interruptible voice sessions

Assistant turns now carry turn IDs and can be interrupted mid-playback. When the user speaks over the avatar, the client can stop queued audio, clear the current turn, notify the server, and continue with the new utterance while preserving the safer mic-mute fallback mode in code.

## React Integration API

The client also exposes an internal React-facing session API under `client/src/sdk/` so the WebSocket protocol is not tied directly to the demo UI.

Current surface:

- `startSession(config)`
- `sendText(text, config)`
- `sendAudio(blob, config)`
- `interrupt()`
- `endSession(sessionId)`
- `onTranscript(handler)`
- `onAudioChunk(handler)`
- `onComplianceEvent(handler)`
- `onScorecard(handler)`

The reference app uses this SDK internally today, and another React app can adopt the same surface by composing `useProximAvatarSession()` and rendering its own UI around those callbacks.

## Environment Reference

### Server

See [server/.env.example](server/.env.example) for the full list. Main variables:

- `PORT`
- `GROQ_API_KEY`
- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_DEFAULT_VOICE_ID`
- `OPENAI_API_KEY`
- `LLM_PROVIDER`
- `OPENAI_CHAT_MODEL`
- `GROQ_STT_MODEL`
- `PERSONAS_PATH`

### Client

See [client/.env.example](client/.env.example). Main variables:

- `VITE_WS_URL`
- `VITE_API_URL`
- `VITE_HTTP_SERVER_URL`
- `VITE_RPM_USE_PROXY`
- `VITE_RPM_USE_VITE_DEV_PROXY`
- `VITE_FORCE_SERVER_STT`
- `VITE_VOICE_USE_VAD`
- `VITE_DEFAULT_AVATAR_GLB`

## Demo Guidance

Use [DEMO_SCRIPT.md](DEMO_SCRIPT.md) as the outline for the 3-5 minute submission video. Before submitting, add your hosted demo video link to this README or the repository description.

## Known Limitations

- Session history is stored in memory only.
- Audio is transported in base64 WebSocket payloads, which favors simplicity over efficiency.
- Optional providers change output quality depending on which keys are configured.
- Custom avatar upload is intended for local/demo use rather than hardened production multi-tenancy.
- MuseTalk support exists in the codebase but is disabled by default.

## License

This repository is released under the [MIT License](LICENSE).
