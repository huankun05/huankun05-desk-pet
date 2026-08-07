interface SwitchProps {
  checked: boolean;
  onChange?: () => void;
  onClick?: () => void;
}

export function Switch({ checked, onChange, onClick }: SwitchProps) {
  const handle = onClick ?? onChange;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={handle}
      className="relative w-12 h-6 rounded-full transition-colors duration-200 flex-shrink-0"
      style={{
        backgroundColor: checked ? 'var(--primary-500)' : '#d1d5db',
        cursor: 'pointer',
      }}
    >
      <span
        className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-200 ${
          checked ? 'left-7' : 'left-1'
        }`}
      />
    </button>
  );
}
