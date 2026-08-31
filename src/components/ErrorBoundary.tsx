import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 自定义降级 UI */
  fallback?: ReactNode;
  /** 错误回调，用于上报日志 */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** 是否为页面级边界（显示不同样式） */
  pageLevel?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] 捕获到渲染错误:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      if (this.props.pageLevel) {
        return (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100vh',
              padding: '2rem',
              fontFamily: 'system-ui, sans-serif',
              background: '#0f0f1a',
              color: '#e0e0e0',
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>😿</div>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.5rem' }}>页面出错了</h2>
            <p
              style={{
                margin: '0 0 1.5rem',
                color: '#888',
                maxWidth: '400px',
                textAlign: 'center',
              }}
            >
              很抱歉，页面遇到了意外错误。请尝试重试。
            </p>
            <details style={{ marginBottom: '1.5rem', maxWidth: '500px', width: '100%' }}>
              <summary style={{ cursor: 'pointer', color: '#666' }}>错误详情</summary>
              <pre
                style={{
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  background: '#1a1a2e',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  overflow: 'auto',
                  maxHeight: '200px',
                }}
              >
                {this.state.error?.message}
              </pre>
            </details>
            <button
              onClick={this.handleRetry}
              style={{
                padding: '0.6rem 1.5rem',
                background: '#6366f1',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              重试
            </button>
          </div>
        );
      }

      // 组件级降级：友好错误卡片
      return (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '10px',
            border: '1px solid rgba(239,68,68,0.15)',
            background: 'rgba(254,242,242,0.7)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1rem', lineHeight: 1 }}>⚠️</span>
            <span style={{ fontSize: '0.85rem', color: '#555', flex: 1 }}>此组件加载失败</span>
            <button
              onClick={this.handleRetry}
              style={{
                padding: '0.3rem 0.75rem',
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.75rem',
                fontWeight: 500,
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLButtonElement).style.opacity = '0.85';
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLButtonElement).style.opacity = '1';
              }}
            >
              重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
