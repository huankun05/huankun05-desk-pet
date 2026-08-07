import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBrainBridge } from './useBrainBridge';
import { postEmotionBridgeEvent, getEmotionBridgeState } from '../services/coreApi';
import { isTauriEnv } from '../utils/tauriEnv';

vi.mock('../services/coreApi');
vi.mock('../utils/tauriEnv');

const mockPostEmotionBridgeEvent = vi.mocked(postEmotionBridgeEvent);
const mockGetEmotionBridgeState = vi.mocked(getEmotionBridgeState);
const mockIsTauriEnv = vi.mocked(isTauriEnv);

describe('useBrainBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTauriEnv.mockReturnValue(true);
    mockPostEmotionBridgeEvent.mockResolvedValue({ applied: true } as never);
    mockGetEmotionBridgeState.mockResolvedValue({
      dimensions: {},
      pad: { pleasure: 0, arousal: 0, dominance: 0 },
      mood_label: 'neutral',
      expression_scale: 0.6,
    } as never);
  });

  it('calls getEmotionBridgeState on mount for initial poll', async () => {
    renderHook(() => useBrainBridge());

    await vi.waitFor(() => {
      expect(mockGetEmotionBridgeState).toHaveBeenCalled();
    });
  });

  it('skips bridge logic when not in Tauri env', () => {
    mockIsTauriEnv.mockReturnValue(false);

    renderHook(() => useBrainBridge());

    expect(mockGetEmotionBridgeState).not.toHaveBeenCalled();
    expect(mockPostEmotionBridgeEvent).not.toHaveBeenCalled();
  });
});
