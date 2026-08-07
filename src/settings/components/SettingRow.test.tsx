import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SettingRow } from '../components/SettingRow';

/**
 * SettingRow 内部用了 useNavigate（支持 `to` 跳转），
 * 必须包一层 Router，否则 react-router 会抛 invariant。
 */
function renderInRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('SettingRow', () => {
  it('renders title and description', () => {
    renderInRouter(
      <SettingRow title="Lang" description="App language">
        <select>
          <option value="zh">中文</option>
          <option value="en">EN</option>
        </select>
      </SettingRow>,
    );

    expect(screen.getByText('Lang')).toBeTruthy();
    expect(screen.getByText('App language')).toBeTruthy();
    expect(screen.getByDisplayValue('中文')).toBeTruthy();
  });

  it('renders without description', () => {
    renderInRouter(
      <SettingRow title="Always on top">
        <input type="checkbox" role="switch" />
      </SettingRow>,
    );

    expect(screen.getByText('Always on top')).toBeTruthy();
  });

  it('renders as a clickable button when `to` is provided', () => {
    renderInRouter(<SettingRow title="Chat appearance" to="/settings/chat/appearance" />);

    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.getByText('Chat appearance')).toBeTruthy();
  });
});
