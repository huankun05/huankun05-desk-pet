import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PersonalityPage } from './PersonalityPage';

vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN' },
  }),
}));

describe('PersonalityPage', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  it('renders title and refresh button', async () => {
    render(<PersonalityPage />);
    expect(screen.getAllByText('settings.personality.title').length).toBeGreaterThan(0);
    expect(screen.getByText('settings.personality.refresh')).toBeTruthy();
  });

  it('shows online indicator when health is true', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    render(<PersonalityPage />);
    await waitFor(() => expect(screen.getByText('settings.personality.online')).toBeTruthy());
  });

  it('shows offline indicator when health is false', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false });
    render(<PersonalityPage />);
    await waitFor(() => expect(screen.getByText('settings.personality.offline')).toBeTruthy());
  });
});
