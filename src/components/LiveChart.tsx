import { useEffect, useRef } from "react";

interface Props {
  voltage: number;
  current: number;
  running: boolean;
  vMax: number;
  iMax: number;
}

interface Sample { t: number; v: number; i: number }

export function LiveChart({ voltage, current, running, vMax, iMax }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const samples = useRef<Sample[]>([]);
  const latest = useRef({ v: voltage, i: current });

  useEffect(() => { latest.current = { v: voltage, i: current }; }, [voltage, current]);

  useEffect(() => {
    if (!running) { samples.current = []; return; }
    const id = setInterval(() => {
      samples.current.push({ t: Date.now(), v: latest.current.v, i: latest.current.i });
      const cutoff = Date.now() - 60_000;
      while (samples.current.length && samples.current[0].t < cutoff) samples.current.shift();
    }, 250);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = canvasRef.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth, h = c.clientHeight;
        if (c.width !== w * dpr || c.height !== h * dpr) {
          c.width = w * dpr; c.height = h * dpr;
        }
        const ctx = c.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // grid
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineWidth = 1;
        for (let x = 0; x <= 6; x++) {
          ctx.beginPath();
          ctx.moveTo((x * w) / 6, 0);
          ctx.lineTo((x * w) / 6, h);
          ctx.stroke();
        }
        for (let y = 0; y <= 4; y++) {
          ctx.beginPath();
          ctx.moveTo(0, (y * h) / 4);
          ctx.lineTo(w, (y * h) / 4);
          ctx.stroke();
        }

        const arr = samples.current;
        if (arr.length > 1) {
          const t1 = Date.now();
          const t0 = t1 - 60_000;
          const xFor = (t: number) => ((t - t0) / 60_000) * w;

          const vColor = getCss("--voltage");
          const iColor = getCss("--amp");

          // voltage line
          ctx.strokeStyle = vColor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          arr.forEach((s, i) => {
            const x = xFor(s.t);
            const y = h - (s.v / Math.max(vMax, 0.1)) * h;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.stroke();

          // current line
          ctx.strokeStyle = iColor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          arr.forEach((s, i) => {
            const x = xFor(s.t);
            const y = h - (s.i / Math.max(iMax, 0.1)) * h;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [vMax, iMax]);

  return (
    <div className="relative h-40 w-full">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="absolute left-2 top-2 flex gap-3 text-[10px] uppercase tracking-widest">
        <span className="text-voltage">— V</span>
        <span className="text-amp">— A</span>
      </div>
      <div className="absolute right-2 top-2 text-[10px] text-muted-foreground">60s</div>
    </div>
  );
}

function getCss(name: string) {
  if (typeof window === "undefined") return "#fff";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#fff";
}
