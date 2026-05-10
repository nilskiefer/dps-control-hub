import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

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

const SAMPLE_INTERVAL_MS = 250;
const MAX_HISTORY_SECONDS = 6 * 60 * 60;
const MIN_WINDOW_MS = 5_000;
const DEFAULT_WINDOW_MS = 60_000;

export function LiveChart({ voltage, current, running }: Props) {
  const latest = useRef({ v: voltage, i: current });
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [windowMs, setWindowMs] = useState(DEFAULT_WINDOW_MS);
  const [autoScale, setAutoScale] = useState(true);
  const [manualVoltageMax, setManualVoltageMax] = useState(30);
  const [manualCurrentMax, setManualCurrentMax] = useState(5);
  const [now, setNow] = useState(Date.now());
  const [followLive, setFollowLive] = useState(true);
  const [viewOffsetMs, setViewOffsetMs] = useState(0);

  useEffect(() => {
    latest.current = { v: voltage, i: current };
  }, [voltage, current]);

  useEffect(() => {
    if (!running) return;

    const id = window.setInterval(() => {
      const now = Date.now();
      const cutoff = now - MAX_HISTORY_SECONDS * 1000;
      setSamples((prev) => [
        ...prev.filter((sample) => sample.t >= cutoff),
        { t: now, v: latest.current.v, i: latest.current.i },
      ]);
    }, SAMPLE_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(id);
  }, [running]);

  const historyBounds = useMemo(() => {
    const end = running ? now : (samples.at(-1)?.t ?? now);
    const start = samples[0]?.t ?? end - windowMs;
    const span = Math.max(end - start, windowMs);
    const maxOffset = Math.max(0, span - windowMs);

    return { start, end, span, maxOffset };
  }, [samples, windowMs, now, running]);

  useEffect(() => {
    if (followLive) {
      setViewOffsetMs(historyBounds.maxOffset);
      return;
    }

    setViewOffsetMs((value) => Math.min(value, historyBounds.maxOffset));
  }, [followLive, historyBounds.maxOffset]);

  const xDomain = useMemo(() => {
    const start = historyBounds.start + viewOffsetMs;
    return [start, start + windowMs] as [number, number];
  }, [historyBounds.start, viewOffsetMs, windowMs]);

  const chartData = useMemo(() => {
    const visible = samples.filter((sample) => sample.t >= xDomain[0] && sample.t <= xDomain[1]);

    if (visible.length > 0) return visible;

    return [{ t: xDomain[1], v: latest.current.v, i: latest.current.i }];
  }, [samples, xDomain, voltage, current]);

  const voltageDomain = autoScale ? ([0, "auto"] as const) : ([0, manualVoltageMax] as const);
  const currentDomain = autoScale ? ([0, "auto"] as const) : ([0, manualCurrentMax] as const);
  const selectionLeft = (viewOffsetMs / historyBounds.span) * 100;
  const selectionWidth = (windowMs / historyBounds.span) * 100;

  const jumpLive = () => {
    setFollowLive(true);
    setViewOffsetMs(historyBounds.maxOffset);
  };

  const dragTimeline = (mode: "left" | "right" | "move", event: React.PointerEvent) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return;

    event.preventDefault();
    event.stopPropagation();
    setFollowLive(false);

    const startX = event.clientX;
    const startOffset = viewOffsetMs;
    const startWindow = windowMs;
    const historySpan = historyBounds.span;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaMs = ((moveEvent.clientX - startX) / rect.width) * historySpan;

      if (mode === "move") {
        setViewOffsetMs(clamp(startOffset + deltaMs, 0, Math.max(0, historySpan - startWindow)));
        return;
      }

      if (mode === "left") {
        const fixedEnd = startOffset + startWindow;
        const nextOffset = clamp(startOffset + deltaMs, 0, fixedEnd - MIN_WINDOW_MS);
        setViewOffsetMs(nextOffset);
        setWindowMs(clamp(fixedEnd - nextOffset, MIN_WINDOW_MS, historySpan - nextOffset));
        return;
      }

      const nextWindow = clamp(startWindow + deltaMs, MIN_WINDOW_MS, historySpan - startOffset);
      setWindowMs(nextWindow);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const jumpTimeline = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;

    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return;

    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const targetTime = historyBounds.start + ratio * historyBounds.span;
    setFollowLive(false);
    setViewOffsetMs(clamp(targetTime - historyBounds.start - windowMs / 2, 0, historyBounds.maxOffset));
  };

  return (
    <section className="rounded-md border border-border bg-background/40 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-3 text-xs font-mono">
          <span className="text-muted-foreground">{formatWindowLabel(xDomain, now)}</span>
          <span className="text-voltage">{voltage.toFixed(2)} V</span>
          <span className="text-amp">{current.toFixed(3)} A</span>
        </div>

        <label className="flex h-8 items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <input
            type="checkbox"
            checked={autoScale}
            onChange={(event) => setAutoScale(event.target.checked)}
          />
          Auto Scale
        </label>

        {!autoScale && (
          <>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Voltage Max
              <input
                className="h-8 w-24 rounded-md border border-border bg-secondary px-2 text-xs font-mono text-foreground"
                type="number"
                min={0.01}
                step={0.1}
                value={manualVoltageMax}
                onChange={(event) =>
                  setManualVoltageMax(clamp(Number(event.target.value) || 30, 0.01, 999))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Current Max
              <input
                className="h-8 w-24 rounded-md border border-border bg-secondary px-2 text-xs font-mono text-foreground"
                type="number"
                min={0.001}
                step={0.1}
                value={manualCurrentMax}
                onChange={(event) =>
                  setManualCurrentMax(clamp(Number(event.target.value) || 5, 0.001, 999))
                }
              />
            </label>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="h-8 rounded-md border border-border bg-secondary px-3 text-xs font-mono text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            onClick={() => exportVisibleJson(chartData, xDomain)}
            disabled={chartData.length === 0}
          >
            Export Visible JSON
          </button>
          <button
            type="button"
            onClick={jumpLive}
            className={cn(
              "h-8 rounded-md border px-3 text-xs font-mono uppercase tracking-[0.14em] transition-colors",
              "inline-flex items-center gap-2",
              followLive
                ? "border-destructive/60 bg-destructive/10 text-destructive"
                : "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "size-2.5 rounded-full",
                followLive
                  ? "bg-destructive shadow-[0_0_12px_var(--destructive)]"
                  : "bg-muted-foreground/50",
              )}
            />
            Live
          </button>
        </div>
      </div>

      <div className="h-64 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 18, bottom: 16, left: 8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="t"
              type="number"
              domain={xDomain}
              tickFormatter={(value) => formatRelativeTime(Number(value), xDomain[1])}
              stroke="var(--muted-foreground)"
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickLine={{ stroke: "var(--border)" }}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={24}
            />
            <YAxis
              yAxisId="voltage"
              domain={voltageDomain}
              tickFormatter={(value) => `${Number(value).toFixed(2)} V`}
              stroke="var(--voltage)"
              tick={{ fill: "var(--voltage)", fontSize: 11 }}
              tickLine={{ stroke: "var(--border)" }}
              axisLine={{ stroke: "var(--border)" }}
              width={62}
            />
            <YAxis
              yAxisId="current"
              orientation="right"
              domain={currentDomain}
              tickFormatter={(value) => `${Number(value).toFixed(3)} A`}
              stroke="var(--amp)"
              tick={{ fill: "var(--amp)", fontSize: 11 }}
              tickLine={{ stroke: "var(--border)" }}
              axisLine={{ stroke: "var(--border)" }}
              width={66}
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--popover-foreground)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
              labelFormatter={(value) => new Date(Number(value)).toLocaleTimeString()}
              formatter={(value, name) => [
                name === "Voltage"
                  ? `${Number(value).toFixed(2)} V`
                  : `${Number(value).toFixed(3)} A`,
                name,
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: "var(--font-mono)" }} />
            <Line
              yAxisId="voltage"
              type="monotone"
              dataKey="v"
              name="Voltage"
              stroke="var(--voltage)"
              strokeWidth={2}
              dot={false}
              isAnimationActive
              animationDuration={220}
              animationEasing="ease-out"
            />
            <Line
              yAxisId="current"
              type="monotone"
              dataKey="i"
              name="Current"
              stroke="var(--amp)"
              strokeWidth={2}
              dot={false}
              isAnimationActive
              animationDuration={220}
              animationEasing="ease-out"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3">
        <div
          ref={timelineRef}
          className="relative h-12 cursor-pointer rounded-md border border-border bg-secondary/50"
          onPointerDown={jumpTimeline}
        >
          <div className="pointer-events-none absolute inset-x-2 top-2 h-1 rounded-full bg-border" />
          <div className="pointer-events-none absolute bottom-1 left-2 right-2 flex justify-between text-[10px] font-mono text-muted-foreground">
            <span>{new Date(historyBounds.start).toLocaleTimeString()}</span>
            <span>{formatDuration(windowMs)}</span>
            <span>{followLive ? "live" : new Date(xDomain[1]).toLocaleTimeString()}</span>
          </div>
          <div
            className="absolute top-2 h-6 cursor-grab rounded-md border border-primary/60 bg-primary/20 shadow-[0_0_18px_-8px_var(--primary)] active:cursor-grabbing"
            style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }}
            onPointerDown={(event) => dragTimeline("move", event)}
          >
            <div
              className="absolute -left-1 top-0 h-full w-3 cursor-ew-resize rounded-l-md border-l-2 border-primary bg-primary/35"
              onPointerDown={(event) => dragTimeline("left", event)}
            />
            <div
              className="absolute -right-1 top-0 h-full w-3 cursor-ew-resize rounded-r-md border-r-2 border-primary bg-primary/35"
              onPointerDown={(event) => dragTimeline("right", event)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatRelativeTime(value: number, now: number) {
  const seconds = Math.round((value - now) / 1000);
  return seconds === 0 ? "now" : `${seconds}s`;
}

function formatWindowLabel(domain: [number, number], now: number) {
  const secondsBehind = Math.max(0, Math.round((now - domain[1]) / 1000));
  const start = new Date(domain[0]).toLocaleTimeString();
  const end = new Date(domain[1]).toLocaleTimeString();

  return secondsBehind <= 1 ? `${start} - live` : `${start} - ${end}`;
}

function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function exportVisibleJson(samples: Sample[], domain: [number, number]) {
  const body = JSON.stringify(
    {
      visibleWindow: {
        start: new Date(domain[0]).toISOString(),
        end: new Date(domain[1]).toISOString(),
        durationMs: domain[1] - domain[0],
      },
      samples: samples.map((sample) => ({
        timestamp: new Date(sample.t).toISOString(),
        timeMs: sample.t,
        voltage: Number(sample.v.toFixed(4)),
        current: Number(sample.i.toFixed(5)),
      })),
    },
    null,
    2,
  );
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dps150-visible-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
