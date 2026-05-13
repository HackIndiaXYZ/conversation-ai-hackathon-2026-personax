import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Component, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AvatarModel } from "./AvatarModel";
import {
  buildLocalAvatarLoadCandidateUrls,
  buildRpmLoadCandidateUrls,
  isProxiedRpmAssetUrl,
  resolveAvatarUrl,
} from "../utils/resolveAvatarUrl";
import * as THREE from "three";
import { useAvatarTrackSubscription } from "../hooks/useAvatar";
import type { VisemeKeyframe, VisemeKey } from "../types";
import { useSessionStore } from "../store/sessionStore";
import { useAvatarStore } from "../store/avatarStore";

interface AvatarCanvasProps {
  avatarUrl: string;
  personaId?: string | null;
}

/**
 * Locks the default scene camera every frame. Drei's `<PerspectiveCamera>` runs internal
 * layout/render logic that can fight with other systems; pinning here stops any drift
 * (trackpad zoom, env helpers, mistaken bindings) from dollying through the face mesh.
 */
function PinBustCamera() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const pos = useMemo(() => new THREE.Vector3(0, 1.68, 0.68), []);
  const target = useMemo(() => new THREE.Vector3(0, 1.62, 0.02), []);

  useFrame(() => {
    camera.position.copy(pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    if (camera instanceof THREE.PerspectiveCamera) {
      // Flex/resize glitches can briefly report a ~0 height; unclamped aspect blows up WebGL + layout.
      const h = Math.max(1, size.height);
      const w = Math.max(1, size.width);
      const nextAspect = THREE.MathUtils.clamp(w / h, 0.02, 32);
      if (Math.abs(camera.aspect - nextAspect) > 1e-6) {
        camera.aspect = nextAspect;
        camera.updateProjectionMatrix();
      }
    }
  });

  return null;
}

/** Catches WebGL / GLB load errors so the rest of the app keeps running. */
class CanvasErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean; errorMsg: string }
> {
  state = { hasError: false, errorMsg: "" };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[AvatarCanvas] Canvas error caught:", error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function WebglRecoveryBridge({
  onContextLost,
}: {
  onContextLost: () => void;
}) {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      onContextLost();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost as EventListener, { passive: false });
    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost as EventListener);
    };
  }, [gl, onContextLost]);

  return null;
}

/**
 * Placeholder avatar rendered from Three.js primitives.
 * BASE_Y = 0.52 puts the head at world-y ≈ 1.58, centred in the bust camera
 * (camera at y=1.48 looking at y=1.46, fov=32 → visible range ≈ [1.22, 1.70]).
 */
