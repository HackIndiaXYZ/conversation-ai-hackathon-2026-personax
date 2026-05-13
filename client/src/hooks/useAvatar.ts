import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Emotion, VisemeKeyframe, VisemeKey } from "../types";
import { useAvatarStore, visemeToMorphName } from "../store/avatarStore";

const LERP = 0.22;
const TRANSITION_WINDOW_SEC = 0.12;

const ALL_VISEMES: VisemeKey[] = [
  "sil",
  "PP",
  "FF",
  "TH",
  "DD",
  "kk",
  "CH",
  "SS",
  "nn",
  "RR",
  "aa",
  "E",
  "ih",
  "oh",
  "ou",
];

type MorphIndexMap = Record<string, number>;
type FallbackRecipeStep = { names: string[]; weight: number };
type FallbackRecipe = FallbackRecipeStep[];
type ExpressionStep = { names: string[]; weight: number };

const EMOTION_MORPH_RECIPES: Record<Emotion, ExpressionStep[]> = {
  neutral: [],
  engaged: [
    { names: ["browinnerupleft", "browinnerupright", "browinnerup_l", "browinnerup_r"], weight: 0.42 },
    { names: ["cheeksquintleft", "cheeksquintright", "cheeksquint_l", "cheeksquint_r"], weight: 0.14 },
    { names: ["mouthsmileleft", "mouthsmileright", "mouthsmile_l", "mouthsmile_r"], weight: 0.18 },
    { names: ["jawforward"], weight: 0.08 },
  ],
  skeptical: [
    { names: ["browdownleft", "browdown_l"], weight: 0.54 },
    { names: ["browinnerupright", "browinnerup_r"], weight: 0.2 },
    { names: ["eyesquintleft", "eyesquint_l"], weight: 0.18 },
    { names: ["mouthpressleft", "mouthpressright"], weight: 0.34 },
    { names: ["mouthfrownleft", "mouthfrown_l"], weight: 0.16 },
    { names: ["mouthshrugupper"], weight: 0.12 },
  ],
  concerned: [
    { names: ["browinnerupleft", "browinnerupright", "browinnerup_l", "browinnerup_r"], weight: 0.46 },
    { names: ["browouterupleft", "browouterupright", "browouterup_l", "browouterup_r"], weight: 0.22 },
    { names: ["mouthfrownleft", "mouthfrownright", "mouthfrown_l", "mouthfrown_r"], weight: 0.38 },
    { names: ["mouthshrugupper", "mouthshruglower"], weight: 0.22 },
    { names: ["eyeswideleft", "eyeswideright", "eyeswide_l", "eyeswide_r"], weight: 0.12 },
  ],
  positive: [
    { names: ["mouthsmileleft", "mouthsmileright", "mouthsmile_l", "mouthsmile_r"], weight: 0.58 },
    { names: ["cheeksquintleft", "cheeksquintright", "cheeksquint_l", "cheeksquint_r"], weight: 0.24 },
    { names: ["browouterupleft", "browouterupright", "browouterup_l", "browouterup_r"], weight: 0.12 },
    { names: ["mouthdimpleleft", "mouthdimpleright"], weight: 0.18 },
  ],
};

const SPEAKING_MORPH_RECIPES: ExpressionStep[] = [
  { names: ["browinnerupleft", "browinnerupright", "browinnerup_l", "browinnerup_r"], weight: 0.1 },
  { names: ["eyesquintleft", "eyesquintright", "eyesquint_l", "eyesquint_r"], weight: 0.08 },
  { names: ["cheeksquintleft", "cheeksquintright", "cheeksquint_l", "cheeksquint_r"], weight: 0.12 },
  { names: ["noseSneerLeft", "noseSneerRight", "nosesneerleft", "nosesneerright"], weight: 0.06 },
  { names: ["mouthsmileleft", "mouthsmileright", "mouthsmile_l", "mouthsmile_r"], weight: 0.08 },
  { names: ["mouthstretchleft", "mouthstretchright"], weight: 0.12 },
];

function normalizeKey(k: string): string {
  return k.trim().toLowerCase();
}

