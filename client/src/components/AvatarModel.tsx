import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAvatarMorphs, useAvatarIdleClock, useAvatarTrackSubscription } from "../hooks/useAvatar";
import { useSessionStore } from "../store/sessionStore";
import { useAvatarStore } from "../store/avatarStore";
import { KTX2Loader, SkeletonUtils } from "three-stdlib";
import type { VisemeKeyframe, VisemeKey } from "../types";

type MorphHost = THREE.SkinnedMesh | THREE.Mesh;
const LOCKED_PORTRAIT_SCALE = 1.02;
const LOCKED_FACE_CENTER = new THREE.Vector3(0, 1.56, 0.01);
const MOTION_SCALE = 0.68;

type ResponseCues = {
  nod: number;
  tilt: number;
  focus: number;
  warmth: number;
  skepticism: number;
};

function findMorphHost(root: THREE.Object3D): { mesh: MorphHost; dict: Record<string, number> } | null {
  let bestScore = -1;
  let picked: { mesh: MorphHost; dict: Record<string, number> } | null = null;
  root.traverse((obj) => {
    const m = obj as MorphHost;
    const meshAny = m as unknown as { isSkinnedMesh?: boolean; isMesh?: boolean };
    if (!meshAny.isMesh && !meshAny.isSkinnedMesh) return;
    const dict = m.morphTargetDictionary as Record<string, number> | undefined;
    const infl = m.morphTargetInfluences;
    if (!dict || !infl) return;
    const keys = Object.keys(dict);
    const lower = keys.map((k) => k.toLowerCase());
    const visemeCount = lower.filter((k) => k.startsWith("viseme_") || k.includes("viseme")).length;
    // Many GLBs (ARKit / MetaHuman / Apple blendshapes) don't have `viseme_*` but do have mouth/jaw shapes.
    const mouthCount = lower.filter(
      (k) =>
        k.includes("mouth") ||
        k.includes("jaw") ||
        k.includes("lip") ||
        k.includes("smile") ||
        k.includes("funnel") ||
        k.includes("pucker")
    ).length;
    const blinkCount = lower.filter((k) => k.includes("blink") || k.includes("eyeclose") || k.includes("eye_close")).length;
    const emotionCount = lower.filter((k) => k.startsWith("emotion_")).length;
    // Prefer meshes that look like a face:
    // - Strongly prefer visemes
    // - Prefer head/face meshes over eyes/teeth (RPM often has separate EyeLeft/EyeRight meshes)
    const name = (m.name || "").toLowerCase();
    const isHeadLike = /head|face|wolf3d|avatar/i.test(name);
    const isEyeLike = /eye|eyelash|brow/i.test(name);
    const isTeethLike = /teeth|tongue/i.test(name);

    // Base score from morph inventory.
    let score = visemeCount * 100 + mouthCount * 6 + blinkCount * 2 + emotionCount;
    // Name-based priors.
    if (isHeadLike) score += 5000;
    if (isTeethLike) score -= 500; // teeth meshes can have mouthOpen etc but not the full face
    if (isEyeLike) score -= 8000; // avoid selecting eye meshes even if they expose some viseme keys

    // Hard requirement: if it has viseme keys but also looks like an eye, don't pick it.
    if (isEyeLike && visemeCount > 0) score -= 20000;
    if (score > bestScore) {
      bestScore = score;
      picked = { mesh: m as MorphHost, dict };
    }
  });
  return picked;
}

function findBlinkIndex(dict: Record<string, number>): number | undefined {
  const keys = Object.keys(dict);
  const preferred = ["eyeBlinkLeft", "eyeBlinkRight", "eyesClosed", "EyeBlink_L", "EyeBlink_R"];
  for (const p of preferred) {
    if (typeof dict[p] === "number") return dict[p];
  }
  const k = keys.find((x) => /blink/i.test(x) && !/viseme/i.test(x));
  return k !== undefined ? dict[k] : undefined;
}

