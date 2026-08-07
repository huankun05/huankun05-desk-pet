import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ChatBubble } from './ChatBubble';

describe('ChatBubble', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders message text', () => {
    render(<ChatBubble message={{ id: 1, text: 'Hello' }} onComplete={() => {}} />);

    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('calls onComplete after duration', async () => {
    const onComplete = vi.fn();
    render(<ChatBubble message={{ id: 2, text: 'Bye', duration: 1000 }} onComplete={onComplete} />);

    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onComplete).toHaveBeenCalledWith(2);
  });
});
