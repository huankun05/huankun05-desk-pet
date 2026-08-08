interface SwitchProps {
  checked: boolean;
  onChange?: () => void;
  onClick?: () => void;
  disabled?: boolean;
}

export function Switch({ checked, onChange, onClick, disabled }: SwitchProps) {
  const handle = onClick ?? onChange;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={disabled ? undefined : handle}
      className="relative w-12 h-6 rounded-full transition-colors duration-200 flex-shrink-0"
      style={{
        backgroundColor: checked ? 'var(--primary-500)' : '#d1d5db',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
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
