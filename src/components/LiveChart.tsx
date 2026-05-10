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

export function LiveChart({ voltage, current, running }: Props) {
  const latest = useRef({ v: voltage, i: current });
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [timeScaleSeconds, setTimeScaleSeconds] = useState(60);
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
    const fallbackStart = now - timeScaleSeconds * 1000;
    const start = samples[0]?.t ?? fallbackStart;
    const end = samples.at(-1)?.t ?? now;
    const maxOffset = Math.max(0, end - start - timeScaleSeconds * 1000);

    return { start, end, maxOffset };
  }, [samples, timeScaleSeconds, now]);

  useEffect(() => {
    if (followLive) {
      setViewOffsetMs(historyBounds.maxOffset);
      return;
    }

    setViewOffsetMs((value) => Math.min(value, historyBounds.maxOffset));
  }, [followLive, historyBounds.maxOffset]);

  const xDomain = useMemo(() => {
    const start = historyBounds.start + viewOffsetMs;
    return [start, start + timeScaleSeconds * 1000] as [number, number];
  }, [historyBounds.start, viewOffsetMs, timeScaleSeconds]);

  const chartData = useMemo(() => {
    const visible = samples.filter((sample) => sample.t >= xDomain[0] && sample.t <= xDomain[1]);

    if (visible.length > 0) return visible;

    return [{ t: xDomain[1], v: latest.current.v, i: latest.current.i }];
  }, [samples, xDomain, voltage, current]);

  const voltageDomain = autoScale ? ([0, "auto"] as const) : ([0, manualVoltageMax] as const);
  const currentDomain = autoScale ? ([0, "auto"] as const) : ([0, manualCurrentMax] as const);

  return (
    <section className="rounded-md border border-border bg-background/40 p-3">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Time Scale
          <div className="flex items-center gap-2">
            <input
              className="h-8 w-20 rounded-md border border-border bg-secondary px-2 text-xs font-mono text-foreground"
              type="number"
              min={5}
              max={3600}
              step={5}
              value={timeScaleSeconds}
              onChange={(event) => {
                setTimeScaleSeconds(clamp(Number(event.target.value) || 60, 5, 3600));
                setFollowLive(true);
              }}
            />
            <span className="text-xs font-mono text-muted-foreground">s</span>
          </div>
        </label>

        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          View
          <input
            className="h-8 w-40 accent-primary"
            type="range"
            min={0}
            max={historyBounds.maxOffset}
            step={1000}
            value={viewOffsetMs}
            disabled={historyBounds.maxOffset === 0}
            onChange={(event) => {
              setFollowLive(false);
              setViewOffsetMs(Number(event.target.value));
            }}
          />
        </label>

        <button
          type="button"
          className="h-8 rounded-md border border-border bg-secondary px-3 text-xs font-mono text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          disabled={followLive}
          onClick={() => setFollowLive(true)}
        >
          {followLive ? "Live" : "Jump Live"}
        </button>

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

        <div className="ml-auto flex flex-wrap gap-3 text-xs font-mono">
          <span className="text-muted-foreground">{formatWindowLabel(xDomain, now)}</span>
          <span className="text-voltage">{voltage.toFixed(2)} V</span>
          <span className="text-amp">{current.toFixed(3)} A</span>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="h-8 rounded-md border border-border bg-secondary px-3 text-xs font-mono text-foreground transition-colors hover:bg-accent"
            onClick={() => exportSamples(chartData, "json")}
            disabled={chartData.length === 0}
          >
            Save JSON
          </button>
          <button
            type="button"
            className="h-8 rounded-md border border-border bg-secondary px-3 text-xs font-mono text-foreground transition-colors hover:bg-accent"
            onClick={() => exportSamples(chartData, "csv")}
            disabled={chartData.length === 0}
          >
            Save CSV
          </button>
          <button
            type="button"
            className="h-8 rounded-md border border-border bg-secondary px-3 text-xs font-mono text-foreground transition-colors hover:bg-accent"
            onClick={() => saveChartSvg(chartRef.current)}
          >
            Save Visual
          </button>
        </div>
      </div>

      <div ref={chartRef} className="h-64 min-w-0">
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
                name === "Voltage" ? `${Number(value).toFixed(2)} V` : `${Number(value).toFixed(3)} A`,
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

function exportSamples(samples: Sample[], format: "json" | "csv") {
  const rows = samples.map((sample) => ({
    timestamp: new Date(sample.t).toISOString(),
    timeMs: sample.t,
    voltage: Number(sample.v.toFixed(4)),
    current: Number(sample.i.toFixed(5)),
  }));
  const body =
    format === "json"
      ? JSON.stringify(rows, null, 2)
      : [
          "timestamp,timeMs,voltage,current",
          ...rows.map((row) => `${row.timestamp},${row.timeMs},${row.voltage},${row.current}`),
        ].join("\n");
  const blob = new Blob([body], {
    type: format === "json" ? "application/json" : "text/csv",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dps150-graph-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function saveChartSvg(container: HTMLDivElement | null) {
  const svg = container?.querySelector("svg");
  if (!svg) return;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(Math.round(rect.width)));
  clone.setAttribute("height", String(Math.round(rect.height)));
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${Math.round(rect.width)} ${Math.round(rect.height)}`);
  }

  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("x", "0");
  background.setAttribute("y", "0");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", getCss("--background"));
  clone.insertBefore(background, clone.firstChild);

  const serialized = replaceCssVars(new XMLSerializer().serializeToString(clone));
  const blob = new Blob([serialized], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dps150-chart-${new Date().toISOString().replace(/[:.]/g, "-")}.svg`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function replaceCssVars(svg: string) {
  return svg
    .replaceAll("var(--voltage)", getCss("--voltage"))
    .replaceAll("var(--amp)", getCss("--amp"))
    .replaceAll("var(--muted-foreground)", getCss("--muted-foreground"))
    .replaceAll("var(--border)", getCss("--border"));
}

function getCss(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
