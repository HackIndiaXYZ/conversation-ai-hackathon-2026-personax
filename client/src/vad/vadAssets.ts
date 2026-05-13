/** Resolved asset URLs for MicVAD (Vite bundles these from node_modules). */
import vadWorkletURL from "@ricky0123/vad-web/dist/vad.worklet.bundle.min.js?url";
import vadModelURL from "@ricky0123/vad-web/dist/silero_vad.onnx?url";

export const VAD_WORKLET_URL = vadWorkletURL;
export const VAD_MODEL_URL = vadModelURL;
