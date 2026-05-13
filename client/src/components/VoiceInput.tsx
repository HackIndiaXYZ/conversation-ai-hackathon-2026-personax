interface VoiceInputProps {
  partialTranscript: string;
  listening: boolean;
  mode: string;
  onTapToSpeak: () => void;
  tapBusy?: boolean;
}

export function VoiceInput({
  partialTranscript,
  listening,
  mode,
  onTapToSpeak,
  tapBusy,
}: VoiceInputProps) {
  const isWebSpeech = mode === "webspeech";
  const isServerStt = mode === "server_stt";

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={["chip", listening ? "text-fg" : "text-muted"].join(" ")}
          style={
            listening
              ? { background: "rgb(var(--c-success) / 0.14)", borderColor: "rgb(var(--c-success) / 0.35)" }
              : undefined
          }
        >
          <span
            className={["h-2 w-2 rounded-full", listening ? "animate-pulse" : ""].join(" ")}
            style={{ background: listening ? "rgb(var(--c-success))" : "rgb(var(--c-subtle))" }}
          />
          {listening ? "Listening" : "Mic idle"}
        </span>

        <span className="kicker">
          {isWebSpeech
            ? "MODE: Hands-free · waits for a fuller question"
            : isServerStt
              ? "MODE: Speech capture · brief pause or press Send"
              : `MODE: ${mode}`}
        </span>

        {isServerStt && (
          <button
            type="button"
            onClick={onTapToSpeak}
            disabled={!!tapBusy}
            title="Send whatever you've spoken so far"
            className="btn ml-auto px-4 py-2 text-sm"
          >
            Send now
          </button>
        )}
      </div>

      <p className="mt-3 min-h-[3rem] text-sm leading-relaxed text-fg">
        {partialTranscript ? (
          <span className="italic" style={{ color: "rgb(var(--c-accent2))" }}>
            &ldquo;{partialTranscript}&rdquo;
          </span>
        ) : (
          <span className="text-muted">
            {isWebSpeech
              ? "Speak naturally - your full question should be captured before sending."
              : "Speak, then pause briefly or press Send now..."}
          </span>
        )}
      </p>
    </div>
  );
}
