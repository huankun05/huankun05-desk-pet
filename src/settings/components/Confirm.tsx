import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

interface ConfirmContextValue {
  confirm: ConfirmFn;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      setPending({ options: opts, resolve });
    });
  }, []);

  const handleClose = useCallback(
    (result: boolean) => {
      pending?.resolve(result);
      setPending(null);
    },
    [pending],
  );

  const title = pending?.options.title ?? t('common.confirm_title');
  const confirmText = pending?.options.confirmText ?? t('common.confirm_ok');
  const cancelText = pending?.options.cancelText ?? t('common.confirm_cancel');

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Modal
        isOpen={pending !== null}
        onClose={() => handleClose(false)}
        title={title}
        maxWidth="max-w-md"
        footer={
          <>
            <button
              type="button"
              onClick={() => handleClose(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-600 hover:bg-neutral-100 transition-colors"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={() => handleClose(true)}
              className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
                pending?.options.danger
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-indigo-500 hover:bg-indigo-600'
              }`}
            >
              {confirmText}
            </button>
          </>
        }
      >
        <p className="text-sm text-neutral-600 leading-relaxed">{pending?.options.message}</p>
      </Modal>
    </ConfirmContext.Provider>
  );
}

// useConfirm 与 ConfirmProvider 强耦合（共享 ConfirmContext），Fast Refresh 无法拆分，故豁免。
// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  // HMR 热替换后 Provider/Consumer 可能因模块实例不一致而读到 null。
  // 降级为原生 confirm，避免整个设置页白屏崩溃（正常情况仍能拿到弹窗）。
  if (!ctx) {
    return {
      confirm: (options) =>
        new Promise<boolean>((resolve) => {
          const message = typeof options === 'string' ? options : options.message;
          resolve(window.confirm(message));
        }),
    };
  }
  return ctx;
}
