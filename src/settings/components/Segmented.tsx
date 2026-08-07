/**
 * 分段选择控件：用于少量互斥的离散选项（如气泡位置、目标帧率档位）。
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-white text-neutral-800 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;
