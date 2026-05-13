# Third-Party APIs, Models, and Licensing Notes

This document summarizes the external services, models, and major libraries used by Proxim. It is intended as a submission companion, not a substitute for each provider's full terms of service.

## Model and API Providers

| Provider | Usage in Proxim | Licensing / commercial note |
|---|---|---|
| Groq | LLM inference, TTS fallback, Whisper STT fallback | Commercial API service. Usage requires a Groq account and is governed by Groq platform terms and model availability terms. Teams should verify commercial rights and rate limits for their chosen plan. |
| Anthropic | Claude-based response fallback and scorecard evaluation | Commercial API service. Usage requires an Anthropic account and is governed by Anthropic API/service terms. |
| ElevenLabs | Primary aligned text-to-speech with phoneme timing | Commercial API service. Usage requires an ElevenLabs account and is governed by ElevenLabs licensing and voice usage terms. |
| OpenAI | Optional GPT-4 family dialogue provider and Whisper fallback path when configured | Commercial API service. Usage requires an OpenAI account and is governed by OpenAI API terms. |
| Ready Player Me | Avatar hosting / source GLB compatibility path | Third-party avatar platform. Users should verify avatar asset usage rights and platform terms for any production deployment. |

## Open-Source Libraries

| Package / technology | Role | License |
|---|---|---|
| React | Client UI | MIT |
| React DOM | Client rendering | MIT |
| Vite | Front-end build tooling | MIT |
| TypeScript | Type safety and build tooling | Apache-2.0 |
| Tailwind CSS | Styling utilities | MIT |
| Three.js | 3D runtime | MIT |
| React Three Fiber | React renderer for Three.js | MIT |
| @react-three/drei | 3D helpers | MIT |
| Zustand | Client state management | MIT |
| Express | HTTP server | MIT |
| ws | WebSocket server | MIT |
| Multer | Multipart upload handling | MIT |
| dotenv | Environment variable loading | BSD-2-Clause |
| cors | CORS middleware | MIT |
| onnxruntime-web | Browser inference runtime used by VAD path | MIT |
| @ricky0123/vad-web | Browser voice activity detection | MIT |
| nginx | Static web serving in the client container | BSD-2-Clause style open-source license |

## Notes for Evaluators

- The repository itself is released under the MIT License.
- Commercial deployment of the complete system depends on separately obtained credentials for any paid APIs that are enabled.
- The application is designed so that optional providers can be omitted and the stack still functions with a reduced feature set.
- Teams should review each third-party provider's current terms directly before production launch, especially around voice synthesis, model output usage, and quota-based billing.
