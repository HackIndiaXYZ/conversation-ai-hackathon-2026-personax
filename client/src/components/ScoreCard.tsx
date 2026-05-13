import type { ScoreCard as ScoreCardType, ScoreItemStatus } from "../types";

interface ScoreCardProps {
  scoreCard: ScoreCardType;
  personaName: string;
  onClose: () => void;
}

function statusIcon(status: ScoreItemStatus): { icon: string; color: string } {
  switch (status) {
    case "pass": return { icon: "✅", color: "rgb(var(--c-accent))" };
    case "warn": return { icon: "⚠️", color: "#f59e0b" };
    case "fail": return { icon: "❌", color: "#ef4444" };
  }
}

function readinessColor(readiness: string): string {
  switch (readiness) {
    case "Field Ready":    return "#22c55e";
    case "Almost Ready":  return "#f59e0b";
    case "Needs Practice": return "#f97316";
    case "Not Ready":     return "#ef4444";
    default:              return "rgb(var(--c-accent))";
  }
}

function ScoreRing({ score }: { score: number }) {
  const r = 48;
  const circ = 2 * Math.PI * r;
  const filled = circ * (score / 100);
  const scoreColor =
    score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : score >= 40 ? "#f97316" : "#ef4444";

  return (
    <div style={{ position: "relative", width: 120, height: 120 }}>
      <svg width={120} height={120} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={60} cy={60} r={r}
          stroke="rgba(255,255,255,0.08)" strokeWidth={10} fill="none"
        />
        <circle
          cx={60} cy={60} r={r}
          stroke={scoreColor} strokeWidth={10} fill="none"
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: scoreColor }}>{score}</span>
        <span style={{ fontSize: 11, color: "rgb(var(--c-muted))", letterSpacing: "0.05em" }}>/ 100</span>
      </div>
    </div>
  );
}

export function ScoreCard({ scoreCard, personaName, onClose }: ScoreCardProps) {
  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
      }}
    >
      {/* Modal — stop click propagation so clicking inside doesn't close */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480,
          background: "rgb(var(--c-surface2))",
          border: "1px solid rgb(var(--c-border))",
          borderRadius: "1.25rem",
          padding: "1.75rem",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column", gap: "1.25rem",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgb(var(--c-muted))", marginBottom: 4 }}>
              Call Debrief
            </p>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, color: "rgb(var(--c-fg))", margin: 0 }}>
              Practice Call with {personaName}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "rgb(var(--c-muted))", fontSize: 20, lineHeight: 1, padding: "2px 6px",
              flexShrink: 0,
            }}
            aria-label="Close scorecard"
          >
            ✕
          </button>
        </div>

        {/* Score + Readiness */}
        <div style={{
          display: "flex", alignItems: "center", gap: "1.5rem",
          background: "rgb(var(--c-surface) / 0.6)",
          borderRadius: "0.875rem", padding: "1rem 1.25rem",
        }}>
          <ScoreRing score={scoreCard.score} />
          <div>
            <p style={{ fontSize: 12, color: "rgb(var(--c-muted))", marginBottom: 4 }}>READINESS LEVEL</p>
            <p style={{
              fontSize: "1.1rem", fontWeight: 700,
              color: readinessColor(scoreCard.readiness),
              marginBottom: 6,
            }}>
              {scoreCard.readiness}
            </p>
            <p style={{ fontSize: 13, color: "rgb(var(--c-muted))", fontStyle: "italic", lineHeight: 1.5 }}>
              {scoreCard.summary}
            </p>
          </div>
        </div>

        {/* Checklist */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgb(var(--c-muted))", marginBottom: 4 }}>
            Evaluation Criteria
          </p>
          {scoreCard.items.map((item, i) => {
            const { icon, color } = statusIcon(item.status);
            return (
              <div
                key={i}
                style={{
                  display: "flex", alignItems: "center", gap: "0.625rem",
                  padding: "0.5rem 0.75rem",
                  background: "rgb(var(--c-surface) / 0.5)",
                  borderRadius: "0.5rem",
                  border: "1px solid rgb(var(--c-border))",
                }}
              >
                <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
                <span style={{ fontSize: 13, color: "rgb(var(--c-fg))", flex: 1 }}>{item.label}</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                  color, letterSpacing: "0.06em",
                }}>
                  {item.status}
                </span>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <button
          onClick={onClose}
          className="btn-primary"
          style={{ width: "100%", padding: "0.625rem", fontSize: 14, fontWeight: 600 }}
        >
          Practice Again
        </button>
      </div>
    </div>
  );
}
