import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  unit: string;
  label: string;
  decimals: number;
  accent: "voltage" | "current" | "power";
  active?: boolean;
}

export function Readout({ value, unit, label, decimals, accent, active = true }: Props) {
  const displayValue = useAnimatedNumber(value, active);
  const colorVar =
    accent === "current" ? "var(--amp)" : accent === "power" ? "var(--power)" : "var(--voltage)";

  const glowClass =
    accent === "current" ? "glow-amp" : accent === "power" ? "glow-power" : "glow-voltage";

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-digits text-6xl md:text-7xl font-extrabold tabular-nums leading-none",
            active && glowClass,
            !active && "opacity-30",
          )}
          style={{ color: colorVar }}
        >
          {active ? displayValue.toFixed(decimals) : "—.———".slice(0, decimals + 2)}
        </span>
        <span className="font-digits text-2xl font-medium text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

function useAnimatedNumber(value: number, active: boolean) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef(value);

  useEffect(() => {
    if (!active) {
      previousValue.current = value;
      setDisplayValue(value);
      return;
    }

    const from = previousValue.current;
    const to = value;
    const startedAt = performance.now();
    const durationMs = 220;
    let raf = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setDisplayValue(from + (to - from) * eased);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    previousValue.current = value;

    return () => cancelAnimationFrame(raf);
  }, [active, value]);

  return displayValue;
}
