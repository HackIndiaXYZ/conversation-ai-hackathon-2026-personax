import { useEffect, useRef } from "react";

const BARS = 24;

export function SpeakingWaveform({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(buf);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const step = Math.max(1, Math.floor(analyser.frequencyBinCount / BARS));
      for (let i = 0; i < BARS; i++) {
        let v = 0;
        for (let j = 0; j < step; j++) v += buf[i * step + j] ?? 0;
        v /= step * 255;
        const bh = Math.max(2, v * h * 1.15);
        const x = (i / BARS) * w;
        const bw = w / BARS - 1;
        ctx.fillStyle = "rgb(var(--c-accent) / 0.75)";
        ctx.fillRect(x, h - bh, Math.max(1, bw), bh);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  if (!analyser) return null;

  return (
    <div className="px-3 pb-2">
      <canvas ref={canvasRef} width={280} height={40} className="h-10 w-full max-w-[min(100%,280px)] opacity-90" />
    </div>
  );
}
