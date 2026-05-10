import { useEffect, useRef } from "react";

interface Props {
  voltage: number;
  current: number;
  running: boolean;
}

interface Sample {
  t: number;
  v: number;
  i: number;
}

export function LiveChart({ voltage, current, running }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const samples = useRef<Sample[]>([]);
  const latest = useRef({ v: voltage, i: current });

  useEffect(() => {
    latest.current = { v: voltage, i: current };
  }, [voltage, current]);

  useEffect(() => {
    if (!running) {
      samples.current = [];
      return;
    }
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
        const w = c.clientWidth,
          h = c.clientHeight;
        if (c.width !== w * dpr || c.height !== h * dpr) {
          c.width = w * dpr;
          c.height = h * dpr;
        }
        const ctx = c.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const plot = {
          left: 42,
          right: Math.max(58, w - 42),
          top: 16,
          bottom: Math.max(40, h - 24),
        };
        const plotW = Math.max(1, plot.right - plot.left);
        const plotH = Math.max(1, plot.bottom - plot.top);
        const arr = samples.current;
        const values = arr.length
          ? arr
          : [{ t: Date.now(), v: latest.current.v, i: latest.current.i }];
        const vScale = niceScale(Math.max(...values.map((s) => s.v), latest.current.v));
        const iScale = niceScale(Math.max(...values.map((s) => s.i), latest.current.i));
        const t1 = Date.now();
        const t0 = t1 - 60_000;
        const xFor = (t: number) => plot.left + ((t - t0) / 60_000) * plotW;
        const vYFor = (v: number) => plot.bottom - (v / vScale.max) * plotH;
        const iYFor = (i: number) => plot.bottom - (i / iScale.max) * plotH;
        const vColor = getCss("--voltage");
        const iColor = getCss("--amp");
        const axisColor = getCss("--muted-foreground");

        ctx.font = "10px JetBrains Mono, ui-monospace, monospace";
        ctx.textBaseline = "middle";

        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        for (let x = 0; x <= 6; x++) {
          const gx = plot.left + (x * plotW) / 6;
          ctx.beginPath();
          ctx.moveTo(gx, plot.top);
          ctx.lineTo(gx, plot.bottom);
          ctx.stroke();
        }
        for (let y = 0; y <= 4; y++) {
          const gy = plot.top + (y * plotH) / 4;
          ctx.beginPath();
          ctx.moveTo(plot.left, gy);
          ctx.lineTo(plot.right, gy);
          ctx.stroke();
        }

        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.beginPath();
        ctx.moveTo(plot.left, plot.top);
        ctx.lineTo(plot.left, plot.bottom);
        ctx.lineTo(plot.right, plot.bottom);
        ctx.lineTo(plot.right, plot.top);
        ctx.stroke();

        ctx.fillStyle = axisColor;
        ctx.textAlign = "center";
        ctx.fillText("-60s", plot.left, h - 8);
        ctx.fillText("-30s", plot.left + plotW / 2, h - 8);
        ctx.fillText("now", plot.right, h - 8);

        ctx.textAlign = "left";
        ctx.fillStyle = vColor;
        ctx.fillText("Voltage (V)", 4, 6);
        for (let y = 0; y <= 4; y++) {
          const value = vScale.max - y * vScale.step;
          ctx.fillText(value.toFixed(2), 4, plot.top + (y * plotH) / 4);
        }

        ctx.textAlign = "right";
        ctx.fillStyle = iColor;
        ctx.fillText("Current (A)", w - 4, 6);
        for (let y = 0; y <= 4; y++) {
          const value = iScale.max - y * iScale.step;
          ctx.fillText(value.toFixed(3), w - 4, plot.top + (y * plotH) / 4);
        }

        if (arr.length > 1) {
          ctx.strokeStyle = vColor;
          ctx.lineWidth = 2;
          ctx.beginPath();
          arr.forEach((s, i) => {
            const x = xFor(s.t);
            const y = vYFor(s.v);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();

          ctx.strokeStyle = iColor;
          ctx.lineWidth = 2;
          ctx.beginPath();
          arr.forEach((s, i) => {
            const x = xFor(s.t);
            const y = iYFor(s.i);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        }

        const vMarkerY = vYFor(latest.current.v);
        const iMarkerY = iYFor(latest.current.i);
        const markerOffset = Math.abs(vMarkerY - iMarkerY) < 14 ? 8 : 0;
        drawValueMarker(
          ctx,
          plot.right,
          vMarkerY - markerOffset,
          vColor,
          `${latest.current.v.toFixed(2)} V`,
        );
        drawValueMarker(
          ctx,
          plot.right,
          iMarkerY + markerOffset,
          iColor,
          `${latest.current.i.toFixed(3)} A`,
        );
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative h-40 w-full">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="absolute left-12 top-1 flex gap-3 text-[10px] uppercase tracking-widest">
        <span className="text-voltage">{voltage.toFixed(2)} V</span>
        <span className="text-amp">{current.toFixed(3)} A</span>
      </div>
    </div>
  );
}

function niceScale(value: number) {
  const rawMax = Math.max(value, 0.001);
  const exponent = Math.floor(Math.log10(rawMax));
  const magnitude = 10 ** exponent;
  const normalized = rawMax / magnitude;
  const niceNormalized =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const max = niceNormalized * magnitude;

  return {
    max,
    step: max / 4,
  };
}

function drawValueMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  label: string,
) {
  const safeY = Math.min(Math.max(y, 16), ctx.canvas.clientHeight - 24);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 6, safeY);
  ctx.lineTo(x, safeY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, safeY, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = "10px JetBrains Mono, ui-monospace, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x - 8, safeY);
}

function getCss(name: string) {
  if (typeof window === "undefined") return "#fff";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#fff";
}
