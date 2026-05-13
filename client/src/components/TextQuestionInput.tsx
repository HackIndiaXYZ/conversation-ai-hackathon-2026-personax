import { useCallback, useState } from "react";

interface TextQuestionInputProps {
  onSend: (text: string) => void;
  /** When true, input and send are disabled (e.g. WebSocket disconnected). */
  disabled?: boolean;
}

/**
 * Typed fallback when speech-to-text is unavailable or unreliable.
 * Same pipeline as voice: append to transcript + WebSocket `user_input`.
 */
export function TextQuestionInput({ onSend, disabled }: TextQuestionInputProps) {
  const [draft, setDraft] = useState("");

  const submit = useCallback(() => {
    const t = draft.trim();
    if (!t || disabled) return;
    onSend(t);
    setDraft("");
  }, [draft, disabled, onSend]);

  return (
    <div className="panel p-4">
      <p className="kicker mb-2">Type your message</p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={disabled}
        rows={3}
        placeholder="Write your question or reply… (Enter to send, Shift+Enter for new line)"
        className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[rgb(var(--c-accent)/0.45)] disabled:opacity-50"
        aria-label="Typed message to the simulated physician"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {disabled ? (
          <p className="text-xs text-muted">Waiting for WebSocket connection…</p>
        ) : (
          <span className="text-xs text-muted">Enter sends · Shift+Enter newline</span>
        )}
        <button type="button" onClick={submit} disabled={disabled || !draft.trim()} className="btn px-4 py-2 text-sm">
          Send
        </button>
      </div>
    </div>
  );
}
