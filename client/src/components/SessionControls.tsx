interface SessionControlsProps {
  active: boolean;
  elapsedSec: number;
  canStart: boolean;
  generatingDebrief?: boolean;
  onStart: () => void;
  onEnd: () => void;
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SessionControls({ active, elapsedSec, canStart, generatingDebrief = false, onStart, onEnd }: SessionControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="rounded-xl border border-border bg-surface2/70 px-4 py-2 font-mono text-sm text-fg">
        Call {active ? formatTime(elapsedSec) : "—:—"}
      </div>
      {!active ? (
        <>
          {generatingDebrief ? (
            <div className="rounded-xl border border-border bg-surface2/70 px-4 py-2 text-sm text-fg">
              Generating debrief...
            </div>
          ) : null}
          <button
            type="button"
            disabled={!canStart || generatingDebrief}
            onClick={onStart}
            className="btn-primary px-6 py-2.5 text-sm"
          >
            {generatingDebrief ? "Finishing Call..." : "Begin Practice Call"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={onEnd}
          className="btn-danger px-6 py-2.5 text-sm"
        >
          End Call
        </button>
      )}
    </div>
  );
}
