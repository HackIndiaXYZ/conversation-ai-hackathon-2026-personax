import { create } from "zustand";
import type { VisemeKeyframe, VisemeKey, VisemeSource } from "../types";

export interface AvatarPlaybackState {
  /** performance.now() when current viseme timeline started */
  chunkStartedAt: number | null;
  visemes: VisemeKeyframe[];
  lastChunk: {
    sentenceIndex: number | null;
    isSilence: boolean | null;
    visemeSource: VisemeSource | null;
    receivedAt: number | null;
  };
  /** How many morph targets on the selected mesh look like Oculus visemes (best-effort). */
  visemeMorphCount: number | null;
  morphHost: {
    meshName: string | null;
    morphKeySample: string[];
    totalMorphTargets: number | null;
  };
  avatarAsset: {
    resolvedUrl: string | null;
    loadError: string | null;
    loadedAt: number | null;
    renderMode: "unknown" | "loading" | "gltf" | "fallback";
    contextLossCount: number;
  };
}

interface AvatarStore extends AvatarPlaybackState {
  setVisemeTrack: (
    visemes: VisemeKeyframe[],
    chunkStartedAt: number,
    meta?: Partial<AvatarPlaybackState["lastChunk"]>
  ) => void;
  /**
   * Update only the playback start time. Used to align viseme timeline
   * to actual audio playback once it begins (without replacing frames).
   */
  setChunkStartedAt: (
    chunkStartedAt: number,
    meta?: Partial<AvatarPlaybackState["lastChunk"]>
  ) => void;
  /** Update chunk metadata without starting playback timing (used for diagnostics). */
  setLastChunkMeta: (meta: Partial<AvatarPlaybackState["lastChunk"]>) => void;
  setMorphInventory: (visemeMorphCount: number | null) => void;
  setMorphHostInfo: (info: Partial<AvatarPlaybackState["morphHost"]>) => void;
  setAvatarAssetInfo: (info: Partial<AvatarPlaybackState["avatarAsset"]>) => void;
  clearVisemeTrack: () => void;
}

export const useAvatarStore = create<AvatarStore>((set) => ({
  chunkStartedAt: null,
  visemes: [],
  lastChunk: { sentenceIndex: null, isSilence: null, visemeSource: null, receivedAt: null },
  visemeMorphCount: null,
  morphHost: { meshName: null, morphKeySample: [], totalMorphTargets: null },
  avatarAsset: { resolvedUrl: null, loadError: null, loadedAt: null, renderMode: "unknown", contextLossCount: 0 },

  setVisemeTrack: (visemes, chunkStartedAt, meta) =>
    set((s) => ({
      visemes,
      chunkStartedAt,
      lastChunk: { ...s.lastChunk, ...(meta ?? {}) },
    })),
  setChunkStartedAt: (chunkStartedAt, meta) =>
    set((s) => ({
      chunkStartedAt,
      lastChunk: { ...s.lastChunk, ...(meta ?? {}) },
    })),
  setLastChunkMeta: (meta) => set((s) => ({ lastChunk: { ...s.lastChunk, ...meta } })),
  setMorphInventory: (visemeMorphCount) => set({ visemeMorphCount }),
  setMorphHostInfo: (info) => set((s) => ({ morphHost: { ...s.morphHost, ...info } })),
  setAvatarAssetInfo: (info) => set((s) => ({ avatarAsset: { ...s.avatarAsset, ...info } })),
  clearVisemeTrack: () =>
    set((s) => ({
      visemes: [],
      chunkStartedAt: null,
      lastChunk: s.lastChunk,
      // Keep model diagnostics intact across turns so the session can still report
      // whether the loaded avatar supports visemes/emotions after playback completes.
      visemeMorphCount: s.visemeMorphCount,
      morphHost: s.morphHost,
      avatarAsset: s.avatarAsset,
    })),
}));

/** RPM / Oculus viseme morph target naming convention */
export function visemeToMorphName(v: VisemeKey): string {
  // Some avatars (including several open demo rigs) use the standard Oculus
  // single-letter vowel visemes: I/O/U instead of ih/oh/ou.
  const alias: Partial<Record<VisemeKey, string>> = {
    ih: "I",
    oh: "O",
    ou: "U",
  };
  return `viseme_${alias[v] ?? v}`;
}
