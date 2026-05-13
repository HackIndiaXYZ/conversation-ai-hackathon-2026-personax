import type { Message } from "../types";
import type { ReactNode } from "react";

interface TranscriptProps {
  open: boolean;
  onToggle: () => void;
  messages: Message[];
  streamingAssistant: string;
  liveUserTranscript?: string;
  footer?: ReactNode;
}

export function Transcript({
  open,
  onToggle,
  messages,
  streamingAssistant,
  liveUserTranscript,
  footer,
}: TranscriptProps) {
  return (
    <aside
      className={[
        "flex flex-col bg-surface/55 transition-[width] duration-200",
        open ? "w-full border-t border-border md:w-80 md:border-l md:border-t-0" : "w-0 overflow-hidden border-0",
      ].join(" ")}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="kicker">Call Log</span>
        <button
          type="button"
          onClick={onToggle}
          className="btn px-2 py-1 text-xs"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {messages.map((m, i) => (
          <div
            key={`${m.timestamp}-${i}`}
            className={m.role === "user" ? "text-right" : "text-left"}
          >
            <div
              className={[
                "inline-block max-w-[95%] rounded-2xl px-3 py-2",
                m.role === "user"
                  ? "border border-border"
                  : "border border-border bg-surface2/75",
              ].join(" ")}
              style={
                m.role === "user"
                  ? { background: "linear-gradient(115deg, rgb(var(--c-accent) / 0.16), rgb(var(--c-accent2) / 0.10))" }
                  : undefined
              }
            >
              <p className="kicker">
                {m.role === "user" ? "You" : m.emotion ? `Physician · ${m.emotion}` : "Physician"}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}
        {streamingAssistant ? (
          <div className="text-left">
            <div className="inline-block max-w-[95%] rounded-2xl border border-border bg-surface2/60 px-3 py-2 italic text-fg">
              <p className="kicker">Physician · speaking</p>
              <p className="mt-1 whitespace-pre-wrap">{streamingAssistant}</p>
            </div>
          </div>
        ) : null}
        {liveUserTranscript?.trim() ? (
          <div className="text-right">
            <div
              className="inline-block max-w-[95%] rounded-2xl border border-border px-3 py-2 italic"
              style={{ background: "linear-gradient(115deg, rgb(var(--c-accent) / 0.16), rgb(var(--c-accent2) / 0.10))" }}
            >
              <p className="kicker">You · speaking</p>
              <p className="mt-1 whitespace-pre-wrap">{liveUserTranscript}</p>
            </div>
          </div>
        ) : null}
      </div>
      {footer}
    </aside>
  );
}
