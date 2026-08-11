import { useLive2D } from '../../hooks/useLive2D';
import { isPointOverCharacter } from '../../lib/live2d';
import { useRef, useEffect, memo, useState } from 'react';

interface Live2DViewerProps {
  modelPath: string;
  emotion?: string;
  zoomFactor?: number;
  feetOffset?: number;
  modelWidthRatio?: number;
  baseViewportAspect?: number;
  modelCanvasW?: number;
  modelCanvasH?: number;
  energy?: number;
  expressionMap?: Record<string, string>;
  idleExpressions?: string[];
  idleTimeout?: number;
  mouseSensitivity?: number;
  /** 角色被隐藏时暂停渲染（降到 1fps） */
  renderPaused?: boolean;
  targetFps?: number;
  adaptiveFps?: boolean;
  onClickPosition?: (relativeY: number, rawY: number, rawX?: number) => void;
  onModelLoaded?: (info: { canvasWidth: number; canvasHeight: number }) => void;
  headYRatio?: number;
}

export const Live2DViewer = memo(function Live2DViewer({
  modelPath,
  emotion = 'default',
  zoomFactor = 1.0,
  feetOffset = 0,
  modelWidthRatio = 1.0,
  baseViewportAspect = 0,
  modelCanvasW = 750,
  modelCanvasH = 1080,
  energy = 0.7,
  expressionMap,
  idleExpressions,
  idleTimeout = 5,
  mouseSensitivity = 1.0,
  renderPaused = false,
  targetFps = 60,
  adaptiveFps = true,
  onClickPosition,
  onModelLoaded,
  headYRatio: _headYRatio = 0.35,
}: Live2DViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);

  const { canvasRef, isLoading, modelStatus, error, handleClick, handleRetry } = useLive2D({
    modelPath,
    emotion,
    zoomFactor,
    feetOffset,
    modelWidthRatio,
    baseViewportAspect,
    modelCanvasW,
    modelCanvasH,
    energy,
    expressionMap,
    idleExpressions,
    idleTimeout,
    mouseSensitivity,
    renderPaused,
    targetFps,
    adaptiveFps,
    onModelLoaded,
  });

  // 模型加载进度模拟（视觉反馈）
  useEffect(() => {
    if (modelStatus === 'init') {
      setLoadingProgress(0);
    } else if (modelStatus === 'loading') {
      // 模拟加载进度：2 秒内从 10% 到 90%
      const start = Date.now();
      const baseProgress = 10;
      const timer = setInterval(() => {
        const elapsed = (Date.now() - start) / 1000;
        const progress = Math.min(baseProgress + elapsed * 40, 90);
        setLoadingProgress(progress);
      }, 200);
      return () => clearInterval(timer);
    } else if (modelStatus === 'ready') {
      setLoadingProgress(100);
    }
  }, [modelStatus]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();

    // ── 真实角色包围盒命中测试（基于 Cubism 模型矩阵，100% 贴合实际渲染）──
    // 点在角色本体范围外（透明边距/四周空白）→ 直接 return，
    // 不触发 handleClick（角色反应/语音），也不传 onClickPosition。
    // 彻底根治"点空白也触发角色"。零像素读取、不依赖画布尺寸估算。
    try {
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      if (!isPointOverCharacter(cssX, cssY)) return;
    } catch {
      /* 命中测试失败时降级：允许点击通过 */
    }

    // 通过命中测试 → 触发角色交互
    try {
      handleClick();
    } catch (err) {
      console.error('[Live2D] handleClick error:', err);
    }
    if (onClickPosition) {
      try {
        const rawY = (e.clientY - rect.top) / rect.height;
        const rawX = (e.clientX - rect.left) / rect.width;

        const scaledModelHeight = rect.height * zoomFactor;
        const feetOffsetPx = feetOffset * rect.height;
        const characterTop = rect.height - scaledModelHeight + feetOffsetPx;
        const characterHeight = scaledModelHeight;

        const clickY = e.clientY - rect.top;

        let adjustedY: number;
        if (characterHeight > 0) {
          const relativeToCharacter = (clickY - characterTop) / characterHeight;
          adjustedY = Math.max(0, Math.min(1, relativeToCharacter));
        } else {
          adjustedY = rawY;
        }

        onClickPosition(adjustedY, rawY, rawX);
      } catch (err) {
        console.error('[Live2D] onClickPosition error:', err);
      }
    }
  };

  // === 严重错误（如 WebGL2 不可用）：全屏错误页 ===
  if (error && modelStatus === 'error') {
    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(20,20,40,0.95)',
          padding: '16px',
          gap: '12px',
        }}
      >
        <div style={{ fontSize: '32px', marginBottom: '4px' }}>⚠️</div>
        <div
          style={{
            color: '#f87171',
            fontSize: '13px',
            textAlign: 'center',
            maxWidth: '200px',
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleRetry();
          }}
          style={{
            marginTop: '4px',
            padding: '6px 20px',
            backgroundColor: 'rgba(99,102,241,0.3)',
            border: '1px solid rgba(99,102,241,0.5)',
            borderRadius: '6px',
            color: '#a5b4fc',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', cursor: 'pointer' }}
    >
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />

      {/* 加载中遮罩 */}
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.4)',
            backdropFilter: 'blur(2px)',
            zIndex: 10,
          }}
        >
          {/* 旋转动画 */}
          <div
            style={{
              width: '36px',
              height: '36px',
              border: '3px solid rgba(255,255,255,0.15)',
              borderTopColor: 'rgba(99,102,241,0.8)',
              borderRadius: '50%',
              animation: 'live2d-spin 0.8s linear infinite',
              marginBottom: '12px',
            }}
          />
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '12px', marginBottom: '4px' }}>
            {modelStatus === 'init' ? '正在初始化引擎...' : '正在加载角色模型...'}
          </div>
          {/* 进度条 */}
          <div
            style={{
              width: '120px',
              height: '4px',
              backgroundColor: 'rgba(255,255,255,0.1)',
              borderRadius: '2px',
              overflow: 'hidden',
              marginTop: '8px',
            }}
          >
            <div
              style={{
                width: `${loadingProgress}%`,
                height: '100%',
                backgroundColor: 'rgba(99,102,241,0.7)',
                borderRadius: '2px',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
});
