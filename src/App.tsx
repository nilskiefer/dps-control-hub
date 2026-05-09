import { useEffect, useRef, useState } from "react";
import { useDps150 } from "@/hooks/useDps150";
import { Readout } from "@/components/Readout";
import { EditableValue } from "@/components/EditableValue";
import { LiveChart } from "@/components/LiveChart";
import { Button } from "@/components/ui/button";
import {
  Plug,
  Power,
  Activity,
  Thermometer,
  Zap,
  AlertTriangle,
  Terminal,
  Trash2,
  ArrowDownToLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { defaultSerialConnectionOptions } from "@/lib/dps150";
import type { SerialLogEntry } from "@/hooks/useDps150";
import type { SerialConnectionOptions } from "@/lib/dps150";

export default function App() {
  const { state, error, logEntries, log, connect, disconnect, clearLog, device } = useDps150();
  const [connectionOptions, setConnectionOptions] = useState(defaultSerialConnectionOptions);
  const dev = device.current;
  const connected = state.connected;
  const readbackActive = state.readbackActive;
  const outputOn = state.outputClosed;
  const outputControlReady = Boolean(dev);

  const toggleOutput = async () => {
    log(
      "info",
      `Output click received (device=${dev ? "yes" : "no"}, connected=${connected ? "yes" : "no"}, outputClosed=${String(state.outputClosed)})`,
    );

    if (!dev) {
      log("warn", "Output command not sent: no active serial device handle");
      return;
    }

    try {
      if (outputOn) {
        log("info", "Output button command: disable");
        await dev.disable();
      } else {
        log("info", "Output button command: enable");
        await dev.enable();
      }
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      log("error", `Output command failed: ${error.name}: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="port port-pos" aria-hidden />
              <span className="port port-neg" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                DPS-150 <span className="text-muted-foreground font-normal">Web Console</span>
              </h1>
              <p className="text-xs text-muted-foreground font-mono">
                {connected
                  ? `${state.modelName || "DPS-150"} · HW ${state.hardwareVersion || "—"} · FW ${state.firmwareVersion || "—"} · ${readbackActive ? "readback" : "write-only"}`
                  : "Not connected"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {connected ? (
              <Button variant="secondary" size="sm" onClick={disconnect}>
                <Plug className="size-4" /> Disconnect
              </Button>
            ) : (
              <Button size="sm" onClick={() => connect(connectionOptions)}>
                <Plug className="size-4" /> Connect
              </Button>
            )}
          </div>
        </header>

        <ConnectionSettings
          options={connectionOptions}
          disabled={connected || Boolean(dev)}
          onChange={setConnectionOptions}
        />

        {error && (
          <div className="mb-4 panel border-destructive/50 px-4 py-2 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="size-4" /> {error}
          </div>
        )}

        {connected && !readbackActive && (
          <div className="mb-4 panel border-voltage/50 px-4 py-2 text-sm text-voltage flex items-center gap-2">
            <AlertTriangle className="size-4" /> Write-only mode: commands can be sent, but live
            telemetry is not available.
          </div>
        )}

        {/* Main meter panel */}
        <section className="panel p-5 md:p-7 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            <Readout
              label="Output Voltage"
              value={state.outputVoltage}
              unit="V"
              decimals={3}
              accent="voltage"
              active={connected}
            />
            <Readout
              label="Output Current"
              value={state.outputCurrent}
              unit="A"
              decimals={3}
              accent="current"
              active={connected}
            />
            <Readout
              label="Output Power"
              value={state.outputPower}
              unit="W"
              decimals={2}
              accent="power"
              active={connected}
            />
          </div>

          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            <EditableValue
              label="Set Voltage"
              value={state.setVoltage}
              unit="V"
              decimals={2}
              step={0.01}
              min={0}
              max={state.upperLimitVoltage || 30}
              accent="voltage"
              disabled={!connected}
              onCommit={(v) => dev?.setVoltage(v)}
            />
            <EditableValue
              label="Set Current"
              value={state.setCurrent}
              unit="A"
              decimals={3}
              step={0.001}
              min={0}
              max={state.upperLimitCurrent || 5}
              accent="current"
              disabled={!connected}
              onCommit={(v) => dev?.setCurrent(v)}
            />

            <button
              type="button"
              aria-disabled={!outputControlReady}
              title={
                outputControlReady
                  ? outputOn
                    ? "Disable output"
                    : "Enable output"
                  : "Connect to a serial device before toggling output"
              }
              onPointerDown={() => {
                log(
                  "info",
                  `Output pointer received (device=${dev ? "yes" : "no"}, connected=${connected ? "yes" : "no"}, outputClosed=${String(state.outputClosed)})`,
                );
              }}
              onClick={toggleOutput}
              className={cn(
                "col-span-2 md:col-span-2 row-span-1 rounded-lg px-5 py-3 font-medium transition-all",
                "flex items-center justify-center gap-3 border",
                outputOn
                  ? "bg-destructive text-destructive-foreground border-destructive shadow-[0_0_30px_-5px_var(--destructive)]"
                  : "bg-secondary text-secondary-foreground border-border hover:bg-accent",
                !outputControlReady && "opacity-40 cursor-not-allowed",
              )}
            >
              <Power className="size-5" />
              <span className="font-mono uppercase tracking-[0.2em] text-sm">
                {outputOn ? "Output On" : "Output Off"}
              </span>
            </button>
          </div>

          <div className="mt-5">
            <LiveChart
              voltage={state.outputVoltage}
              current={state.outputCurrent}
              running={connected}
              vMax={state.upperLimitVoltage || 30}
              iMax={state.upperLimitCurrent || 5}
            />
          </div>

          {/* Status row */}
          <div className="mt-5 flex flex-wrap gap-4 text-xs font-mono">
            <Stat
              icon={<Zap className="size-3.5" />}
              label="MODE"
              value={connected ? state.mode : "—"}
              tone={state.mode === "CC" ? "current" : "voltage"}
              active={connected && outputOn}
            />
            <Stat
              icon={<Activity className="size-3.5" />}
              label="VIN"
              value={`${state.inputVoltage.toFixed(2)} V`}
              active={connected}
            />
            <Stat
              icon={<Thermometer className="size-3.5" />}
              label="TEMP"
              value={`${state.temperature.toFixed(0)} °C`}
              active={connected}
            />
            <Stat
              icon={<Activity className="size-3.5" />}
              label="CAP"
              value={`${state.outputCapacity.toFixed(3)} Ah`}
              active={connected}
            />
            <Stat
              icon={<Activity className="size-3.5" />}
              label="ENERGY"
              value={`${state.outputEnergy.toFixed(3)} Wh`}
              active={connected}
            />
            <Stat
              icon={<AlertTriangle className="size-3.5" />}
              label="PROT"
              value={state.protectionState || "OK"}
              tone={state.protectionState ? "alert" : undefined}
              active={connected}
            />
          </div>
        </section>

        {/* Protection limits */}
        <section className="panel p-5 mb-4">
          <h2 className="text-xs uppercase tracking-[0.22em] text-muted-foreground mb-4">
            Protection Limits
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <EditableValue
              label="OVP"
              value={state.ovp}
              unit="V"
              decimals={2}
              step={0.1}
              max={35}
              disabled={!connected}
              accent="voltage"
              onCommit={(v) => dev?.setOvp(v)}
            />
            <EditableValue
              label="OCP"
              value={state.ocp}
              unit="A"
              decimals={3}
              step={0.01}
              max={6}
              disabled={!connected}
              accent="current"
              onCommit={(v) => dev?.setOcp(v)}
            />
            <EditableValue
              label="OPP"
              value={state.opp}
              unit="W"
              decimals={1}
              step={1}
              max={160}
              disabled={!connected}
              accent="power"
              onCommit={(v) => dev?.setOpp(v)}
            />
            <EditableValue
              label="OTP"
              value={state.otp}
              unit="°C"
              decimals={0}
              step={1}
              max={120}
              disabled={!connected}
              onCommit={(v) => dev?.setOtp(v)}
            />
            <EditableValue
              label="LVP"
              value={state.lvp}
              unit="V"
              decimals={2}
              step={0.1}
              max={30}
              disabled={!connected}
              accent="voltage"
              onCommit={(v) => dev?.setLvp(v)}
            />
          </div>
        </section>

        {/* Memory groups */}
        <section className="panel p-5 mb-8">
          <h2 className="text-xs uppercase tracking-[0.22em] text-muted-foreground mb-4">
            Memory Presets
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {state.groups.map((g, i) => (
              <button
                key={i}
                disabled={!connected}
                onClick={async () => {
                  if (!dev) return;
                  await dev.setVoltage(g.v);
                  await dev.setCurrent(g.c);
                }}
                className={cn(
                  "group rounded-lg border border-border bg-secondary/50 p-3 text-left transition-colors",
                  "hover:bg-accent hover:border-primary/50",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                )}
              >
                <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
                  <span>Group {i + 1}</span>
                  <span className="opacity-0 group-hover:opacity-100 text-primary">recall →</span>
                </div>
                <div className="mt-1 flex items-baseline gap-3 font-digits">
                  <span className="text-voltage text-lg font-bold">
                    {g.v.toFixed(2)}
                    <span className="text-xs text-muted-foreground ml-0.5">V</span>
                  </span>
                  <span className="text-amp text-lg font-bold">
                    {g.c.toFixed(3)}
                    <span className="text-xs text-muted-foreground ml-0.5">A</span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <SerialConsole entries={logEntries} onClear={clearLog} />

        <footer className="text-center text-[11px] text-muted-foreground font-mono">
          Web Serial · 9600 baud default · Requires Chrome / Edge / Opera over HTTPS
        </footer>
      </div>
    </div>
  );
}

function ConnectionSettings({
  options,
  disabled,
  onChange,
}: {
  options: SerialConnectionOptions;
  disabled: boolean;
  onChange: (options: SerialConnectionOptions) => void;
}) {
  const controlClass =
    "h-8 rounded-md border border-border bg-secondary px-2 text-xs font-mono text-foreground disabled:opacity-50";

  return (
    <section className="mb-4 grid grid-cols-2 gap-3 rounded-md border border-border bg-secondary/30 p-3 md:grid-cols-6">
      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Baud
        <select
          className={controlClass}
          value={options.baudRate}
          disabled={disabled}
          onChange={(event) => onChange({ ...options, baudRate: Number(event.target.value) })}
        >
          <option value={115200}>115200</option>
          <option value={57600}>57600</option>
          <option value={38400}>38400</option>
          <option value={19200}>19200</option>
          <option value={9600}>9600</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Flow
        <select
          className={controlClass}
          value={options.flowControl}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...options,
              flowControl: event.target.value as SerialConnectionOptions["flowControl"],
            })
          }
        >
          <option value="hardware">hardware</option>
          <option value="none">none</option>
          <option value="auto">auto</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <input
          type="checkbox"
          checked={options.manageSignals}
          disabled={disabled}
          onChange={(event) => onChange({ ...options, manageSignals: event.target.checked })}
        />
        Signals
      </label>

      <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <input
          type="checkbox"
          checked={options.dataTerminalReady}
          disabled={disabled || !options.manageSignals}
          onChange={(event) => onChange({ ...options, dataTerminalReady: event.target.checked })}
        />
        DTR
      </label>

      <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <input
          type="checkbox"
          checked={options.requestToSend}
          disabled={disabled || !options.manageSignals}
          onChange={(event) => onChange({ ...options, requestToSend: event.target.checked })}
        />
        RTS
      </label>

      <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <input
          type="checkbox"
          checked={options.keepWriteOnlyOnReadFailure}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...options, keepWriteOnlyOnReadFailure: event.target.checked })
          }
        />
        Write-only
      </label>

      <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Delay ms
        <input
          className={controlClass}
          type="number"
          min={0}
          step={50}
          value={options.startupDelayMs}
          disabled={disabled}
          onChange={(event) => onChange({ ...options, startupDelayMs: Number(event.target.value) })}
        />
      </label>
    </section>
  );
}

function SerialConsole({ entries, onClear }: { entries: SerialLogEntry[]; onClear: () => void }) {
  const [autoscroll, setAutoscroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoscroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [autoscroll, entries]);

  return (
    <section className="panel p-4 mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="size-4 text-primary" />
          <h2 className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
            Serial Console
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoscroll ? "default" : "secondary"}
            size="sm"
            onClick={() => setAutoscroll((value) => !value)}
          >
            <ArrowDownToLine className="size-4" /> Auto
          </Button>
          <Button variant="secondary" size="sm" onClick={onClear} disabled={entries.length === 0}>
            <Trash2 className="size-4" /> Clear
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="h-56 overflow-auto rounded-md border border-border bg-background/70 p-3 font-mono text-[11px] leading-relaxed"
      >
        {entries.length === 0 ? (
          <div className="text-muted-foreground">
            Waiting for serial activity. Click Connect to start logging.
          </div>
        ) : (
          entries.map((entry) => <ConsoleLine key={entry.id} entry={entry} />)
        )}
      </div>
    </section>
  );
}

function ConsoleLine({ entry }: { entry: SerialLogEntry }) {
  const levelClass =
    entry.level === "error"
      ? "text-destructive"
      : entry.level === "warn"
        ? "text-voltage"
        : entry.level === "success"
          ? "text-power"
          : "text-muted-foreground";

  return (
    <div className="grid grid-cols-[4.5rem_4.25rem_minmax(0,1fr)] gap-2 py-0.5">
      <span className="text-muted-foreground">{entry.time}</span>
      <span className={cn("uppercase", levelClass)}>{entry.level}</span>
      <span className="break-words text-foreground">{entry.message}</span>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
  active = true,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "voltage" | "current" | "power" | "alert";
  active?: boolean;
}) {
  const color =
    tone === "current"
      ? "text-amp"
      : tone === "voltage"
        ? "text-voltage"
        : tone === "power"
          ? "text-power"
          : tone === "alert"
            ? "text-destructive"
            : "text-foreground";
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary/60 border border-border",
        !active && "opacity-50",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={cn("font-mono font-semibold", color)}>{value}</span>
    </div>
  );
}
