import { cn } from "@/lib/utils";

interface Props {
  value: number;
  unit: string;
  label: string;
  decimals: number;
  accent: "voltage" | "current" | "power";
  active?: boolean;
}

export function Readout({ value, unit, label, decimals, accent, active = true }: Props) {
  const colorVar =
    accent === "current" ? "var(--current)" :
    accent === "power"   ? "var(--power)"   :
    "var(--voltage)";

  const glowClass =
    accent === "current" ? "glow-current" :
    accent === "power"   ? "glow-power"   :
    "glow-voltage";

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-digits text-6xl md:text-7xl font-extrabold tabular-nums leading-none",
            active && glowClass,
            !active && "opacity-30",
          )}
          style={{ color: colorVar }}
        >
          {active ? value.toFixed(decimals) : "—.———".slice(0, decimals + 2)}
        </span>
        <span className="font-digits text-2xl font-medium text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  );
}
