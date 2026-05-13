# Hackathon demo script (lip-sync)

Use this as a repeatable 45–90s run to show **tight audio↔mouth sync** and robustness.

## Setup
- Pick any persona (recommended: `dr_chen`).
- Ensure the status line shows **Lip-sync: alignment** (not fallback).
- Toggle **Show lip-sync diagnostics** so judges can see `viseme`, `source`, and `playbackLatency`.

## Scripted user prompts (copy/paste)

### Prompt 1 (plosives + pacing)
> Good morning doctor. Before we start, can you repeat: “BP, BMI, and BPH”? Then summarize today’s goals in one sentence.

### Prompt 2 (fricatives + numbers)
> Please say: “Fifty-five patients saw a significant shift.” Now list three key efficacy numbers: 5%, 15%, and 25%.

### Prompt 3 (mixed consonants + acronyms)
> Can you explain the difference between SSRI and SNRI in simple terms, and then say “CH, TH, and KK” clearly?

### Prompt 4 (hard pharma-style names)
> Please read this out loud naturally: “rosuvastatin, empagliflozin, and pembrolizumab.” Then tell me which one is most relevant to cardiology.

## What to point out (judge-friendly)
- **Real-time sync**: viseme keyframes are derived from the same WAV the browser plays.\n+- **Low jitter**: client schedules visemes at the actual playback start time.\n+- **Graceful fallback**: if TTS is unavailable, the app still animates the mouth with text-based visemes (and can speak via Web Speech).

