import { useMemo } from "react";
import type { VisemeKeyframe, VisemeKey } from "../types";
import { WS_PROTOCOL_VERSION } from "../types";
import { useAvatarTrackSubscription } from "../hooks/useAvatar";
import { useSessionStore } from "../store/sessionStore";
import { useAvatarStore } from "../store/avatarStore";

function pickVisemeAtTime(frames: VisemeKeyframe[], t: number): { key: VisemeKey; weight: number } {
  if (!frames.length) return { key: "sil", weight: 0 };
  let cur = frames[0];
  for (const f of frames) {
    if (f.time <= t) cur = f;
    else break;
  }
  return { key: cur.viseme, weight: cur.weight };
}

export function LipSyncDiagnostics() {
  const { chunkStartedAt, visemes, lastChunk } = useAvatarTrackSubscription();
  const capabilities = useSessionStore((s) => s.capabilities);
  const wsProtocolVersion = useSessionStore((s) => s.wsProtocolVersion);
  const visemeMorphCount = useAvatarStore((s) => s.visemeMorphCount);
  const morphHost = useAvatarStore((s) => s.morphHost);
  const avatarAsset = useAvatarStore((s) => s.avatarAsset);
  const setVisemeTrack = useAvatarStore((s) => s.setVisemeTrack);
  const personaId = useSessionStore((s) => s.personaId);
  const morphMissing = useMemo(() => {
    if (visemeMorphCount == null) return false;
    return visemeMorphCount <= 0;
  }, [visemeMorphCount]);

  const elapsedSec = useMemo(() => {
    if (chunkStartedAt == null) return 0;
    return Math.max(0, (performance.now() - chunkStartedAt) / 1000);
  }, [chunkStartedAt]);

  const cur = useMemo(() => pickVisemeAtTime(visemes, elapsedSec), [elapsedSec, visemes]);

  const playbackLatencyMs =
    chunkStartedAt != null && lastChunk.receivedAt != null
      ? Math.max(0, chunkStartedAt - lastChunk.receivedAt)
      : null;

  const canTestMouth = true;
  const triggerTestMouth = () => {
    const frames: VisemeKeyframe[] = [
      { time: 0, viseme: "aa", weight: 1 },
      { time: 0.18, viseme: "aa", weight: 0.95 },
      { time: 0.36, viseme: "PP", weight: 0.9 },
      { time: 0.54, viseme: "FF", weight: 0.85 },
      { time: 0.72, viseme: "oh", weight: 0.9 },
      { time: 0.95, viseme: "sil", weight: 0 },
    ];
    setVisemeTrack(frames, performance.now(), {
      sentenceIndex: -999,
      isSilence: true,
      visemeSource: "fallback_static",
      receivedAt: performance.now(),
    });
  };

  const uploadLocalGlb = async (file: File) => {
    const serverBase = (import.meta.env.VITE_HTTP_SERVER_URL as string | undefined) ?? "http://localhost:3001";
    const form = new FormData();
    form.append("file", file, file.name);
    if (personaId) form.append("personaId", personaId);
    const res = await fetch(`${serverBase.replace(/\/+$/, "")}/assets/upload-avatar`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(t || `upload failed (${res.status})`);
    }
    const json = (await res.json()) as { url?: string };
    if (!json.url) throw new Error("upload failed (no url)");
    // Persist override and reload so AvatarCanvas picks it up.
    if (personaId) {
      window.localStorage.setItem(`proxim.avatarOverrideUrl:${personaId}`, json.url);
    }
    window.location.reload();
  };

  const clearAvatarOverride = () => {
    if (personaId) {
      window.localStorage.removeItem(`proxim.avatarOverrideUrl:${personaId}`);
    }
    window.location.reload();
  };

  return (
    <div className="panel px-4 py-3 text-xs text-fg">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-muted">
          wsProto=<span className="text-fg">
            client:{WS_PROTOCOL_VERSION} server:{wsProtocolVersion ?? "—"}
          </span>
        </p>
        {wsProtocolVersion != null && wsProtocolVersion !== WS_PROTOCOL_VERSION ? (
          <p className="text-muted">
            Warning: client/server WebSocket protocol mismatch — restart **both** `client` and `server` dev servers (or you’re connected to an old backend).
          </p>
        ) : null}
        <p className="font-mono text-fg">
          viseme=<span style={{ color: "rgb(var(--c-accent))" }}>{cur.key}</span> w={cur.weight.toFixed(2)} t=
          {elapsedSec.toFixed(2)}s
        </p>
        <p className="text-muted">
          source=<span className="text-fg">{lastChunk.visemeSource ?? "unknown"}</span>
        </p>
        <p className="text-muted">
          silence=<span className="text-fg">{String(!!lastChunk.isSilence)}</span>
        </p>
        <p className="text-muted">
          sentence=<span className="text-fg">{lastChunk.sentenceIndex ?? "-"}</span>
        </p>
        <p className="text-muted">
          alignment=<span className="text-fg">
            {capabilities.alignmentAvailable == null ? "unknown" : String(capabilities.alignmentAvailable)}
          </span>
        </p>
        <p className="text-muted">
          visemeMorphs=<span className="text-fg">{visemeMorphCount == null ? "unknown" : String(visemeMorphCount)}</span>
        </p>
        <p className="text-muted">
          morphHost=<span className="text-fg">{morphHost.meshName ?? "—"}</span>
        </p>
        <p className="text-muted">
          morphTargets=<span className="text-fg">{morphHost.totalMorphTargets ?? "—"}</span>
        </p>
        <p className="text-muted">
          avatarUrl=<span className="text-fg">{avatarAsset.resolvedUrl ?? "—"}</span>
        </p>
        {avatarAsset.loadError ? (
          <p className="text-muted">
            Avatar load error: <span className="text-fg">{avatarAsset.loadError}</span>
          </p>
        ) : null}
        <p className="text-muted">
          playbackLatency=<span className="text-fg">
            {playbackLatencyMs == null ? "-" : `${Math.round(playbackLatencyMs)}ms`}
          </span>
        </p>
        <button
          type="button"
          disabled={!canTestMouth}
          onClick={triggerTestMouth}
          className="btn px-2.5 py-1 text-[11px]"
          title="Force a short viseme track (no audio) to verify mouth morphs animate"
        >
          Test mouth
        </button>
        <label className="btn cursor-pointer px-2.5 py-1 text-[11px]">
          Upload .glb
          <input
            type="file"
            accept=".glb,model/gltf-binary"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void uploadLocalGlb(f).catch((err) => {
                // Surface via alert for now (diagnostics panel is already opt-in).
                alert(err instanceof Error ? err.message : String(err));
              });
            }}
          />
        </label>
        <button
          type="button"
          onClick={clearAvatarOverride}
          className="btn px-2.5 py-1 text-[11px]"
          title="Clear any uploaded override and return to the persona's default avatar"
        >
          Reset avatar
        </button>
        {morphMissing ? (
          <p className="text-muted">
            Note: the loaded GLB mesh doesn’t appear to expose Oculus `viseme_*` morph targets, so lips can’t be driven. Use a GLB exported with Oculus visemes (Ready Player Me with morphTargets, or a compatible asset).
          </p>
        ) : null}
        {morphHost.morphKeySample.length ? (
          <p className="max-w-full break-words text-subtle">
            morphKeys(sample)=<span className="text-muted">{morphHost.morphKeySample.join(", ")}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

