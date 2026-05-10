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
import { Slider } from "@/components/ui/slider";

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
const DEFAULT_WINDOW_SAMPLES = 240;

export function LiveChart({ voltage, current, running }: Props) {
  const latest = useRef({ v: voltage, i: current });
  const [samples, setSamples] = useState<Sample[]>([]);
  const [autoScale, setAutoScale] = useState(true);
  const [manualVoltageMax, setManualVoltageMax] = useState(30);
  const [manualCurrentMax, setManualCurrentMax] = useState(5);
  const [followLive, setFollowLive] = useState(true);
  const [windowSamples, setWindowSamples] = useState(DEFAULT_WINDOW_SAMPLES);
  const [range, setRange] = useState<[number, number]>([0, 0]);

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

  const chartSamples = useMemo(() => {
    if (samples.length > 0) return samples;

    return [{ t: Date.now(), v: latest.current.v, i: latest.current.i }];
  }, [samples, voltage, current]);

  useEffect(() => {
    const latestIndex = chartSamples.length - 1;
    if (latestIndex < 0) return;

    if (followLive) {
      const startIndex = Math.max(0, latestIndex - windowSamples + 1);
      setRange([startIndex, latestIndex]);
      return;
    }

    setRange(([start, end]) => [
      clamp(start, 0, latestIndex),
      clamp(end, Math.min(start, latestIndex), latestIndex),
    ]);
  }, [chartSamples.length, followLive, windowSamples]);

  const visibleSamples = useMemo(
    () => chartSamples.slice(range[0], range[1] + 1),
    [chartSamples, range],
  );
  const xDomain = useMemo(
    () => [
      chartSamples[range[0]]?.t ?? chartSamples[0].t,
      chartSamples[range[1]]?.t ?? chartSamples.at(-1)!.t,
    ],
    [chartSamples, range],
  );
  const voltageDomain = autoScale ? ([0, "auto"] as const) : ([0, manualVoltageMax] as const);
  const currentDomain = autoScale ? ([0, "auto"] as const) : ([0, manualCurrentMax] as const);

  const handleRangeChange = (next: number[]) => {
    const latestIndex = chartSamples.length - 1;
    const startIndex = clamp(next[0] ?? 0, 0, latestIndex);
    const endIndex = clamp(next[1] ?? latestIndex, startIndex, latestIndex);
    setRange([startIndex, endIndex]);
    setWindowSamples(Math.max(1, endIndex - startIndex + 1));
    setFollowLive(endIndex === latestIndex);
  };

  const jumpLive = () => {
    const latestIndex = chartSamples.length - 1;
    const startIndex = Math.max(0, latestIndex - windowSamples + 1);
    setRange([startIndex, latestIndex]);
    setFollowLive(true);
  };

  return (
    <section className="rounded-md border border-border bg-background/40 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-3 text-xs font-mono">
          <span className="text-muted-foreground">{formatWindowLabel(visibleSamples, followLive)}</span>
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
            onClick={() => exportVisibleJson(visibleSamples)}
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
          <LineChart data={visibleSamples} margin={{ top: 10, right: 18, bottom: 16, left: 8 }}>
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

      <div className="mt-3 rounded-md border border-border bg-secondary/40 px-3 py-3">
        <Slider
          min={0}
          max={Math.max(0, chartSamples.length - 1)}
          step={1}
          minStepsBetweenThumbs={1}
          value={range}
          disabled={chartSamples.length < 2}
          onValueChange={handleRangeChange}
          className="h-6"
        />
        <div className="mt-1 flex justify-between text-[10px] font-mono text-muted-foreground">
          <span>{new Date(chartSamples[0].t).toLocaleTimeString()}</span>
          <span>{formatDuration(visibleSamples)}</span>
          <span>{followLive ? "live" : new Date(chartSamples.at(-1)!.t).toLocaleTimeString()}</span>
        </div>
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

function formatWindowLabel(samples: Sample[], live: boolean) {
  if (samples.length === 0) return "No samples";

  const start = new Date(samples[0].t).toLocaleTimeString();
  const end = new Date(samples.at(-1)!.t).toLocaleTimeString();
  return live ? `${start} - live` : `${start} - ${end}`;
}

function formatDuration(samples: Sample[]) {
  if (samples.length < 2) return "0s";
  const seconds = Math.max(0, Math.round((samples.at(-1)!.t - samples[0].t) / 1000));
  if (seconds < 60) return `${seconds}s visible`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m visible`;
  return `${Math.round(minutes / 60)}h visible`;
}

function exportVisibleJson(samples: Sample[]) {
  const body = JSON.stringify(
    {
      visibleWindow: {
        start: samples[0] ? new Date(samples[0].t).toISOString() : null,
        end: samples.at(-1) ? new Date(samples.at(-1)!.t).toISOString() : null,
        durationMs: samples.length > 1 ? samples.at(-1)!.t - samples[0].t : 0,
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
