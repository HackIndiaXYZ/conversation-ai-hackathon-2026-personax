import type { Persona } from "../types";

interface PersonaSelectorProps {
  personas: Persona[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

type MoodKey = "neutral" | "engaged" | "skeptical" | "concerned" | "positive";

const MOOD_CONFIG: Record<MoodKey, { label: string; bg: string; color: string; border: string }> = {
  neutral: {
    label: "Neutral",
    bg: "rgba(148,163,184,0.13)",
    color: "#94a3b8",
    border: "rgba(148,163,184,0.3)",
  },
  engaged: {
    label: "Engaged",
    bg: "rgba(34,197,94,0.12)",
    color: "#22c55e",
    border: "rgba(34,197,94,0.3)",
  },
  skeptical: {
    label: "Skeptical",
    bg: "rgba(245,158,11,0.12)",
    color: "#f59e0b",
    border: "rgba(245,158,11,0.3)",
  },
  concerned: {
    label: "Concerned",
    bg: "rgba(239,68,68,0.12)",
    color: "#ef4444",
    border: "rgba(239,68,68,0.3)",
  },
  positive: {
    label: "Positive",
    bg: "rgba(168,85,247,0.12)",
    color: "#a855f7",
    border: "rgba(168,85,247,0.3)",
  },
};

function MoodBadge({ mood }: { mood: string }) {
  const cfg = MOOD_CONFIG[mood as MoodKey] ?? MOOD_CONFIG.neutral;
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: 4,
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {cfg.label}
    </span>
  );
}

function GenderIcon({ gender }: { gender?: "female" | "male" }) {
  if (!gender) return null;
  return (
    <span style={{ fontSize: 14, opacity: 0.6 }}>
      {gender === "female" ? "👩‍⚕️" : "👨‍⚕️"}
    </span>
  );
}

export function PersonaSelector({ personas, selectedId, onSelect, disabled }: PersonaSelectorProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {personas.map((p) => {
        const active = p.id === selectedId;
        const mood = (p.moodBaseline ?? p.mood ?? "neutral") as MoodKey;
        const moodCfg = MOOD_CONFIG[mood] ?? MOOD_CONFIG.neutral;

        return (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(p.id)}
            className={[
              "rounded-2xl border p-4 text-left transition",
              active
                ? "border-accent/60 bg-surface2/85"
                : "border-border bg-surface/70 hover:bg-surface2/70",
              disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            ].join(" ")}
            style={
              active
                ? {
                    boxShadow: `0 0 0 1px ${moodCfg.color}30, 0 0 16px ${moodCfg.color}10`,
                  }
                : undefined
            }
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <GenderIcon gender={p.gender} />
                <div className="min-w-0">
                  <p className="font-display text-base font-semibold text-fg truncate">{p.name}</p>
                  <p className="mt-0.5 text-xs font-medium" style={{ color: "rgb(var(--c-accent2))" }}>
                    {p.specialty}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <MoodBadge mood={mood} />
                {active && (
                  <span
                    className="chip"
                    style={{
                      fontSize: 9,
                      borderColor: "transparent",
                      background: "rgb(var(--c-accent) / 0.14)",
                      color: "rgb(var(--c-accent))",
                    }}
                  >
                    Selected
                  </span>
                )}
                {p.complianceMode ? (
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: "0.07em",
                      textTransform: "uppercase",
                      padding: "1px 5px",
                      borderRadius: 3,
                      background: "rgba(34,197,94,0.10)",
                      color: "#22c55e",
                      border: "1px solid rgba(34,197,94,0.25)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    MLR-Safe
                  </span>
                ) : null}
              </div>
            </div>

            {/* Hospital */}
            <p className="mt-2 line-clamp-1 text-xs text-muted">{p.hospital}</p>

            {/* Personality */}
            <p className="mt-1 line-clamp-2 text-xs italic text-muted/80">{p.personality}</p>

            {/* Mood bar accent */}
            <div
              className="mt-3 h-0.5 w-full rounded-full opacity-40"
              style={{ background: moodCfg.color }}
            />
          </button>
        );
      })}
    </div>
  );
}
