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
  readbackActive: boolean;
}

interface Sample {
  t: number;
  v: number;
  i: number;
}

const SAMPLE_INTERVAL_MS = 250;
const MAX_HISTORY_SECONDS = 6 * 60 * 60;
const DEFAULT_WINDOW_MS = 60_000;
const MIN_WINDOW_MS = 5_000;
const MAX_WINDOW_MS = MAX_HISTORY_SECONDS * 1000;

export function LiveChart({ voltage, current, running, readbackActive }: Props) {
  const latest = useRef({ v: voltage, i: current });
  const chartFrameRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ x: number; domain: [number, number] } | null>(null);
  const scrollPanRef = useRef<{ x: number; start: number; trackWidth: number } | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [autoScale, setAutoScale] = useState(true);
  const [manualVoltageMax, setManualVoltageMax] = useState(30);
  const [manualCurrentMax, setManualCurrentMax] = useState(5);
  const [followLive, setFollowLive] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [domain, setDomain] = useState<[number, number]>(() => {
    const now = Date.now();
    return [now - DEFAULT_WINDOW_MS, now];
  });

  useEffect(() => {
    latest.current = { v: voltage, i: current };
  }, [voltage, current]);

  useEffect(() => {
    if (!running || !readbackActive) return;

    const id = window.setInterval(() => {
      const now = Date.now();
      const cutoff = now - MAX_HISTORY_SECONDS * 1000;
      setSamples((prev) => [
        ...prev.filter((sample) => sample.t >= cutoff),
        { t: now, v: latest.current.v, i: latest.current.i },
      ]);
    }, SAMPLE_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [running, readbackActive]);

  useEffect(() => {
    if (!running || !readbackActive) return;
    const id = window.setInterval(() => setNow(Date.now()), SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [running, readbackActive]);

  useEffect(() => {
    const latest = samples.at(-1)?.t ?? now;
    setDomain(([start, end]) => {
      const width = end - start;
      if (followLive) return [latest - width, latest];
      const earliest = samples[0]?.t ?? latest - MAX_WINDOW_MS;
      return clampDomain([start, end], earliest, latest);
    });
  }, [samples, now, followLive]);

  const chartSamples = useMemo(() => {
    if (samples.length > 0) return samples;

    return [{ t: domain[1], v: latest.current.v, i: latest.current.i }];
  }, [samples, voltage, current, domain]);
  const visibleSamples = useMemo(
    () => chartSamples.filter((sample) => sample.t >= domain[0] && sample.t <= domain[1]),
    [chartSamples, domain],
  );
  const scrollBounds = useMemo(() => {
    const earliest = samples[0]?.t ?? domain[0];
    const latest = samples.at(-1)?.t ?? domain[1];
    const width = domain[1] - domain[0];
    const total = Math.max(width, latest - earliest);
    const max = Math.max(0, total - width);
    const value = clamp(domain[0] - earliest, 0, max);

    return { earliest, latest, max, total, value, width };
  }, [samples, domain]);
  const voltageDomain = autoScale ? ([0, "auto"] as const) : ([0, manualVoltageMax] as const);
  const currentDomain = autoScale ? ([0, "auto"] as const) : ([0, manualCurrentMax] as const);

  const panBy = (deltaMs: number) => {
    const earliest = samples[0]?.t ?? domain[0];
    const latest = samples.at(-1)?.t ?? domain[1];
    const next = clampDomain([domain[0] + deltaMs, domain[1] + deltaMs], earliest, latest);
    setDomain(next);
    setFollowLive(next[1] >= latest - SAMPLE_INTERVAL_MS);
  };

  const zoomBy = (factor: number, anchorRatio = 0.5) => {
    const earliest = samples[0]?.t ?? domain[0];
    const latest = samples.at(-1)?.t ?? domain[1];
    const width = clamp((domain[1] - domain[0]) * factor, MIN_WINDOW_MS, MAX_WINDOW_MS);
    const anchor = domain[0] + (domain[1] - domain[0]) * anchorRatio;
    const next: [number, number] = [anchor - width * anchorRatio, anchor + width * (1 - anchorRatio)];
    const clamped = clampDomain(next, earliest, latest);
    setDomain(clamped);
    setFollowLive(clamped[1] >= latest - SAMPLE_INTERVAL_MS);
  };

  useEffect(() => {
    const element = chartFrameRef.current;
    if (!element) return;

    const handleNativeWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      const anchorRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);

      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        zoomBy(event.deltaY > 0 ? 1.18 : 0.84, anchorRatio);
        return;
      }

      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      panBy((delta / Math.max(1, rect.width)) * (domain[1] - domain[0]));
    };

    element.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleNativeWheel);
  }, [domain, samples]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { x: event.clientX, domain };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const deltaMs = ((panRef.current.x - event.clientX) / Math.max(1, rect.width)) * (panRef.current.domain[1] - panRef.current.domain[0]);
    const earliest = samples[0]?.t ?? panRef.current.domain[0];
    const latest = samples.at(-1)?.t ?? panRef.current.domain[1];
    const next = clampDomain(
      [panRef.current.domain[0] + deltaMs, panRef.current.domain[1] + deltaMs],
      earliest,
      latest,
    );
    setDomain(next);
    setFollowLive(next[1] >= latest - SAMPLE_INTERVAL_MS);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    panRef.current = null;
  };

  const jumpLive = () => {
    const latest = samples.at(-1)?.t ?? domain[1];
    const width = domain[1] - domain[0];
    setDomain([latest - width, latest]);
    setFollowLive(true);
  };

  const setScrollbarStart = (start: number) => {
    const width = domain[1] - domain[0];
    const next = clampDomain([start, start + width], scrollBounds.earliest, scrollBounds.latest);
    setDomain(next);
    setFollowLive(next[1] >= scrollBounds.latest - SAMPLE_INTERVAL_MS);
  };

  const handleScrollbarTrackDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    setScrollbarStart(scrollBounds.earliest + ratio * scrollBounds.total - scrollBounds.width / 2);
  };

  const handleScrollbarThumbDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const track = event.currentTarget.parentElement;
    if (!track) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrollPanRef.current = {
      x: event.clientX,
      start: domain[0],
      trackWidth: track.getBoundingClientRect().width,
    };
  };

  const handleScrollbarThumbMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scrollPanRef.current) return;
    const delta =
      ((event.clientX - scrollPanRef.current.x) /
        Math.max(1, scrollPanRef.current.trackWidth)) *
      scrollBounds.total;
    setScrollbarStart(scrollPanRef.current.start + delta);
  };

  const handleScrollbarThumbUp = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    scrollPanRef.current = null;
  };

  const thumbWidthPct = clamp((scrollBounds.width / scrollBounds.total) * 100, 6, 100);
  const thumbLeftPct =
    scrollBounds.max === 0 ? 0 : (scrollBounds.value / scrollBounds.max) * (100 - thumbWidthPct);

  return (
    <section className="rounded-md border border-border bg-background/40 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-3 text-xs font-mono">
          <span className={readbackActive ? "text-muted-foreground" : "text-destructive"}>
            {readbackActive ? formatWindowLabel(domain, followLive) : "readback offline"}
          </span>
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
            onClick={() => exportVisibleJson(visibleSamples, domain)}
            disabled={visibleSamples.length === 0}
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
                ? readbackActive
                  ? "border-destructive/60 bg-destructive/10 text-destructive"
                  : "border-voltage/60 bg-voltage/10 text-voltage"
                : "border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "size-2.5 rounded-full",
                followLive
                  ? readbackActive
                    ? "bg-destructive shadow-[0_0_12px_var(--destructive)]"
                    : "bg-voltage shadow-[0_0_12px_var(--voltage)]"
                  : "bg-muted-foreground/50",
              )}
            />
            {readbackActive ? "Live" : "Estimate"}
          </button>
        </div>
      </div>

      <div
        ref={chartFrameRef}
        className={cn(
          "relative h-64 min-w-0 cursor-grab touch-none active:cursor-grabbing",
          !readbackActive && "rounded-md outline outline-1 outline-voltage/40",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visibleSamples} margin={{ top: 10, right: 18, bottom: 16, left: 8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="t"
              type="number"
              domain={domain}
              tickFormatter={(value) => formatRelativeTime(Number(value), domain[1])}
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
              isAnimationActive={false}
            />
            <Line
              yAxisId="current"
              type="monotone"
              dataKey="i"
              name="Current"
              stroke="var(--amp)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
        {!readbackActive && (
          <div className="pointer-events-none absolute right-3 top-3 max-w-[20rem] rounded-md border border-voltage/50 bg-background/90 px-3 py-2 text-xs text-voltage shadow-lg">
            <div className="font-mono uppercase tracking-[0.16em]">Estimate mode</div>
            <div className="mt-1 text-muted-foreground">
              Readback is offline. The graph is not receiving live telemetry.
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 rounded-md border border-border bg-secondary/40 px-3 py-3">
        <div
          className={cn(
            "relative h-5 rounded-full bg-background/80",
            scrollBounds.max === 0 ? "opacity-40" : "cursor-pointer",
          )}
          onPointerDown={handleScrollbarTrackDown}
        >
          <div
            className="absolute top-1/2 h-4 -translate-y-1/2 cursor-grab rounded-full border border-primary/70 bg-primary/30 shadow-[0_0_18px_-8px_var(--primary)] active:cursor-grabbing"
            style={{ left: `${thumbLeftPct}%`, width: `${thumbWidthPct}%` }}
            onPointerDown={handleScrollbarThumbDown}
            onPointerMove={handleScrollbarThumbMove}
            onPointerUp={handleScrollbarThumbUp}
            onPointerCancel={handleScrollbarThumbUp}
          />
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-mono text-muted-foreground">
        <span>Drag or scroll to pan</span>
        <span>{formatDuration(domain)}</span>
        <span>Shift/ctrl scroll to zoom</span>
      </div>
    </section>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatRelativeTime(value: number, end: number) {
  const seconds = Math.round((value - end) / 1000);
  return seconds === 0 ? "now" : `${seconds}s`;
}

function clampDomain(domain: [number, number], earliest: number, latest: number): [number, number] {
  const width = clamp(domain[1] - domain[0], MIN_WINDOW_MS, MAX_WINDOW_MS);
  if (latest - earliest <= width) return [latest - width, latest];
  const start = clamp(domain[0], earliest, latest - width);
  return [start, start + width];
}

function formatWindowLabel(domain: [number, number], live: boolean) {
  const start = new Date(domain[0]).toLocaleTimeString();
  const end = new Date(domain[1]).toLocaleTimeString();
  return live ? `${start} - live` : `${start} - ${end}`;
}

function formatDuration(domain: [number, number]) {
  const seconds = Math.max(0, Math.round((domain[1] - domain[0]) / 1000));
  if (seconds < 60) return `${seconds}s visible`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m visible`;
  return `${Math.round(minutes / 60)}h visible`;
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
