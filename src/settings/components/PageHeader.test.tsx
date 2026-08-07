import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { PageHeader } from './PageHeader';

/** 探针：把当前路由 path 渲染出来，便于断言 navigate 结果 */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname}</div>;
}

function renderWithBack(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/settings/chat" element={<LocationProbe />} />
        <Route path="/settings/extensions" element={<LocationProbe />} />
        <Route
          path="/settings/extensions/wake-word"
          element={
            <>
              <PageHeader title="语音唤醒" />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PageHeader handleBack', () => {
  it('有历史时回退到上一页（跨分区跳转返回刚才的页面）', () => {
    // 从 /settings/chat 跳到 /settings/extensions/wake-word，应回退到来源页
    renderWithBack(['/settings/chat', '/settings/extensions/wake-word']);
    expect(screen.getByTestId('path').textContent).toBe('/settings/extensions/wake-word');

    fireEvent.click(screen.getByLabelText('返回'));

    expect(screen.getByTestId('path').textContent).toBe('/settings/chat');
  });

  it('无历史（直达深层页）时按父分区兜底', () => {
    // 单条历史（如主窗深链直达），key 为 default，应回退到父分区
    renderWithBack(['/settings/extensions/wake-word']);
    expect(screen.getByTestId('path').textContent).toBe('/settings/extensions/wake-word');

    fireEvent.click(screen.getByLabelText('返回'));

    expect(screen.getByTestId('path').textContent).toBe('/settings/extensions');
  });
});