function PlaceholderAvatar() {
  const { chunkStartedAt, visemes } = useAvatarTrackSubscription();
  const emotion = useSessionStore((s) => s.currentEmotion);
  const BASE_Y = 0.52;

  const mouth = (t: number) => {
    if (!visemes.length) return 0;
    let cur: VisemeKeyframe = visemes[0];
    for (const f of visemes) {
      if (f.time <= t) cur = f;
      else break;
    }
    const w = cur.viseme === ("sil" as VisemeKey) ? 0 : cur.weight;
    return THREE.MathUtils.clamp(w, 0, 1);
  };

  const g = useRef<THREE.Group>(null);
  const m = useRef<THREE.Mesh>(null);
  const browLeft = useRef<THREE.Mesh>(null);
  const browRight = useRef<THREE.Mesh>(null);
  const eyeLeft = useRef<THREE.Group>(null);
  const eyeRight = useRef<THREE.Group>(null);
  const lidLeft = useRef<THREE.Mesh>(null);
  const lidRight = useRef<THREE.Mesh>(null);
  const shoulderLeft = useRef<THREE.Mesh>(null);
  const shoulderRight = useRef<THREE.Mesh>(null);
  const emotionPose = useMemo(() => {
    const byEmotion = {
      neutral: { browLift: 0, browTilt: 0, mouthBias: 0, headTilt: 0, headPitch: 0 },
      engaged: {
        browLift: 0.012,
        browTilt: 0.006,
        mouthBias: 0.01,
        headTilt: THREE.MathUtils.degToRad(1.5),
        headPitch: THREE.MathUtils.degToRad(1.2),
      },
      skeptical: {
        browLift: 0.008,
        browTilt: -0.014,
        mouthBias: -0.002,
        headTilt: THREE.MathUtils.degToRad(-3.5),
        headPitch: THREE.MathUtils.degToRad(0.5),
      },
      concerned: {
        browLift: 0.018,
        browTilt: 0.01,
        mouthBias: -0.008,
        headTilt: THREE.MathUtils.degToRad(-1.5),
        headPitch: THREE.MathUtils.degToRad(3.5),
      },
      positive: {
        browLift: 0.01,
        browTilt: 0.01,
        mouthBias: 0.016,
        headTilt: THREE.MathUtils.degToRad(2.5),
        headPitch: THREE.MathUtils.degToRad(-1.6),
      },
    } as const;
    return byEmotion[emotion];
  }, [emotion]);

  useFrame(() => {
    const now = performance.now() / 1000;
    const idle = Math.sin(now * Math.PI * 2 * 0.25) * THREE.MathUtils.degToRad(3.5);
    const bob = Math.sin(now * Math.PI * 2 * 0.18) * 0.018;
    if (g.current) {
      g.current.rotation.y = idle;
      g.current.rotation.z = THREE.MathUtils.lerp(
        g.current.rotation.z,
        emotionPose.headTilt + Math.sin(now * Math.PI * 2 * 0.12) * THREE.MathUtils.degToRad(1.5),
        0.14
      );
      g.current.rotation.x = THREE.MathUtils.lerp(
        g.current.rotation.x,
        emotionPose.headPitch + Math.sin(now * Math.PI * 2 * 0.22) * THREE.MathUtils.degToRad(1.1),
        0.14
      );
      g.current.position.y = BASE_Y + bob;
    }
    const elapsed = chunkStartedAt != null ? Math.max(0, (performance.now() - chunkStartedAt) / 1000) : 0;
    const open = mouth(elapsed);
    const blinkPhase = Math.sin(now * Math.PI * 2 * 0.16);
    const blinkPulse = blinkPhase > 0.975 ? THREE.MathUtils.smoothstep(blinkPhase, 0.975, 1) : 0;
    const gazeX = Math.sin(now * Math.PI * 2 * 0.09) * 0.01 + Math.sin(now * Math.PI * 2 * 0.37) * 0.004;
    const gazeY = Math.cos(now * Math.PI * 2 * 0.07) * 0.008;
    const gesture = THREE.MathUtils.smoothstep(open, 0.05, 0.55);
    if (m.current) {
      const targetY = 0.012 + open * 0.12 + emotionPose.mouthBias;
      m.current.scale.y = THREE.MathUtils.lerp(m.current.scale.y, targetY, 0.25);
      m.current.position.y = 0.98 - open * 0.01;
      m.current.scale.x = THREE.MathUtils.lerp(m.current.scale.x, 0.92 + open * 0.2, 0.2);
    }
    if (browLeft.current && browRight.current) {
      browLeft.current.position.y = THREE.MathUtils.lerp(browLeft.current.position.y, 1.135 + emotionPose.browLift, 0.16);
      browRight.current.position.y = THREE.MathUtils.lerp(browRight.current.position.y, 1.135 + emotionPose.browLift, 0.16);
      browLeft.current.rotation.z = THREE.MathUtils.lerp(browLeft.current.rotation.z, -0.28 - emotionPose.browTilt, 0.16);
      browRight.current.rotation.z = THREE.MathUtils.lerp(browRight.current.rotation.z, 0.28 + emotionPose.browTilt, 0.16);
    }
    if (eyeLeft.current && eyeRight.current) {
      eyeLeft.current.position.x = -0.057 + gazeX;
      eyeRight.current.position.x = 0.057 + gazeX;
      eyeLeft.current.position.y = 1.075 + gazeY;
      eyeRight.current.position.y = 1.075 + gazeY;
    }
    if (lidLeft.current && lidRight.current) {
      const lidScale = 1 - blinkPulse * 0.94;
      lidLeft.current.scale.y = THREE.MathUtils.lerp(lidLeft.current.scale.y, lidScale, 0.42);
      lidRight.current.scale.y = THREE.MathUtils.lerp(lidRight.current.scale.y, lidScale, 0.42);
    }
    if (shoulderLeft.current && shoulderRight.current) {
      const swing = Math.sin(now * Math.PI * 2 * 0.43) * THREE.MathUtils.degToRad(5.5) * gesture;
      shoulderLeft.current.rotation.z = THREE.MathUtils.lerp(shoulderLeft.current.rotation.z, 0.18 + swing, 0.14);
      shoulderRight.current.rotation.z = THREE.MathUtils.lerp(shoulderRight.current.rotation.z, -0.18 - swing, 0.14);
    }
  });

  return (
    <group ref={g} position={[0, BASE_Y, 0]}>
      {/* Jacket / torso */}
      <mesh position={[0, 0.40, 0]}>
        <cylinderGeometry args={[0.19, 0.25, 0.62, 18]} />
        <meshStandardMaterial color="#1e3a5f" roughness={0.55} metalness={0.08} />
      </mesh>
      {/* White collar */}
      <mesh position={[0, 0.73, 0.045]}>
        <boxGeometry args={[0.13, 0.055, 0.035]} />
        <meshStandardMaterial color="#e8e8e8" roughness={0.3} />
      </mesh>
      {/* Neck */}
      <mesh position={[0, 0.84, 0]}>
        <cylinderGeometry args={[0.058, 0.068, 0.14, 12]} />
        <meshStandardMaterial color="#c09275" roughness={0.5} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.06, 0]}>
        <sphereGeometry args={[0.155, 28, 28]} />
        <meshStandardMaterial color="#c8956c" roughness={0.35} />
      </mesh>
      {/* Hair cap (hemisphere on top of head) */}
      <mesh position={[0, 1.185, 0]} scale={[1.0, 0.55, 1.0]}>
        <sphereGeometry args={[0.168, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#1a0a05" roughness={0.85} />
      </mesh>
      <mesh ref={browLeft} position={[-0.06, 1.135, 0.138]} rotation={[0, 0, -0.28]}>
        <boxGeometry args={[0.05, 0.008, 0.01]} />
        <meshStandardMaterial color="#1f120d" roughness={0.9} />
      </mesh>
      <mesh ref={browRight} position={[0.06, 1.135, 0.138]} rotation={[0, 0, 0.28]}>
        <boxGeometry args={[0.05, 0.008, 0.01]} />
        <meshStandardMaterial color="#1f120d" roughness={0.9} />
      </mesh>
      <group ref={eyeLeft} position={[-0.057, 1.075, 0.134]}>
        <mesh>
          <sphereGeometry args={[0.023, 10, 10]} />
          <meshStandardMaterial color="#f2f2f2" roughness={0.15} />
        </mesh>
        <mesh position={[0, 0, 0.02]}>
          <sphereGeometry args={[0.012, 8, 8]} />
          <meshStandardMaterial color="#120600" roughness={0.9} />
        </mesh>
      </group>
      <group ref={eyeRight} position={[0.057, 1.075, 0.134]}>
        <mesh>
          <sphereGeometry args={[0.023, 10, 10]} />
          <meshStandardMaterial color="#f2f2f2" roughness={0.15} />
        </mesh>
        <mesh position={[0, 0, 0.02]}>
          <sphereGeometry args={[0.012, 8, 8]} />
          <meshStandardMaterial color="#120600" roughness={0.9} />
        </mesh>
      </group>
      <mesh ref={lidLeft} position={[-0.057, 1.09, 0.142]} scale={[1, 1, 1]}>
        <boxGeometry args={[0.05, 0.028, 0.012]} />
        <meshStandardMaterial color="#c8956c" roughness={0.65} />
      </mesh>
      <mesh ref={lidRight} position={[0.057, 1.09, 0.142]} scale={[1, 1, 1]}>
        <boxGeometry args={[0.05, 0.028, 0.012]} />
        <meshStandardMaterial color="#c8956c" roughness={0.65} />
      </mesh>
      {/* Mouth (animated open/close) */}
      <mesh ref={m} position={[0, 0.98, 0.143]} scale={[0.095, 0.012, 0.018]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#6b2737" roughness={0.7} />
      </mesh>
      {/* Left shoulder */}
      <mesh ref={shoulderLeft} position={[-0.265, 0.70, 0]}>
        <sphereGeometry args={[0.088, 12, 12]} />
        <meshStandardMaterial color="#162e52" roughness={0.55} metalness={0.08} />
      </mesh>
      {/* Right shoulder */}
      <mesh ref={shoulderRight} position={[0.265, 0.70, 0]}>
        <sphereGeometry args={[0.088, 12, 12]} />
        <meshStandardMaterial color="#162e52" roughness={0.55} metalness={0.08} />
      </mesh>
    </group>
  );
}

export function AvatarCanvas({ avatarUrl, personaId }: AvatarCanvasProps) {
  void PlaceholderAvatar;
  const consultationSceneUrl = "/scene-backgrounds/hospital-consultation-room.png";
  const consultationSceneBackground = `url("${consultationSceneUrl}")`;
  /** Final GLB URL after optional RPM proxy preflight (avoids 502 loop + runaway canvas when load fails). */
  const [gltfUrl, setGltfUrl] = useState<string | null>(null);
  const [avatarStatus, setAvatarStatus] = useState<"preparing" | "ready" | "fallback">("preparing");
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  /**
   * If the GLB hasn't loaded within AVATAR_LOAD_TIMEOUT_MS, stop waiting and show
   * PlaceholderAvatar. This handles blocked / slow CDNs (e.g. models.readyplayer.me
   * unreachable on some networks) without hanging the canvas forever.
   */
  // 30 s — RPM GLBs can be 5–20 MB; 5 s was firing before the download finished.
  const AVATAR_LOAD_TIMEOUT_MS = 30_000;
  const [avatarTimedOut, setAvatarTimedOut] = useState(false);
  const lastRecoveryAtRef = useRef(0);

  useEffect(() => {
    useAvatarStore.getState().setAvatarAssetInfo({
      resolvedUrl: gltfUrl,
      renderMode: !gltfUrl ? "loading" : avatarTimedOut || avatarStatus === "fallback" ? "fallback" : "loading",
      loadError:
        avatarTimedOut ? "Avatar GLB load timed out" : avatarStatus === "fallback" ? "Using placeholder avatar" : null,
    });
  }, [avatarStatus, avatarTimedOut, gltfUrl]);

  useEffect(() => {
    let cancelled = false;
    let overrideUrl: string | null = null;
    try {
      const o = personaId ? window.localStorage.getItem(`proxim.avatarOverrideUrl:${personaId}`) : null;
      overrideUrl = o?.trim() || null;
      const isBundledPersonaAvatar = avatarUrl.startsWith("/avatars/") && !/uploaded-avatar(?:-|\.glb)/.test(avatarUrl);
      const isUploadedOverride = !!overrideUrl && /\/avatars\/uploaded-avatar(?:-[^/?]+)?\.glb(?:$|\?)/.test(overrideUrl);
      if (personaId && isBundledPersonaAvatar && isUploadedOverride) {
        window.localStorage.removeItem(`proxim.avatarOverrideUrl:${personaId}`);
        overrideUrl = null;
      }
    } catch {
      /* ignore */
    }
    const overrideResolved = overrideUrl ? resolveAvatarUrl(overrideUrl, personaId) : null;
    const resolved = resolveAvatarUrl(avatarUrl, personaId);
    const rpmCandidates = !overrideResolved ? buildRpmLoadCandidateUrls(avatarUrl) : null;
    const localCandidates = buildLocalAvatarLoadCandidateUrls(avatarUrl);
    const overrideCandidates = overrideResolved
      ? buildLocalAvatarLoadCandidateUrls(overrideResolved) ?? [overrideResolved]
      : null;

    const isSameOriginOrLocalApi = (u: string) => {
      if (u.startsWith("/__rpm/")) return true;
      try {
        const p = new URL(u, window.location.href);
        if (p.origin === window.location.origin) return true;
        if (p.hostname === "localhost" || p.hostname === "127.0.0.1") return true;
      } catch {
        return false;
      }
      return false;
    };

    const candidateUrls = [
      ...(overrideCandidates ?? []),
      ...(localCandidates ?? []),
      ...(rpmCandidates ?? []),
    ];

    if (!candidateUrls.length) {
      setGltfUrl(resolved);
      setAvatarStatus("ready");
      return () => {
        cancelled = true;
      };
    }

    const shouldProbe =
      !!overrideCandidates?.length ||
      !!localCandidates?.length ||
      isProxiedRpmAssetUrl(resolved) ||
      resolved.startsWith("/__rpm/");

    if (!shouldProbe) {
      setGltfUrl(resolved);
      setAvatarStatus("ready");
      return () => {
        cancelled = true;
      };
    }

    setGltfUrl(null);
    setAvatarStatus("preparing");
    void (async () => {
      for (const u of candidateUrls) {
        if (cancelled) return;
        if (!isSameOriginOrLocalApi(u)) continue;
        try {
          const r = await fetch(u, { method: "HEAD", cache: "no-store" });
          if (cancelled) return;
          if (r.ok) {
            setGltfUrl(u);
            setAvatarStatus("ready");
            return;
          }
        } catch {
          /* try next candidate */
        }
      }
      if (!cancelled) {
        if (overrideCandidates?.length) {
          try {
            if (personaId) window.localStorage.removeItem(`proxim.avatarOverrideUrl:${personaId}`);
          } catch {
            /* ignore */
          }
        }
        setGltfUrl(localCandidates?.[0] ?? rpmCandidates?.[0] ?? resolved);
        setAvatarStatus("fallback");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [avatarUrl, personaId]);

  // Reset + start the per-URL load timeout whenever gltfUrl changes.
  useEffect(() => {
    if (!gltfUrl) return;
    setAvatarTimedOut(false);
    const id = setTimeout(() => {
      setAvatarTimedOut(true);
      const store = useAvatarStore.getState();
      store.setAvatarAssetInfo({
        resolvedUrl: gltfUrl,
        loadError: "Avatar load timed out, retrying real GLB",
        renderMode: "loading",
      });
      setCanvasEpoch((x) => x + 1);
    }, AVATAR_LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [gltfUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!avatarTimedOut) return;
    useAvatarStore.getState().setAvatarAssetInfo({
      resolvedUrl: gltfUrl,
      renderMode: "loading",
      loadError: "Avatar GLB load timed out, retrying",
    });
  }, [avatarTimedOut, gltfUrl]);

  const recoverCanvas = () => {
    const now = Date.now();
    if (now - lastRecoveryAtRef.current < 1200) return;
    lastRecoveryAtRef.current = now;
    setAvatarStatus("preparing");
    setAvatarTimedOut(false);
    const store = useAvatarStore.getState();
    store.setAvatarAssetInfo({
      resolvedUrl: gltfUrl,
      loadError: "WebGL context lost, recovering canvas",
      renderMode: "loading",
      contextLossCount: store.avatarAsset.contextLossCount + 1,
    });
    window.setTimeout(() => {
      setCanvasEpoch((x) => x + 1);
    }, 120);
  };

  const fallbackOverlay = (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
      {/* Mini Three.js-free placeholder when the whole canvas crashes */}
      <div className="flex flex-col items-center gap-1 opacity-60">
        <div className="h-16 w-12 rounded-full" style={{ background: "rgb(var(--c-accent2) / 0.22)" }} />
        <div className="h-24 w-16 rounded-t-xl" style={{ background: "rgb(var(--c-accent) / 0.18)" }} />
      </div>
      <p className="text-xs text-muted">Avatar unavailable (GLB load failed)</p>
    </div>
  );

  return (
    <div
      className="panel-strong relative w-full overflow-hidden"
      style={{
        height: "clamp(280px, min(52vh, 560px), 620px)",
        background:
          "linear-gradient(165deg, rgb(var(--c-surface2) / 0.92), rgb(var(--c-surface) / 0.72))",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: consultationSceneBackground,
          backgroundPosition: "center center",
          backgroundSize: "cover",
          filter: "blur(1.5px) saturate(0.92)",
          opacity: 0.72,
          transform: "scale(1.025)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{
          height: "31%",
          backgroundImage: consultationSceneBackground,
          backgroundPosition: "center bottom",
          backgroundSize: "cover",
          filter: "saturate(0.94) contrast(0.96)",
          opacity: 0.48,
          maskImage: "linear-gradient(180deg, transparent 0%, black 22%, black 100%)",
          WebkitMaskImage: "linear-gradient(180deg, transparent 0%, black 22%, black 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 28%, transparent 0%, rgb(var(--c-bg) / 0.1) 54%, rgb(var(--c-bg) / 0.5) 100%), linear-gradient(180deg, rgb(var(--c-surface2) / 0.1), rgb(var(--c-bg) / 0.28))",
        }}
      />
      {!gltfUrl ? (
        <div className="relative z-10 flex h-full w-full items-center justify-center">
          <p className="text-xs text-muted">
            {avatarStatus === "fallback" ? "Recovering avatar..." : "Preparing avatar..."}
          </p>
        </div>
      ) : (
        <CanvasErrorBoundary fallback={fallbackOverlay}>
          <Canvas
            key={`${gltfUrl}:${canvasEpoch}`}
            className="relative z-10 block h-full w-full touch-none"
            style={{ width: "100%", height: "100%", display: "block" }}
            dpr={1}
            gl={{
              alpha: true,
              antialias: false,
              powerPreference: "low-power",
              failIfMajorPerformanceCaveat: false,
            }}
            camera={{ position: [0, 1.68, 0.68], fov: 23, near: 0.08, far: 80 }}
            onCreated={({ camera }) => {
              camera.up.set(0, 1, 0);
              camera.lookAt(0, 1.62, 0.02);
            }}
          >
            <WebglRecoveryBridge onContextLost={recoverCanvas} />
            <PinBustCamera />
            <ambientLight intensity={0.55} />
            <directionalLight position={[2, 3, 2]} intensity={1.05} />
            <Suspense
              fallback={
                <Html center>
                  <div className="rounded-md border border-border bg-bg/80 px-3 py-2 text-xs text-muted">
                    Loading avatar...
                  </div>
                </Html>
              }
            >
              <AvatarModel url={gltfUrl} fallback={null} />
            </Suspense>
          </Canvas>
        </CanvasErrorBoundary>
      )}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
        style={{
          background: "linear-gradient(180deg, transparent, rgb(var(--c-bg) / 0.55))",
          zIndex: 20,
        }}
      />
    </div>
  );
}
