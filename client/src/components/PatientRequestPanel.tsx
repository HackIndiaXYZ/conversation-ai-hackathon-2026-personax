interface PatientRequestPanelProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const EXAMPLES = [
  "Elderly patient is anxious about side effects and wants reassurance before starting therapy.",
  "Patient is cost-sensitive, misses doses often, and needs a simpler treatment routine.",
  "Caregiver is worried because the patient had a serious infection on prior therapy.",
];

export function PatientRequestPanel({ value, onChange, disabled }: PatientRequestPanelProps) {
  return (
    <div className="panel p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="kicker">Patient Situation Tool</p>
          <p className="text-xs text-muted">
            Adds patient context so the physician replies with realistic emotion and bedside nuance.
          </p>
        </div>
        {value.trim() ? <span className="chip text-xs">Context active</span> : null}
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={4}
        placeholder="Describe the patient request, concern, emotion, constraints, or clinical situation..."
        className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[rgb(var(--c-accent)/0.45)] disabled:opacity-60"
        aria-label="Patient request or situation context"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((example, index) => (
          <button
            key={example}
            type="button"
            disabled={disabled}
            onClick={() => onChange(example)}
            className="btn px-3 py-1.5 text-xs"
          >
            Use scenario {index + 1}
          </button>
        ))}
        {value.trim() ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange("")}
            className="btn px-3 py-1.5 text-xs"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
