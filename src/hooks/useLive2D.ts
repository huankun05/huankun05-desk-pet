import { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { isTauriEnv } from '../utils/tauriEnv';
import {
  initLive2D,
  loadModelFromPath,
  setExpression,
  triggerTapMotion,
  triggerAnimation,
  setParameterOverride,
  destroyLive2D,
  setFocusNormalized,
  setZoomFactor,
  setFeetOffset,
  setModelWidthRatio,
  setModelCanvasSize,
  setBaseViewportAspect,
  getModelInfo,
  setModelLoadCallbacks,
  setIdleState,
  setMaxFps,
  getRenderStats,
  setMouseSensitivity,
} from '../lib/live2d';
import { getWarmedContext } from '../hooks/useSplashInit';
import { eventBus } from '../services/eventBus';
import { FPS_TIERS } from '../settings/appearanceConfig';
import {
  getModelKey,
  resolveVisualForModel,
} from '../services/live2d/visualMapping';

interface UseLive2DOptions {
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
  /** 角色被隐藏时暂停渲染（降到 1fps），避免不可见时仍满帧绘制 WebGL */
  renderPaused?: boolean;
  /** 目标帧率上限；0 = 不限制（跟随屏幕刷新率） */
  targetFps?: number;
  /** 是否根据设备实际负载自动下调帧率（不会超过 targetFps） */
  adaptiveFps?: boolean;
  onModelLoaded?: (info: { canvasWidth: number; canvasHeight: number }) => void;
}

export type ModelStatus = 'init' | 'loading' | 'ready' | 'error';

interface UseLive2DResult {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isLoading: boolean;
  modelStatus: ModelStatus;
  error: string | null;
  handleClick: () => void;
  handleRetry: () => void;
  isIdle: boolean;
}

// 待机时随机播放的表情池（按模型区分；空串 '' = 基础态）
// nahida 含全部 12 烘焙表情 + 4 个合成新脸，待机时轮换更丰富
const IDLE_EXPRESSIONS_BY_MODEL: Record<string, string[]> = {
  nahida: ['', 'HandChange', 'Kusa', 'Wink', 'Shy', 'Speechless', 'Proud', 'Wronged', 'ThinkHard'],
  hiyori: [''],
};
const _IDLE_ANIM_INTERVAL = 8000;

const MODEL_LOAD_TIMEOUT = 15000; // 模型加载超时 15 秒

/**
 * Live2D Hook — 窗口内追踪 + 锁定时 Rust 追踪 + 待机検出
 */
export function useLive2D({
  modelPath,
  emotion = 'default',
  zoomFactor = 1.0,
  feetOffset = 0,
  modelWidthRatio = 1.0,
  baseViewportAspect = 0,
  modelCanvasW = 0,
  modelCanvasH = 0,
  energy = 0.7,
  expressionMap: customMap,
  idleExpressions: customIdle,
  idleTimeout = 5,
  mouseSensitivity = 1.0,
  renderPaused = false,
  targetFps = 60,
  adaptiveFps = true,
  onModelLoaded,
}: UseLive2DOptions): UseLive2DResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('init');
  const [error, setError] = useState<string | null>(null);
  const [isIdle, setIsIdle] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const initializedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelStatusRef = useRef<ModelStatus>('init');

  const isLoading = modelStatus !== 'ready' && modelStatus !== 'error';

  // 由模型路径推导模型 key，决定「情绪 → 表情 / 动作」的映射表
  const modelKey = getModelKey(modelPath);

  // 同步 modelStatus 到 ref（供 timeout 回调使用，避免闭包过期）
  useEffect(() => {
    modelStatusRef.current = modelStatus;
  }, [modelStatus]);

  // 清理超时
  const clearLoadTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // 初始化 — useLayoutEffect 在浏览器绘制前同步触发，比 useEffect 早一帧
  // 用 setTimeout(0) 跳过 StrictMode 第一次挂载的同步清理
  // StrictMode: mount1 → cleanup(clearTimer) → mount2 → timer fires → init ✓
  // 生产环境: mount → timer fires → init → unmount → cleanup(destroy) ✓
  useLayoutEffect(() => {
    const timer = setTimeout(() => {
      if (!canvasRef.current) return;
      if (initializedRef.current) return;

      const canvas = canvasRef.current;
      performance.mark('live2d-init-start');

      // === Canvas 尺寸验证 ===
      if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
        let retryTimer: ReturnType<typeof setTimeout>;
        const check = () => {
          if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
            doInit(canvas);
          } else {
            retryTimer = setTimeout(check, 200);
          }
        };
        retryTimer = setTimeout(check, 200);
        return () => clearTimeout(retryTimer);
      }

      doInit(canvas);
    }, 0);

    const doInit = (canvas: HTMLCanvasElement) => {
      // 只有在初始化成功后才标记已初始化
      initializedRef.current = true;

      const success = initLive2D(canvas, getWarmedContext());
      if (!success) {
        initializedRef.current = false;
        setError('WebGL2 初始化失败 — 请确认显卡驱动已安装且硬件加速已开启');
        setModelStatus('error');
        return;
      }

      // 注册模型加载回调
      setModelLoadCallbacks(
        () => {
          // 模型加载成功
          clearLoadTimeout();
          setModelStatus('ready');
          setError(null);
          performance.mark('live2d-ready');
          // 隐藏首屏加载遮罩（index.html 中的 #app-loading）
          const splash = document.getElementById('app-loading');
          if (splash) {
            splash.classList.add('hidden');
            setTimeout(() => splash.remove(), 500);
          }
        },
        (errMsg: string) => {
          // 模型加载失败
          clearLoadTimeout();
          setError(errMsg);
          setModelStatus('error');
          performance.mark('live2d-error');
          // 同样移除首屏遮罩，露出下方 React 渲染的错误页
          const splash = document.getElementById('app-loading');
          if (splash) {
            splash.classList.add('hidden');
            setTimeout(() => splash.remove(), 500);
          }
        },
      );

      // 开始加载模型
      setModelStatus('loading');
      loadModelFromPath(modelPath);

      // 设置超时
      clearLoadTimeout();
      timeoutRef.current = setTimeout(() => {
        if (modelStatusRef.current === 'loading') {
          setError('模型加载超时 — 请检查模型文件是否完整或查看控制台错误信息');
          setModelStatus('error');
          setModelLoadCallbacks(null, null); // 清理回调，防止超时后回调再触发
        }
      }, MODEL_LOAD_TIMEOUT);
    };

    return () => {
      clearTimeout(timer);
      clearLoadTimeout();
      // 只在确实初始化过后才销毁
      if (initializedRef.current) {
        initializedRef.current = false;
        destroyLive2D();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelPath, retryCount]);

  // 模型加载检测：轮询 getModelInfo 直到模型就绪，回调通知上层
  useEffect(() => {
    if (isLoading) return;
    if (!onModelLoaded) return;

    let checkId: number;
    let reported = false;
    const check = () => {
      if (reported) return;
      const info = getModelInfo();
      if (info) {
        reported = true;
        onModelLoaded(info);
      } else {
        checkId = requestAnimationFrame(check);
      }
    };
    checkId = requestAnimationFrame(check);
    return () => cancelAnimationFrame(checkId);
  }, [isLoading, onModelLoaded]);

  // 情绪 → 视觉：先按模型解析出表情与动作，再落地
  const lastExpressionRef = useRef('Default');
  useEffect(() => {
    if (isLoading) return;
    // emotion 由 MainPetApp 直传 EmotionType；resolveVisualForModel 按模型选映射
    const resolved = resolveVisualForModel(emotion, modelKey);
    // 用户自定义映射（emotionState.expressionMap）作为覆盖层
    const customExpr = customMap && customMap[emotion];
    const expr = customExpr ?? resolved.expression ?? '';
    lastExpressionRef.current = expr;
    setExpression(expr);
    // 情绪 → 身体动作：仅对带动作的模型生效（如 hiyori）；nahida 无动作则 motion 为 null
    if (resolved.motion) {
      triggerAnimation(resolved.motion, 3000);
    }
  }, [emotion, isLoading, customMap, modelKey]);

  // ===== eventBus 订阅：接收 BehaviorDecorateStage 发出的视觉装饰事件 =====
  useEffect(() => {
    if (isLoading) return;

    const offExpr = eventBus.on('expression:change', (payload) => {
      if (payload.expression) setExpression(payload.expression);
      lastExpressionRef.current = payload.expression;
    });

    const offParam = eventBus.on('param:update', (payload) => {
      setParameterOverride(payload.key, payload.value, 3000);
    });

    const offAnim = eventBus.on('animation:trigger', (payload) => {
      triggerAnimation(payload.name, payload.duration);
    });

    return () => {
      offExpr();
      offParam();
      offAnim();
    };
  }, [isLoading]);

  // 待机随机表情：idle/sleepy 时随机播放（按模型选池）
  const idleTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (isLoading) return;
    if (idleTimerRef.current) clearInterval(idleTimerRef.current);

    if (emotion === 'idle' || emotion === 'sleepy') {
      const pool =
        customIdle && customIdle.length > 0
          ? customIdle
          : IDLE_EXPRESSIONS_BY_MODEL[modelKey] ?? [''];
      // 活力值越高 → 待机动画切换越快（6s ~ 12s）
      const interval = 12000 - energy * 6000;
      idleTimerRef.current = window.setInterval(() => {
        const rand = pool[Math.floor(Math.random() * pool.length)];
        setExpression(rand);
      }, interval);
    }

    return () => {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, [emotion, isLoading, customIdle, energy, modelKey]);

  // 缩放因子：窗口触底时角色按比例缩小
  useEffect(() => {
    if (isLoading) return;
    setZoomFactor(zoomFactor);
  }, [zoomFactor, isLoading]);

  // 脚部偏移：补偿模型脚底留白
  useEffect(() => {
    if (isLoading) return;
    setFeetOffset(feetOffset);
  }, [feetOffset, isLoading]);

  // 横向拉伸
  useEffect(() => {
    if (isLoading) return;
    setModelWidthRatio(modelWidthRatio);
  }, [modelWidthRatio, isLoading]);

  // 鼠标跟随灵敏度
  useEffect(() => {
    if (isLoading) return;
    setMouseSensitivity(mouseSensitivity);
  }, [mouseSensitivity, isLoading]);

  // 基准 viewport 宽高比（用于缩放比例补偿）
  useEffect(() => {
    if (isLoading) return;
    if (baseViewportAspect > 0) {
      setBaseViewportAspect(baseViewportAspect);
    }
  }, [baseViewportAspect, isLoading]);

  // 模型 canvas 尺寸（从 model3.json 读取，替代有 bug 的 getCanvasWidth/Height）
  useEffect(() => {
    if (modelCanvasW > 0 && modelCanvasH > 0) {
      setModelCanvasSize(modelCanvasW, modelCanvasH);
    }
  }, [modelCanvasW, modelCanvasH, isLoading]);

  // マウス追跡：本地 mousemove 事件驱动（补充路径）
  // 注意：全局光标跟踪由 PerceptionFallback（services/perception/fallback.ts）统一负责——
  // 它在 Tauri 下每 50ms 调 get_cursor_window_info（Windows GetCursorPos 全局坐标），
  // 计算光标相对窗口中心的方向并写 setFocusFromCss，且不受 idle 门控。
  // 这里不再重复 IPC 轮询，避免两套系统轮流写 setFocusFromCss 互相打架。
  // 监听器不依赖 isLoading —— 只要画布存在就挂上，避免模型加载状态卡住导致
  // 鼠标监听永远不挂载（那样眼动/鼠标跟随会整体失效，但宠物仍在渲染）。
  useEffect(() => {
    if (!canvasRef.current) return;

    let lastMoveTime = Date.now();
    let idleState = false;
    let idleCheckId = 0;

    // 重置 idle 计时器（不碰表情，表情由 emotion prop 驱动）
    const markActive = () => {
      lastMoveTime = Date.now();
      if (idleState) {
        idleState = false;
        setIsIdle(false);
        setIdleState(false); // 通知 Live2D 退出 idle（_idleBlend 会平滑过渡回鼠标追踪）
      }
    };

    // 本地路径：鼠标在窗口自身范围内移动时直接驱动（桌面宠物多为穿透窗口，
    // 此事件较少触发，作为 PerceptionFallback 全局跟踪的补充，不冲突）。
    // 关键：映射成窗口内归一化坐标（右正、下正，范围 [-1,1]）直接驱动 DragManager，
    // 不再走 setFocusFromCss 的 transformView 管线——后者在竖屏窄窗口下会把 X 映射成
    // 非线性、左右不对称（表现为"向右跟手、向左不跟"）。
    const onMouseMove = (e: MouseEvent) => {
      markActive();
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
          setFocusNormalized(nx, ny);
          return;
        }
      }
      // 兜底：画布不可用时回到中心
      setFocusNormalized(0, 0);
    };

    // idle 检测：进入待机后由 Live2D 启动眼跳等微动（不再阻断光标跟随）
    const idleTimeoutMs = idleTimeout * 1000;
    const checkIdle = () => {
      if (!idleState && Date.now() - lastMoveTime > idleTimeoutMs) {
        idleState = true;
        setIsIdle(true);
        setIdleState(true); // 通知 Live2D 进入 idle（启动眼跳）
      }
    };
    idleCheckId = window.setInterval(checkIdle, 1000);

    // 启动监听
    window.addEventListener('mousemove', onMouseMove);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      if (idleCheckId) clearInterval(idleCheckId);
    };
  }, [idleTimeout]);

  // 自适应当前降到的档位（null = 未降档，按用户设定的 targetFps 运行）
  const adaptiveTierRef = useRef<number | null>(null);
  // 连续命中计数，避免在阈值临界点反复升降
  const adaptiveHitsRef = useRef({ down: 0, up: 0 });

  // 帧率调度：角色隐藏 > 窗口后台 > 性能自适应 > 用户设定上限
  //（统一在一处计算，避免多来源分别调用 setMaxFps 互相覆盖）
  useEffect(() => {
    if (isLoading) return;
    if (!isTauriEnv()) return;

    // 自适应可选档位：只在用户设定上限之下浮动（0 = 不限制，以 60 作为自适应基准）
    const ceiling = targetFps > 0 ? targetFps : 60;
    const tiers: number[] = FPS_TIERS.filter((f) => f <= ceiling) as number[];
    const lowest = tiers.length > 0 ? tiers[tiers.length - 1] : ceiling;

    // 配置变化时重置自适应状态，避免沿用旧上限下算出的档位
    adaptiveTierRef.current = null;
    adaptiveHitsRef.current = { down: 0, up: 0 };

    const applyFps = () => {
      if (renderPaused) {
        setMaxFps(1); // 角色隐藏：降到 1fps（保留上下文与模型，恢复时无需重载）
      } else if (document.hidden) {
        setMaxFps(5); // 窗口后台：降到 5fps
      } else {
        const tier = adaptiveTierRef.current;
        setMaxFps(tier !== null ? Math.min(tier, ceiling) : targetFps);
      }
    };

    applyFps();
    document.addEventListener('visibilitychange', applyFps);

    // 性能自适应：以「单帧绘制耗时」而非「达成帧率」为判据。
    // 达成帧率本身被我们设的上限约束，用它判断会陷入自证循环（限到 30 就永远看到 30）；
    // 绘制耗时反映设备真实负载，与上限无关。
    let sampler: ReturnType<typeof setInterval> | undefined;
    if (adaptiveFps) {
      sampler = setInterval(() => {
        // 隐藏/后台时本就在刻意降频，此时的采样没有参考价值
        if (renderPaused || document.hidden) return;
        const { renderCostMs } = getRenderStats();
        if (renderCostMs <= 0) return;

        const current = adaptiveTierRef.current ?? ceiling;
        const idx = tiers.indexOf(current);
        const hits = adaptiveHitsRef.current;

        if (renderCostMs > (1000 / current) * 0.7) {
          // 单帧就吃掉七成预算 → 已经跟不上，连续 2 次确认后降一档
          hits.up = 0;
          hits.down += 1;
          if (hits.down >= 2) {
            hits.down = 0;
            const next = idx >= 0 && idx < tiers.length - 1 ? tiers[idx + 1] : lowest;
            if (next !== current) {
              adaptiveTierRef.current = next;
              applyFps();
            }
          }
          return;
        }

        const higher = idx > 0 ? tiers[idx - 1] : null;
        // 回升更保守：需连续 3 次且开销远低于上一档预算，避免临界点反复横跳
        if (higher !== null && renderCostMs < (1000 / higher) * 0.4) {
          hits.down = 0;
          hits.up += 1;
          if (hits.up >= 3) {
            hits.up = 0;
            // 回到用户上限即视为未降档，交还 targetFps 原值（可能是 0 = 不限制）
            adaptiveTierRef.current = higher === ceiling ? null : higher;
            applyFps();
          }
        } else {
          hits.down = 0;
          hits.up = 0;
        }
      }, 2000);
    }

    return () => {
      document.removeEventListener('visibilitychange', applyFps);
      if (sampler) clearInterval(sampler);
      setMaxFps(0); // 清理时恢复
    };
  }, [isLoading, renderPaused, targetFps, adaptiveFps]);

  const handleClick = useCallback(() => {
    triggerTapMotion();
  }, []);

  // 重试：增加 retryCount 触发 effect 重新执行（销毁 + 重建）
  const handleRetry = useCallback(() => {
    // 先销毁现有
    if (initializedRef.current) {
      initializedRef.current = false;
      destroyLive2D();
    }
    setError(null);
    setModelStatus('init');
    setRetryCount((c) => c + 1);
  }, []);

  return { canvasRef, isLoading, modelStatus, error, handleClick, handleRetry, isIdle };
}
