/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** When "true", skip Web Speech and use mic + server Whisper with silence detection (VPN-safe). */
  readonly VITE_FORCE_SERVER_STT?: string;
  /** Optional: enable experimental @ricky0123/vad-web fast-end-of-phrase path (default: MediaRecorder fallback). */
  readonly VITE_VOICE_USE_VAD?: string;
  /** Base URL for REST + RPM proxy (default http://localhost:3001). Must match server PORT. */
  readonly VITE_HTTP_SERVER_URL?: string;
  /** When "false", load Ready Player Me GLBs from models.readyplayer.me in the browser (skip /assets/rpm proxy). */
  readonly VITE_RPM_USE_PROXY?: string;
  /** When "false" in dev, use the API server RPM proxy (:3001) instead of Vite `/__rpm` (default: use Vite in dev). */
  readonly VITE_RPM_USE_VITE_DEV_PROXY?: string;
  /** Injected in vite.config from installed `onnxruntime-web` package version (WASM CDN path). */
  readonly VITE_ORT_WASM_VERSION?: string;
}
