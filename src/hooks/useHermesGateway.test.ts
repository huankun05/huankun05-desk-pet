import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHermesGateway } from './useHermesGateway';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN' },
  }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('../services/eventBus', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../utils/toast', () => ({
  showToast: vi.fn(),
}));

vi.mock('../utils/tauriEnv', () => ({
  isTauriEnv: () => false,
}));

vi.mock('../services/provider/watchdog', () => ({
  isOfflineModeEnabled: vi.fn(() => false),
}));

vi.mock('../services/provider/manager', () => ({
  providerManager: {
    getActiveChatProvider: vi.fn(),
    getActiveSTTProvider: vi.fn(),
    getActiveTTSProvider: vi.fn(),
  },
}));

vi.mock('../services/tools/registry', () => ({
  toolRegistry: { getAll: vi.fn(() => []) },
}));

vi.mock('../services/tools/toolManagement', () => ({
  getDisabledTools: vi.fn(() => []),
}));

vi.mock('../services/chatStorage', () => ({
  createSession: vi.fn(() => 's1'),
  saveMessage: vi.fn(),
  getOrCreateActiveSession: vi.fn(() => ({ id: 's1' })),
  switchSession: vi.fn(),
}));

describe('useHermesGateway', () => {
  let mockClient: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    isConnected: boolean;
    send: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockClient = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: false,
      send: vi.fn(),
    };

    vi.doMock('../services/hermesGateway', () => ({
      getHermesGatewayClient: vi.fn(() => mockClient),
      destroyHermesGatewayClient: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns initial state', () => {
    const { result } = renderHook(() => useHermesGateway());
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(typeof result.current.sendMessage).toBe('function');
    expect(typeof result.current.interruptResponse).toBe('function');
  });

  it('blocks sendMessage when offline mode is enabled', async () => {
    const { isOfflineModeEnabled } = await import('../services/provider/watchdog');
    vi.mocked(isOfflineModeEnabled).mockReturnValue(true);

    const { result } = renderHook(() => useHermesGateway());
    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(mockClient.send).not.toHaveBeenCalled();
  });
});