function clamp01(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function firstIndex(dict: MorphIndexMap, candidates: string[]): number | undefined {
  for (const c of candidates) {
    const idx = dict[normalizeKey(c)];
    if (typeof idx === "number") return idx;
  }
  return undefined;
}

// Fallback mapping when a model doesn't ship Oculus viseme_* targets (common on ARKit rigs).
// We drive a handful of mouth/jaw shapes so the avatar still "speaks" in demos.
const FALLBACK_MORPHS_BY_VISEME: Partial<Record<VisemeKey, FallbackRecipe>> = {
  sil: [
    { names: ["mouthClose", "mouthPressLeft", "mouthPressRight"], weight: 0.16 },
    { names: ["jawOpen", "mouthOpen"], weight: 0 },
  ],
  PP: [
    { names: ["mouthClose", "mouthPressLeft", "mouthPressRight"], weight: 0.96 },
    { names: ["mouthShrugUpper", "mouthShrugLower"], weight: 0.28 },
  ],
  FF: [
    { names: ["mouthFunnel", "mouthPucker"], weight: 0.72 },
    { names: ["mouthRollUpper", "mouthRollLower"], weight: 0.36 },
    { names: ["mouthClose"], weight: 0.18 },
  ],
  TH: [
    { names: ["tongueOut"], weight: 0.84 },
    { names: ["mouthOpen", "jawOpen"], weight: 0.52 },
  ],
  DD: [
    { names: ["jawOpen", "mouthOpen"], weight: 0.44 },
    { names: ["mouthClose"], weight: 0.22 },
  ],
  kk: [{ names: ["jawOpen", "mouthOpen"], weight: 0.56 }],
  CH: [
    { names: ["mouthFunnel", "mouthPucker"], weight: 0.46 },
    { names: ["jawOpen", "mouthOpen"], weight: 0.42 },
    { names: ["mouthStretchLeft", "mouthStretchRight"], weight: 0.18 },
  ],
  SS: [
    { names: ["mouthSmileLeft", "mouthSmileRight"], weight: 0.34 },
    { names: ["mouthStretchLeft", "mouthStretchRight"], weight: 0.56 },
    { names: ["mouthOpen"], weight: 0.18 },
  ],
  nn: [
    { names: ["mouthClose"], weight: 0.42 },
    { names: ["jawOpen"], weight: 0.26 },
    { names: ["mouthShrugLower"], weight: 0.22 },
  ],
  RR: [
    { names: ["mouthFunnel", "mouthPucker"], weight: 0.52 },
    { names: ["jawOpen"], weight: 0.22 },
  ],
  aa: [{ names: ["jawOpen", "mouthOpen"], weight: 0.94 }],
  E: [
    { names: ["mouthSmileLeft", "mouthSmileRight"], weight: 0.46 },
    { names: ["mouthOpen"], weight: 0.34 },
  ],
  ih: [
    { names: ["mouthSmileLeft", "mouthSmileRight"], weight: 0.34 },
    { names: ["jawOpen", "mouthOpen"], weight: 0.38 },
  ],
  oh: [
    { names: ["mouthFunnel", "mouthPucker"], weight: 0.56 },
    { names: ["jawOpen"], weight: 0.36 },
  ],
  ou: [
    { names: ["mouthPucker", "mouthFunnel"], weight: 0.74 },
    { names: ["jawOpen"], weight: 0.2 },
  ],
};

function pickVisemeBlendAtTime(
  frames: VisemeKeyframe[],
  t: number
): { curKey: VisemeKey; curWeight: number; nextKey: VisemeKey; nextWeight: number; alpha: number } {
  if (!frames.length) {
    return { curKey: "sil", curWeight: 0, nextKey: "sil", nextWeight: 0, alpha: 0 };
  }

  let cur = frames[0];
  let next: VisemeKeyframe | undefined;

  for (const f of frames) {
    if (f.time <= t) cur = f;
    else {
      next = f;
      break;
    }
  }

  if (!next) {
    return { curKey: cur.viseme, curWeight: cur.weight, nextKey: cur.viseme, nextWeight: cur.weight, alpha: 0 };
  }

  const timeToNext = next.time - t;
  const alpha = THREE.MathUtils.smoothstep(TRANSITION_WINDOW_SEC - timeToNext, 0, TRANSITION_WINDOW_SEC);
  return { curKey: cur.viseme, curWeight: cur.weight, nextKey: next.viseme, nextWeight: next.weight, alpha };
}

export function useAvatarMorphs(morphDict: Record<string, number> | undefined) {
  const indices = useMemo(() => {
    if (!morphDict) return {} as Partial<Record<VisemeKey, number>>;

    // Case-insensitive lookup: some GLBs use `Viseme_PP` instead of `viseme_PP`, etc.
    const lowerToIdx: Record<string, number> = {};
    for (const [k, v] of Object.entries(morphDict)) lowerToIdx[normalizeKey(k)] = v;

    const out: Partial<Record<VisemeKey, number>> = {};
    for (const v of ALL_VISEMES) {
      const name = visemeToMorphName(v);
      const idx = morphDict[name] ?? lowerToIdx[name.toLowerCase()];
      if (typeof idx === "number") out[v] = idx;
    }
    return out;
  }, [morphDict]);

  const fallback = useMemo(() => {
    if (!morphDict) {
      return {
        hasOculusVisemes: false,
        lowerToIdx: {} as MorphIndexMap,
        idxByViseme: {} as Partial<Record<VisemeKey, Array<{ index: number; weight: number }>>>,
        usedIndices: [] as number[],
      };
    }
    const lowerToIdx: MorphIndexMap = {};
    for (const [k, v] of Object.entries(morphDict)) lowerToIdx[normalizeKey(k)] = v;

    const hasOculusVisemes = Object.keys(lowerToIdx).some((k) => k.startsWith("viseme_") || k.includes("viseme"));
    const idxByViseme: Partial<Record<VisemeKey, Array<{ index: number; weight: number }>>> = {};
    const used: number[] = [];
    for (const v of ALL_VISEMES) {
      const recipe = FALLBACK_MORPHS_BY_VISEME[v] ?? [];
      const seen = new Set<number>();
      const resolved: Array<{ index: number; weight: number }> = [];
      for (const step of recipe) {
        const idx = firstIndex(lowerToIdx, step.names);
        if (typeof idx !== "number" || seen.has(idx)) continue;
        seen.add(idx);
        resolved.push({ index: idx, weight: step.weight });
        used.push(idx);
      }
      if (resolved.length) idxByViseme[v] = resolved;
    }
    return { hasOculusVisemes, lowerToIdx, idxByViseme, usedIndices: Array.from(new Set(used)) };
  }, [morphDict]);

  const emotionIndices = useMemo(() => {
    if (!morphDict) return {} as Record<string, number>;
    const keys = ["emotion_neutral", "emotion_engaged", "emotion_skeptical", "emotion_concerned", "emotion_positive"];
    const map: Record<string, number> = {};
    for (const k of keys) {
      if (typeof morphDict[k] === "number") map[k] = morphDict[k];
    }
    return map;
  }, [morphDict]);

  /** Case-insensitive morph name → index for ARKit emotion fallbacks. */
  const emotionMorphLower = useMemo(() => {
    if (!morphDict) return {} as Record<string, number>;
    const lowerToIdx: Record<string, number> = {};
    for (const [k, v] of Object.entries(morphDict)) lowerToIdx[normalizeKey(k)] = v;
    return lowerToIdx;
  }, [morphDict]);

  const expressionIndices = useMemo(() => {
    const resolved: Record<Emotion, Array<{ index: number; weight: number }>> = {
      neutral: [],
      engaged: [],
      skeptical: [],
      concerned: [],
      positive: [],
    };
    const controlled = new Set<number>();

    (Object.keys(EMOTION_MORPH_RECIPES) as Emotion[]).forEach((emotion) => {
      for (const step of EMOTION_MORPH_RECIPES[emotion]) {
        const idx = firstIndex(emotionMorphLower, step.names);
        if (typeof idx !== "number") continue;
        resolved[emotion].push({ index: idx, weight: step.weight });
        controlled.add(idx);
      }
    });

    return { byEmotion: resolved, controlled: Array.from(controlled) };
  }, [emotionMorphLower]);

  const speakingIndices = useMemo(() => {
    const resolved: Array<{ index: number; weight: number }> = [];
    for (const step of SPEAKING_MORPH_RECIPES) {
      const idx = firstIndex(emotionMorphLower, step.names);
      if (typeof idx !== "number") continue;
      resolved.push({ index: idx, weight: step.weight });
    }
    return resolved;
  }, [emotionMorphLower]);

  const applyFrame = (
    influences: number[],
    elapsed: number,
    frames: VisemeKeyframe[],
    emotion: Emotion,
    speakingStrength = 0
  ) => {
    const { curKey, curWeight, nextKey, nextWeight, alpha } = pickVisemeBlendAtTime(frames, elapsed);

    const hasResolvedOculusVisemes = Object.values(indices).some((x) => typeof x === "number");

    if (hasResolvedOculusVisemes) {
      for (const v of ALL_VISEMES) {
        const idx = indices[v];
        if (typeof idx !== "number") continue;
        let target = 0;
        if (v === curKey) target += curWeight * (1 - alpha);
        if (v === nextKey) target += nextWeight * alpha;
        influences[idx] = THREE.MathUtils.lerp(influences[idx] ?? 0, target, LERP);
      }
    } else {
      // ARKit-ish fallback: blend a small recipe of mouth/jaw targets per viseme.
      // Zero all used fallback indices first to avoid carryover.
      for (const idx of fallback.usedIndices) {
        influences[idx] = THREE.MathUtils.lerp(influences[idx] ?? 0, 0, LERP);
      }
      const setTargets = (v: VisemeKey, w: number) => {
        const targets = fallback.idxByViseme[v];
        if (!targets?.length) return;
        for (const target of targets) {
          const next = clamp01(w * target.weight);
          influences[target.index] = THREE.MathUtils.lerp(influences[target.index] ?? 0, next, LERP);
        }
      };
      setTargets(curKey, curWeight * (1 - alpha));
      setTargets(nextKey, nextWeight * alpha);
    }

    const emNameByEmotion: Record<Emotion, string> = {
      neutral: "emotion_neutral",
      engaged: "emotion_engaged",
      skeptical: "emotion_skeptical",
      concerned: "emotion_concerned",
      positive: "emotion_positive",
    };
    const activeName = emNameByEmotion[emotion];
    for (const [n, i] of Object.entries(emotionIndices)) {
      const target = n === activeName ? 0.75 : 0;
      influences[i] = THREE.MathUtils.lerp(influences[i] ?? 0, target, LERP);
    }

    const expressionBase =
      emotion === "neutral" ? Math.max(0.04, speakingStrength * 0.14) : 0.18 + speakingStrength * 0.72;
    const active = new Map<number, number>();
    for (const step of expressionIndices.byEmotion[emotion]) {
      active.set(step.index, step.weight * expressionBase);
    }
    for (const idx of expressionIndices.controlled) {
      const target = active.get(idx) ?? 0;
      influences[idx] = THREE.MathUtils.lerp(influences[idx] ?? 0, target, LERP * 0.82);
    }

    const speechTargetBase = speakingStrength * 0.34;
    for (const step of speakingIndices) {
      const dynamicTarget =
        speechTargetBase * step.weight * (curKey === "PP" || curKey === "FF" ? 0.65 : curKey === "aa" || curKey === "oh" ? 1.18 : 1);
      influences[step.index] = THREE.MathUtils.lerp(
        influences[step.index] ?? 0,
        Math.max(influences[step.index] ?? 0, dynamicTarget),
        LERP * 0.74
      );
    }
  };

  return { applyFrame, indices, emotionIndices };
}

export function useAvatarIdleClock() {
  const blinkRef = useRef({
    nextAt: 0,
    state: "idle" as "idle" | "closing" | "opening",
    phaseStartedAt: 0,
    blinkStrength: 1,
    pendingDoubleBlink: false,
  });

  const tickIdle = (
    influences: number[] | undefined,
    blinkIndices: number[],
    dt: number,
    blinkBias = 0
  ) => {
    if (!blinkIndices.length || !influences) return 0;
    const now = performance.now() / 1000;
    const closeDur = 0.055 + dt * 0.15;
    const openDur = 0.09 + dt * 0.2;
    const state = blinkRef.current;

    if (state.nextAt === 0) {
      state.nextAt = now + 2.4 + Math.random() * 1.8;
    }

    if (state.state === "idle" && now + blinkBias >= state.nextAt) {
      state.state = "closing";
      state.phaseStartedAt = now;
      state.blinkStrength = THREE.MathUtils.clamp(0.84 + Math.random() * 0.26 + blinkBias * 0.35, 0.8, 1);
      state.pendingDoubleBlink = Math.random() < 0.18;
    } else if (state.state === "closing" && now - state.phaseStartedAt >= closeDur) {
      state.state = "opening";
      state.phaseStartedAt = now;
    } else if (state.state === "opening" && now - state.phaseStartedAt >= openDur) {
      if (state.pendingDoubleBlink) {
        state.pendingDoubleBlink = false;
        state.state = "closing";
        state.phaseStartedAt = now + 0.05;
        state.nextAt = now + 0.05;
      } else {
        state.state = "idle";
        state.phaseStartedAt = now;
        state.nextAt = now + 2.6 + Math.random() * 2.2;
      }
    }

    let blink = 0;
    if (state.state === "closing") {
      const progress = THREE.MathUtils.clamp((now - state.phaseStartedAt) / closeDur, 0, 1);
      blink = THREE.MathUtils.smoothstep(progress, 0, 1) * state.blinkStrength;
    } else if (state.state === "opening") {
      const progress = THREE.MathUtils.clamp((now - state.phaseStartedAt) / openDur, 0, 1);
      blink = (1 - THREE.MathUtils.smoothstep(progress, 0, 1)) * state.blinkStrength;
    }

    const leftBias = 0.95 + Math.sin(now * 7.1) * 0.03;
    const rightBias = 0.95 + Math.cos(now * 6.3) * 0.03;
    blinkIndices.forEach((idx, index) => {
      const eyeBias = index % 2 === 0 ? leftBias : rightBias;
      influences[idx] = THREE.MathUtils.lerp(influences[idx] ?? 0, blink * eyeBias, 0.42);
    });

    return blink;
  };

  return { tickIdle };
}

export function useAvatarTrackSubscription() {
  const chunkStartedAt = useAvatarStore((s) => s.chunkStartedAt);
  const visemes = useAvatarStore((s) => s.visemes);
  const lastChunk = useAvatarStore((s) => s.lastChunk);
  return { chunkStartedAt, visemes, lastChunk };
}
