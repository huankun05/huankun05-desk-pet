interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
  formatter?: (v: number) => string;
  desc?: string;
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  formatter,
  desc,
}: SliderRowProps) {
  const display = formatter ? formatter(value) : String(value);
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-neutral-100 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-neutral-800">{label}</span>
          <span className="text-sm font-medium text-neutral-800 tabular-nums">
            {display}
            {unit && <span className="ml-0.5 text-xs text-neutral-400">{unit}</span>}
          </span>
        </div>
        {desc && <p className="mt-0.5 text-xs text-neutral-400">{desc}</p>}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="mt-2 w-full h-2 cursor-pointer appearance-none rounded-full"
          style={{
            background: `linear-gradient(to right, var(--primary-500) ${percent}%, #e5e7eb ${percent}%)`,
          }}
        />
      </div>
    </div>
  );
}
