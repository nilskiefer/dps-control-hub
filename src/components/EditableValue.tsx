import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

interface Props {
  value: number;
  unit: string;
  label: string;
  decimals?: number;
  step?: number;
  min?: number;
  max?: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  accent?: "voltage" | "current" | "power";
}

export function EditableValue({
  value,
  unit,
  label,
  decimals = 3,
  step = 0.01,
  min = 0,
  max = 9999,
  onCommit,
  disabled,
  accent = "voltage",
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (!isNaN(n)) {
      const clamped = Math.max(min, Math.min(max, n));
      onCommit(parseFloat(clamped.toFixed(decimals)));
    }
    setEditing(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
    else if (e.key === "Escape") setEditing(false);
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const cur = parseFloat((e.target as HTMLInputElement).value) || 0;
      const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const next = cur + (e.key === "ArrowUp" ? step * mult : -step * mult);
      const clamped = Math.max(min, Math.min(max, next));
      setDraft(clamped.toFixed(decimals));
    }
  };

  const accentClass =
    accent === "current" ? "text-amp" : accent === "power" ? "text-power" : "text-voltage";

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>{label}</span>
        <span className="text-[9px] opacity-60">click to edit · ↑↓ nudge</span>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setDraft(value.toFixed(decimals));
            setEditing(true);
          }
        }}
        className={cn(
          "group mt-1 flex items-baseline gap-2 rounded-md px-2 py-1 -mx-2 transition-colors",
          "hover:bg-accent/50 focus:bg-accent/60 focus:outline-none",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        {editing ? (
          <input
            ref={inputRef}
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={(e) => commit(e.target.value)}
            className={cn(
              "font-digits text-3xl font-bold bg-transparent outline-none w-[5ch]",
              accentClass,
            )}
          />
        ) : (
          <span className={cn("font-digits text-3xl font-bold", accentClass)}>
            {value.toFixed(decimals)}
          </span>
        )}
        <span className="font-digits text-base text-muted-foreground">{unit}</span>
      </button>
    </div>
  );
}
