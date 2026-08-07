import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  type ReactNode,
} from 'react';
import { Icon } from '@iconify/react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastState {
  toasts: ToastItem[];
}

type ToastAction =
  { type: 'ADD'; payload: ToastItem } | { type: 'REMOVE'; payload: string } | { type: 'CLEAR' };

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function toastReducer(state: ToastState, action: ToastAction): ToastState {
  switch (action.type) {
    case 'ADD':
      return { toasts: [...state.toasts, action.payload] };
    case 'REMOVE':
      return { toasts: state.toasts.filter((t) => t.id !== action.payload) };
    case 'CLEAR':
      return { toasts: [] };
    default:
      return state;
  }
}

const ICON_MAP: Record<ToastType, string> = {
  success: 'solar:check-circle-bold',
  error: 'solar:close-circle-bold',
  warning: 'solar:danger-triangle-bold',
  info: 'solar:info-circle-bold',
};

const COLOR_MAP: Record<ToastType, { bg: string; icon: string; border: string }> = {
  success: { bg: 'bg-green-50 text-green-700', icon: 'text-green-500', border: 'border-green-200' },
  error: { bg: 'bg-red-50 text-red-700', icon: 'text-red-500', border: 'border-red-200' },
  warning: { bg: 'bg-amber-50 text-amber-700', icon: 'text-amber-500', border: 'border-amber-200' },
  info: { bg: 'bg-blue-50 text-blue-700', icon: 'text-blue-500', border: 'border-blue-200' },
};

const DURATION = 3000;

function ToastBubble({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  const { bg, icon, border } = COLOR_MAP[toast.type];

  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), DURATION);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  return (
    <div
      className={`toast-slide-in flex items-start gap-2 rounded-xl border ${border} ${bg} px-4 py-3 shadow-lg min-w-[260px] max-w-sm`}
    >
      <Icon icon={ICON_MAP[toast.type]} className={`text-xl shrink-0 ${icon}`} />
      <span className="text-sm leading-5 break-words flex-1">{toast.message}</span>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(toastReducer, { toasts: [] });

  const remove = useCallback((id: string) => {
    dispatch({ type: 'REMOVE', payload: id });
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    dispatch({ type: 'ADD', payload: { id, message, type } });
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2">
        {state.toasts.map((t) => (
          <ToastBubble key={t.id} toast={t} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