function findMorphIndices(dict: Record<string, number> | undefined, patterns: RegExp[]): number[] {
  if (!dict) return [];
  return Object.entries(dict)
    .filter(([name]) => patterns.some((pattern) => pattern.test(name)))
    .map(([, index]) => index);
}

function findFirstBoneByName(root: THREE.Object3D, patterns: RegExp[]): THREE.Bone | null {
  let picked: THREE.Bone | null = null;
  root.traverse((obj) => {
    if (picked) return;
    if (!(obj as THREE.Bone).isBone) return;
    const b = obj as THREE.Bone;
    const n = b.name || "";
    if (patterns.some((p) => p.test(n))) picked = b;
  });
  return picked;
}

function findMorphIndex(dict: Record<string, number> | undefined, patterns: RegExp[]): number | undefined {
  if (!dict) return undefined;
  const entries = Object.entries(dict);
  const found = entries.find(([name]) => patterns.some((pattern) => pattern.test(name)));
  return found?.[1];
}

function pickVisemeAtTime(frames: VisemeKeyframe[], t: number): { key: VisemeKey; weight: number } {
  if (!frames.length) return { key: "sil", weight: 0 };
  let cur = frames[0];
  for (const f of frames) {
    if (f.time <= t) cur = f;
    else break;
  }
  return { key: cur.viseme, weight: cur.weight };
}

function inferResponseCues(text: string): ResponseCues {
  const lower = text.toLowerCase();
  const hasQuestion = /\?|\b(can|could|would|how|what|why|which|where|when)\b/.test(lower);
  const hasContrast = /\b(but|however|although|concern|risk|not sure|skeptical|uncomfortable)\b/.test(lower);
  const hasPositive = /\b(good|helpful|reasonable|agree|yes|right|positive|useful|promising)\b/.test(lower);
  const hasEngaged = /\b(tell me|listening|focus|understand|explain|share|show me)\b/.test(lower);

  return {
    nod: hasPositive ? 1 : hasEngaged ? 0.55 : 0,
    tilt: hasQuestion ? 1 : hasContrast ? -0.55 : 0,
    focus: hasQuestion || hasEngaged ? 1 : 0.35,
    warmth: hasPositive ? 1 : hasEngaged ? 0.45 : 0,
    skepticism: hasContrast ? 1 : 0,
  };
}

interface AvatarModelProps {
  url: string;
  /** Rendered instead of the GLB when the model fails to load. */
  fallback?: ReactNode;
}

/**
 * Loads a Ready Player Me GLB and drives viseme / emotion morph targets each frame.
 * If the GLB fetch fails (network error, 404, CORS) it renders the `fallback` node
 * instead of propagating the error up to crash the canvas.
 */
export function AvatarModel({ url, fallback }: AvatarModelProps) {
  return <AvatarModelInner url={url} fallback={fallback} />;
}

