import { useSessionStore } from "../store/sessionStore";

const severityStyles = {
  low: { label: "Low", color: "#38bdf8", border: "rgba(56, 189, 248, 0.35)", bg: "rgba(56, 189, 248, 0.12)" },
  medium: { label: "Medium", color: "#f59e0b", border: "rgba(245, 158, 11, 0.35)", bg: "rgba(245, 158, 11, 0.12)" },
  high: { label: "High", color: "#ef4444", border: "rgba(239, 68, 68, 0.35)", bg: "rgba(239, 68, 68, 0.12)" },
} as const;

export function ComplianceMonitor() {
  const complianceEvents = useSessionStore((s) => s.complianceEvents);

  return (
    <div className="border-t border-border px-3 py-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="kicker">Compliance Monitor</span>
        <span className="text-[11px] text-muted">
          {complianceEvents.length > 0 ? `${complianceEvents.length} live flag${complianceEvents.length === 1 ? "" : "s"}` : "No flags"}
        </span>
      </div>

      {complianceEvents.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface2/45 px-3 py-3 text-sm text-muted">
          No compliance concerns flagged yet. Benefit claims and risky phrasing will appear here in real time.
        </div>
      ) : (
        <div className="max-h-72 space-y-3 overflow-y-auto pr-1 text-sm">
          {complianceEvents.map((event) => {
            const severity = severityStyles[event.severity];
            return (
              <div
                key={event.id}
                className="rounded-2xl border px-3 py-3"
                style={{ borderColor: severity.border, background: severity.bg }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-medium text-fg">{event.title}</p>
                  <span
                    className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
                    style={{ borderColor: severity.border, color: severity.color }}
                  >
                    {severity.label}
                  </span>
                </div>
                <p className="mb-2 text-xs text-muted">"{event.excerpt}"</p>
                <p className="text-xs text-fg/85">{event.rationale}</p>
                <p className="mt-2 text-xs text-fg/85">
                  Coaching: {event.suggestion}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
