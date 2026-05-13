import { useSessionStore } from "../store/sessionStore";

/** Returns a traffic-light colour class for a latency value in milliseconds. */
function latencyColor(ms: number | null): string {
  if (ms === null) return "rgb(var(--c-fg) / 0.5)";
  if (ms < 300) return "#22c55e"; // green
  if (ms < 500) return "#f59e0b"; // yellow
  return "#ef4444"; // red
}

function Row({ label, ms }: { label: string; ms: number | null }) {
  const color = latencyColor(ms);
  return (
    <div className="flex items-center justify-between gap-3 text-fg">
      <span className="text-muted">{label}</span>
      <span className="font-mono tabular-nums" style={{ color }}>
        {ms !== null ? `${ms} ms` : "—"}
      </span>
    </div>
  );
}

/**
 * Overlay showing both client-measured and server-reported latency.
 * Green < 300 ms · Yellow 300–500 ms · Red > 500 ms
 */
export function LatencyHud() {
  const latency = useSessionStore((s) => s.latency);
  const serverLatency = useSessionStore((s) => s.serverLatency);

  const hasClientData =
    latency.llmMs != null || latency.audioMs != null || latency.lipSyncMs != null || latency.active;
  const hasServerData =
    serverLatency.llm_first_token_ms !== null || serverLatency.total_ms !== null;

  if (!hasClientData && !hasServerData) return null;

  const totalMs = serverLatency.total_ms;
  const totalColor = latencyColor(totalMs);

  return (
    <div
      className="pointer-events-none absolute left-3 top-3 z-10 rounded-xl border border-border px-3 py-2 text-[10px]"
      style={{
        background: "rgb(var(--c-surface) / 0.92)",
        backdropFilter: "blur(10px)",
        minWidth: 170,
      }}
    >
      {/* Server latency section (most accurate) */}
      {hasServerData && (
        <>
          <div
            className="mb-1 font-semibold uppercase tracking-wide"
            style={{ color: "rgb(var(--c-accent))", fontSize: 9 }}
          >
            Server Pipeline
          </div>
          <Row label="LLM first token" ms={serverLatency.llm_first_token_ms} />
          <Row label="TTS start" ms={serverLatency.tts_start_ms} />
          <Row label="Visible lip sync" ms={latency.lipSyncMs} />
          <div
            className="mt-1.5 flex items-center justify-between gap-3 rounded-md px-1.5 py-1"
            style={{ background: `${totalColor}15`, border: `1px solid ${totalColor}40` }}
          >
            <span className="font-semibold" style={{ color: totalColor }}>
              Total
            </span>
            <span
              className="font-mono tabular-nums font-bold"
              style={{ color: totalColor, fontSize: 11 }}
            >
              {totalMs !== null ? `${totalMs} ms` : "—"}
            </span>
          </div>
        </>
      )}

      {/* Client latency section (fallback when no server data yet) */}
      {!hasServerData && hasClientData && (
        <>
          <div
            className="mb-1 font-semibold uppercase tracking-wide"
            style={{ color: "rgb(var(--c-accent2))", fontSize: 9 }}
          >
            Client-side
          </div>
          <Row label="LLM first text" ms={latency.llmMs} />
          <Row label="First audio chunk" ms={latency.audioMs} />
          <Row label="First lip sync" ms={latency.lipSyncMs} />
        </>
      )}
    </div>
  );
}