function AvatarModelInner({
  url,
  fallback,
}: {
  url: string;
  fallback?: ReactNode;
}) {
  const gl = useThree((s) => s.gl);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  // Record the resolved URL so diagnostics can confirm what we attempted to load.
  useEffect(() => {
    useAvatarStore.getState().setAvatarAssetInfo({ resolvedUrl: url, loadError: null, renderMode: "loading" });
  }, [url]);

  // Ready Player Me GLBs commonly use KTX2/Basis textures (KHR_texture_basisu).
  // Configure KTX2Loader per renderer, and attach it to GLTFLoader via drei's extendLoader.
  const ktx2 = useMemo(() => {
    const loader = new KTX2Loader();
    loader.setTranscoderPath("https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/basis/");
    loader.detectSupport(gl);
    return loader;
  }, [gl]);

  useEffect(() => {
    return () => {
      try {
        ktx2.dispose();
      } catch {
        // ignore
      }
    };
  }, [ktx2]);

  let gltf: ReturnType<typeof useGLTF> | null = null;
  try {
    // useGLTF suspends while loading; on error it throws which Suspense re-throws
    // eslint-disable-next-line react-hooks/rules-of-hooks
    gltf = useGLTF(url, true, true, (loader) => {
      // three-stdlib GLTFLoader supports KTX2Loader via setKTX2Loader.
      (loader as unknown as { setKTX2Loader?: (l: KTX2Loader) => void }).setKTX2Loader?.(ktx2);
    });
  } catch (e) {
    // If it's a Promise (suspense), rethrow so Suspense can handle it
    if (e instanceof Promise) throw e;
    // Otherwise it's a real error — render fallback without setState during render.
    console.warn("[AvatarModel] GLB load failed:", e);
    useAvatarStore.getState().setAvatarAssetInfo({
      resolvedUrl: url,
      loadError: e instanceof Error ? e.message : String(e),
      loadedAt: null,
      renderMode: "fallback",
    });
    return <>{fallback ?? null}</>;
  }

  const { scene } = gltf;
  const animations = gltf.animations;
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const group = useRef<THREE.Group>(null);
  const [morphHost, setMorphHost] = useState<{ mesh: MorphHost; dict: Record<string, number> } | null>(
    null
  );

  useLayoutEffect(() => {
    const host = findMorphHost(clone);
    setMorphHost(host);
    if (!host) {
      useAvatarStore.getState().setMorphInventory(0);
      useAvatarStore.getState().setMorphHostInfo({
        meshName: null,
        morphKeySample: [],
        totalMorphTargets: 0,
      });
      return;
    }
    const keys = Object.keys(host.dict);
    const count = keys.filter((k) => /^viseme_/i.test(k) || /^Viseme_/i.test(k) || /viseme/i.test(k)).length;
    useAvatarStore.getState().setMorphInventory(count);
    useAvatarStore.getState().setMorphHostInfo({
      meshName: host.mesh.name || "(unnamed-mesh)",
      morphKeySample: keys.slice(0, 35),
      totalMorphTargets: keys.length,
    });
  }, [clone]);

  // Mark successful load for diagnostics.
  useEffect(() => {
    useAvatarStore.getState().setAvatarAssetInfo({
      resolvedUrl: url,
      loadError: null,
      loadedAt: Date.now(),
      renderMode: "gltf",
    });
  }, [url]);

  useEffect(() => {
    if (!animations.length) {
      mixerRef.current = null;
      return;
    }

    const mixer = new THREE.AnimationMixer(clone);
    for (const clip of animations) {
      const action = mixer.clipAction(clip);
      action.reset();
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.fadeIn(0.2);
      action.play();
    }
    mixerRef.current = mixer;

    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
    };
  }, [animations, clone]);

  // Locked portrait framing: every persona uses the same crop/scale so the bust framing never drifts.
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;

    const fullBox = new THREE.Box3().setFromObject(clone);
    const fullCenter = fullBox.getCenter(new THREE.Vector3());

    const focusObject = morphHost?.mesh ?? bones.head ?? clone;
    const focusBox = new THREE.Box3().setFromObject(focusObject);
    const focusCenter = focusBox.getCenter(new THREE.Vector3());

    const scale = LOCKED_PORTRAIT_SCALE;
    g.scale.setScalar(scale);

    g.position.set(
      LOCKED_FACE_CENTER.x - focusCenter.x * scale - fullCenter.x * scale * 0.02,
      LOCKED_FACE_CENTER.y - focusCenter.y * scale + 0.025,
      LOCKED_FACE_CENTER.z - focusCenter.z * scale - fullCenter.z * scale * 0.04
    );
  }, [clone, morphHost]);

  const { applyFrame } = useAvatarMorphs(morphHost?.dict);
  const { tickIdle } = useAvatarIdleClock();
  const { chunkStartedAt, visemes } = useAvatarTrackSubscription();
  const currentEmotion = useSessionStore((s) => s.currentEmotion);
  const assistantStreamingText = useSessionStore((s) => s.assistantStreamingText);
  const responseCues = useMemo(() => inferResponseCues(assistantStreamingText), [assistantStreamingText]);
  const gazeRef = useRef({
    yaw: 0,
    pitch: 0,
    targetYaw: 0,
    targetPitch: 0,
    nextShiftAt: 0,
  });
  const speechEnergyRef = useRef(0);

  const blinkIdx = useMemo(
    () => (morphHost ? findBlinkIndex(morphHost.dict) : undefined),
    [morphHost]
  );
  const blinkIndices = useMemo(() => {
    if (!morphHost) return blinkIdx != null ? [blinkIdx] : [];
    const left = findMorphIndices(morphHost.dict, [/eyeBlinkLeft/i, /EyeBlink_L/i, /left.*blink/i, /blink.*left/i]);
    const right = findMorphIndices(morphHost.dict, [/eyeBlinkRight/i, /EyeBlink_R/i, /right.*blink/i, /blink.*right/i]);
    const merged = [...left, ...right];
    if (merged.length) return Array.from(new Set(merged));
    return blinkIdx != null ? [blinkIdx] : [];
  }, [blinkIdx, morphHost]);
  const eyeLookInIdx = useMemo(
    () => findMorphIndices(morphHost?.dict, [/eyeLookInLeft/i, /eyeLookInRight/i, /eyelookin/i]),
    [morphHost]
  );
  const eyeLookOutIdx = useMemo(
    () => findMorphIndices(morphHost?.dict, [/eyeLookOutLeft/i, /eyeLookOutRight/i, /eyelookout/i]),
    [morphHost]
  );
  const eyeLookUpIdx = useMemo(
    () => findMorphIndices(morphHost?.dict, [/eyeLookUpLeft/i, /eyeLookUpRight/i, /eyelookup/i]),
    [morphHost]
  );
  const eyeLookDownIdx = useMemo(
    () => findMorphIndices(morphHost?.dict, [/eyeLookDownLeft/i, /eyeLookDownRight/i, /eyelookdown/i]),
    [morphHost]
  );
  const jawOpenIdx = useMemo(
    () => (morphHost ? findMorphIndex(morphHost.dict, [/^jawOpen$/i, /mouthOpen/i, /jaw_open/i]) : undefined),
    [morphHost]
  );

  // Cache commonly named bones for simple procedural animation.
  const bones = useMemo(() => {
    const root = clone as unknown as THREE.Object3D;
    const head =
      findFirstBoneByName(root, [/^head$/i, /head/i]) ??
      findFirstBoneByName(root, [/neck/i, /spine.*3/i, /spine.*2/i, /spine/i]);
    const spine = findFirstBoneByName(root, [/spine/i, /chest/i, /upperchest/i, /hips/i, /^hips$/i]);
    // RPM rigs commonly use LeftShoulder/LeftArm/LeftForeArm naming.
    const lArm = findFirstBoneByName(root, [/leftshoulder/i, /leftarm/i, /leftupperarm/i, /l.*upperarm/i, /^arm_l/i, /upperarm_l/i]);
    const rArm = findFirstBoneByName(root, [/rightshoulder/i, /rightarm/i, /rightupperarm/i, /r.*upperarm/i, /^arm_r/i, /upperarm_r/i]);
    const lFore = findFirstBoneByName(root, [/leftforearm/i, /leftlowerarm/i, /l.*forearm/i, /^forearm_l/i, /lowerarm_l/i]);
    const rFore = findFirstBoneByName(root, [/rightforearm/i, /rightlowerarm/i, /r.*forearm/i, /^forearm_r/i, /lowerarm_r/i]);
    const lHand = findFirstBoneByName(root, [/lefthand/i, /hand_l/i, /^wrist_l/i, /leftwrist/i]);
    const rHand = findFirstBoneByName(root, [/righthand/i, /hand_r/i, /^wrist_r/i, /rightwrist/i]);
    const jaw = findFirstBoneByName(root, [/jaw/i, /chin/i]);
    const neck = findFirstBoneByName(root, [/^neck$/i, /neck/i]);
    const lEye = findFirstBoneByName(root, [/lefteye/i, /^eye_l/i, /eyel/i]);
    const rEye = findFirstBoneByName(root, [/righteye/i, /^eye_r/i, /eyer/i]);
    return { head, neck, spine, lArm, rArm, lFore, rFore, lHand, rHand, jaw, lEye, rEye };
  }, [clone]);

  const restRot = useRef<{
    head?: THREE.Euler;
    neck?: THREE.Euler;
    spine?: THREE.Euler;
    lArm?: THREE.Euler;
    rArm?: THREE.Euler;
    lFore?: THREE.Euler;
    rFore?: THREE.Euler;
    lHand?: THREE.Euler;
    rHand?: THREE.Euler;
    jaw?: THREE.Euler;
    lEye?: THREE.Euler;
    rEye?: THREE.Euler;
  }>({});

  useLayoutEffect(() => {
    // Store rest rotations once we have the bones.
    restRot.current = {
      head: bones.head?.rotation.clone(),
      neck: bones.neck?.rotation.clone(),
      spine: bones.spine?.rotation.clone(),
      lArm: bones.lArm?.rotation.clone(),
      rArm: bones.rArm?.rotation.clone(),
      lFore: bones.lFore?.rotation.clone(),
      rFore: bones.rFore?.rotation.clone(),
      lHand: bones.lHand?.rotation.clone(),
      rHand: bones.rHand?.rotation.clone(),
      jaw: bones.jaw?.rotation.clone(),
      lEye: bones.lEye?.rotation.clone(),
      rEye: bones.rEye?.rotation.clone(),
    };
  }, [bones]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    mixerRef.current?.update(dt);

    const infl = morphHost?.mesh.morphTargetInfluences;

    const elapsed =
      chunkStartedAt != null ? Math.max(0, (performance.now() - chunkStartedAt) / 1000) : 0;
    const frames = visemes.length ? visemes : [{ time: 0, viseme: "sil" as const, weight: 0 }];
    const { key, weight } = pickVisemeAtTime(frames, elapsed);
    const speaking = key !== "sil" ? THREE.MathUtils.clamp(weight, 0, 1) : 0;
    speechEnergyRef.current = THREE.MathUtils.lerp(speechEnergyRef.current, speaking, speaking > 0.01 ? 0.34 : 0.16);
    const speechEnergy = speechEnergyRef.current;
    if (infl && morphHost) {
      applyFrame(infl, elapsed, frames, currentEmotion, speechEnergy);
    }

    // Procedural body language.
    // - Always: gentle breathing + torso sway.
    // - While speaking: arm gestures get stronger.
    const t = performance.now() / 1000;
    const gesture = THREE.MathUtils.smoothstep(speechEnergy, 0.05, 0.65);
    const breathe = Math.sin(t * Math.PI * 2 * 0.2) * THREE.MathUtils.degToRad(1.45);
    const sway = Math.sin(t * Math.PI * 2 * 0.1) * THREE.MathUtils.degToRad(1.4);
    const nodPulse =
      Math.sin(t * Math.PI * 2 * (0.5 + responseCues.nod * 0.16)) *
      THREE.MathUtils.degToRad(0.85) *
      gesture *
      responseCues.nod;
    const inquiryTilt =
      Math.sin(t * Math.PI * 2 * 0.22) *
      THREE.MathUtils.degToRad(0.75) *
      gesture *
      responseCues.tilt;
    const talkBob =
      Math.sin(t * Math.PI * 2 * (1.15 + gesture * 0.22)) *
      THREE.MathUtils.degToRad(1.05) *
      gesture *
      MOTION_SCALE;
    const emotionOffsets = {
      neutral: { headPitch: 0, headYaw: 0, headRoll: 0, torsoLean: 0 },
      engaged: {
        headPitch: THREE.MathUtils.degToRad(-0.45),
        headYaw: THREE.MathUtils.degToRad(0.95),
        headRoll: THREE.MathUtils.degToRad(0.6),
        torsoLean: THREE.MathUtils.degToRad(-0.75),
      },
      skeptical: {
        headPitch: THREE.MathUtils.degToRad(0.95),
        headYaw: THREE.MathUtils.degToRad(-1.45),
        headRoll: THREE.MathUtils.degToRad(-2.3),
        torsoLean: THREE.MathUtils.degToRad(0.35),
      },
      concerned: {
        headPitch: THREE.MathUtils.degToRad(1.75),
        headYaw: THREE.MathUtils.degToRad(-0.45),
        headRoll: THREE.MathUtils.degToRad(-0.65),
        torsoLean: THREE.MathUtils.degToRad(0.95),
      },
      positive: {
        headPitch: THREE.MathUtils.degToRad(-0.95),
        headYaw: THREE.MathUtils.degToRad(1.15),
        headRoll: THREE.MathUtils.degToRad(1.1),
        torsoLean: THREE.MathUtils.degToRad(-0.6),
      },
    } as const;
    const emotionOffset = emotionOffsets[currentEmotion];
    const gaze = gazeRef.current;
    if (gaze.nextShiftAt === 0) {
      gaze.nextShiftAt = t + 0.8;
    }
    if (t >= gaze.nextShiftAt) {
      const lookBias = {
        neutral: { yaw: 0, pitch: 0 },
        engaged: { yaw: THREE.MathUtils.degToRad(0.75), pitch: THREE.MathUtils.degToRad(-0.25) },
        skeptical: { yaw: THREE.MathUtils.degToRad(-1.1), pitch: THREE.MathUtils.degToRad(0.45) },
        concerned: { yaw: THREE.MathUtils.degToRad(-0.35), pitch: THREE.MathUtils.degToRad(0.75) },
        positive: { yaw: THREE.MathUtils.degToRad(1), pitch: THREE.MathUtils.degToRad(-0.5) },
      } as const;
      const bias = lookBias[currentEmotion];
      gaze.targetYaw = THREE.MathUtils.clamp(
        bias.yaw +
          (Math.random() - 0.5) * THREE.MathUtils.degToRad(5.2) +
          gesture * THREE.MathUtils.degToRad(0.65) +
          responseCues.skepticism * THREE.MathUtils.degToRad(-0.5),
        THREE.MathUtils.degToRad(-4.8),
        THREE.MathUtils.degToRad(4.8)
      );
      gaze.targetPitch = THREE.MathUtils.clamp(
        bias.pitch +
          (Math.random() - 0.45) * THREE.MathUtils.degToRad(3.4) -
          gesture * THREE.MathUtils.degToRad(0.2) -
          responseCues.focus * THREE.MathUtils.degToRad(0.25),
        THREE.MathUtils.degToRad(-3.2),
        THREE.MathUtils.degToRad(3.2)
      );
      gaze.nextShiftAt = t + 1.25 + Math.random() * 1.9 - gesture * 0.18 - responseCues.focus * 0.18;
    }
    gaze.yaw = THREE.MathUtils.lerp(gaze.yaw, gaze.targetYaw, 0.045 + gesture * 0.045);
    gaze.pitch = THREE.MathUtils.lerp(gaze.pitch, gaze.targetPitch, 0.04 + gesture * 0.03);
    const microSaccadeX = Math.sin(t * 7.4) * THREE.MathUtils.degToRad(0.18);
    const microSaccadeY = Math.cos(t * 6.1) * THREE.MathUtils.degToRad(0.12);
    const gazeYaw = gaze.yaw + microSaccadeX;
    const gazePitch = gaze.pitch + microSaccadeY;
    const blink = tickIdle(infl, blinkIndices, dt, Math.max(0, Math.abs(gaze.targetYaw - gaze.yaw) * 9 - 0.12));
    const speechFacePulse = Math.sin(t * Math.PI * 2 * (1.9 + speechEnergy * 0.8)) * speechEnergy;

    const applyBone = (bone: THREE.Bone | null, base: THREE.Euler | undefined, dx: number, dy: number, dz: number) => {
      if (!bone || !base) return;
      bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, base.x + dx, 0.18);
      bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, base.y + dy, 0.18);
      bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, base.z + dz, 0.18);
    };

    applyBone(
      bones.spine,
      restRot.current.spine,
      breathe + talkBob * 0.28 + emotionOffset.torsoLean,
      sway * 0.28,
      sway * 0.16 + inquiryTilt * 0.12
    );
    applyBone(
      bones.neck,
      restRot.current.neck,
      talkBob * 0.22 +
        nodPulse * 0.5 +
        emotionOffset.headPitch * 0.28 +
        speechFacePulse * THREE.MathUtils.degToRad(0.24),
      gazeYaw * 0.16 + emotionOffset.headYaw * 0.25,
      sway * 0.08 + emotionOffset.headRoll * 0.18 + inquiryTilt * 0.25
    );
    applyBone(
      bones.head,
      restRot.current.head,
      talkBob * 0.28 +
        nodPulse +
        emotionOffset.headPitch +
        blink * THREE.MathUtils.degToRad(0.8) +
        speechFacePulse * THREE.MathUtils.degToRad(0.42),
      gazeYaw * 0.32 + emotionOffset.headYaw,
      sway * 0.12 +
        emotionOffset.headRoll +
        inquiryTilt * 0.55 +
        responseCues.warmth * THREE.MathUtils.degToRad(0.35) +
        speechFacePulse * THREE.MathUtils.degToRad(0.18)
    );

    // Arms and hands: small idle motion, bigger alternating gestures while speaking.
    const armSwing = Math.sin(t * Math.PI * 2 * 0.28) * THREE.MathUtils.degToRad(1.7);
    const gestureLift = THREE.MathUtils.degToRad(6.5) * gesture * (0.72 + responseCues.focus * 0.18);
    const gesturePulse = Math.sin(t * Math.PI * 2 * (0.38 + gesture * 0.12));
    const gestureOut = THREE.MathUtils.degToRad(4.5) * gesture * Math.sin(t * Math.PI * 2 * 0.42);
    const leftAccent = Math.max(0, gesturePulse);
    const rightAccent = Math.max(0, -gesturePulse);
    applyBone(
      bones.lArm,
      restRot.current.lArm,
      armSwing - gestureLift * (0.46 + leftAccent * 0.34),
      -gestureOut * 0.2 - THREE.MathUtils.degToRad(2.6) * leftAccent,
      gestureOut * 0.24 + THREE.MathUtils.degToRad(2.2) * leftAccent
    );
    applyBone(
      bones.rArm,
      restRot.current.rArm,
      -armSwing - gestureLift * (0.46 + rightAccent * 0.34),
      gestureOut * 0.2 + THREE.MathUtils.degToRad(2.6) * rightAccent,
      -gestureOut * 0.24 - THREE.MathUtils.degToRad(2.2) * rightAccent
    );

    // Forearms: follow-through.
    applyBone(
      bones.lFore,
      restRot.current.lFore,
      -gestureLift * (0.18 + leftAccent * 0.22),
      -gestureOut * 0.15,
      gestureOut * 0.1 + THREE.MathUtils.degToRad(2.2) * leftAccent
    );
    applyBone(
      bones.rFore,
      restRot.current.rFore,
      -gestureLift * (0.18 + rightAccent * 0.22),
      gestureOut * 0.15,
      -gestureOut * 0.1 - THREE.MathUtils.degToRad(2.2) * rightAccent
    );
    applyBone(
      bones.lHand,
      restRot.current.lHand,
      THREE.MathUtils.degToRad(1.6) * leftAccent,
      THREE.MathUtils.degToRad(2) * leftAccent,
      THREE.MathUtils.degToRad(2.8) * leftAccent
    );
    applyBone(
      bones.rHand,
      restRot.current.rHand,
      THREE.MathUtils.degToRad(1.6) * rightAccent,
      -THREE.MathUtils.degToRad(2) * rightAccent,
      -THREE.MathUtils.degToRad(2.8) * rightAccent
    );

    const visemeJawBias: Partial<Record<VisemeKey, number>> = {
      PP: 0.08,
      FF: 0.22,
      TH: 0.5,
      DD: 0.34,
      kk: 0.42,
      CH: 0.44,
      SS: 0.26,
      nn: 0.18,
      RR: 0.28,
      aa: 0.95,
      E: 0.46,
      ih: 0.34,
      oh: 0.62,
      ou: 0.4,
    };
    const jawTarget = THREE.MathUtils.clamp((visemeJawBias[key] ?? 0) * weight * 0.82 + speechEnergy * 0.18, 0, 0.82);

    if (bones.jaw && restRot.current.jaw) {
      bones.jaw.rotation.x = THREE.MathUtils.lerp(
        bones.jaw.rotation.x,
        restRot.current.jaw.x + THREE.MathUtils.degToRad(10.5) * jawTarget,
        0.16
      );
    } else if (typeof jawOpenIdx === "number" && infl) {
      infl[jawOpenIdx] = THREE.MathUtils.lerp(infl[jawOpenIdx] ?? 0, jawTarget, 0.16);
    }

    if (bones.lEye && restRot.current.lEye) {
      bones.lEye.rotation.y = THREE.MathUtils.lerp(
        bones.lEye.rotation.y,
        restRot.current.lEye.y + (gazeYaw + THREE.MathUtils.degToRad(0.4)) * 0.34,
        0.18
      );
      bones.lEye.rotation.x = THREE.MathUtils.lerp(
        bones.lEye.rotation.x,
        restRot.current.lEye.x + (gazePitch - blink * THREE.MathUtils.degToRad(0.8)) * 0.27,
        0.18
      );
    }
    if (bones.rEye && restRot.current.rEye) {
      bones.rEye.rotation.y = THREE.MathUtils.lerp(
        bones.rEye.rotation.y,
        restRot.current.rEye.y + (gazeYaw - THREE.MathUtils.degToRad(0.4)) * 0.34,
        0.18
      );
      bones.rEye.rotation.x = THREE.MathUtils.lerp(
        bones.rEye.rotation.x,
        restRot.current.rEye.x + (gazePitch - blink * THREE.MathUtils.degToRad(0.8)) * 0.27,
        0.18
      );
    }

    if (infl) {
      for (const idx of eyeLookInIdx) {
        infl[idx] = THREE.MathUtils.lerp(infl[idx] ?? 0, Math.max(0, -gazeYaw) * 5, 0.14);
      }
      for (const idx of eyeLookOutIdx) {
        infl[idx] = THREE.MathUtils.lerp(infl[idx] ?? 0, Math.max(0, gazeYaw) * 5, 0.14);
      }
      for (const idx of eyeLookUpIdx) {
        infl[idx] = THREE.MathUtils.lerp(infl[idx] ?? 0, Math.max(0, -gazePitch) * 5, 0.14);
      }
      for (const idx of eyeLookDownIdx) {
        infl[idx] = THREE.MathUtils.lerp(infl[idx] ?? 0, Math.max(0, gazePitch) * 5, 0.14);
      }
    }
  });

  return (
    <group ref={group} dispose={null}>
      <primitive object={clone} />
    </group>
  );
}
