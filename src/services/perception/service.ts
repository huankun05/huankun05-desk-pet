/**
 * Perception 感知服务
 *
 * 管理与 Python 感知后端的 WebSocket 连接，
 * 提供手势识别、面部追踪等感知能力。
 */

import { createLogger } from '../../utils/logger';
import { eventBus } from '../eventBus';
import { DEFAULT_ENDPOINTS } from '../provider/defaults';
import type {
  PerceptionState,
  PerceptionWSMessage,
  PerceptionCommand,
  HandData,
  FaceData,
  CalibData,
  GestureMappingEntry,
} from './types';

const log = createLogger('PerceptionService');

const DEFAULT_WS_URL = DEFAULT_ENDPOINTS.perception_ws;
const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_INTERVAL_MS = 30000;
const MAX_MISSED_PONGS = 2;
const HEARTBEAT_JITTER_MAX = 1000;

type StateChangeListener = (state: PerceptionState) => void;
type HandDataListener = (hands: HandData[]) => void;
type FaceDataListener = (face: FaceData | null) => void;

export class PerceptionService {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private state: PerceptionState;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedPongs = 0;

  private stateListeners = new Set<StateChangeListener>();
  private handListeners = new Set<HandDataListener>();
  private faceListeners = new Set<FaceDataListener>();

  constructor(wsUrl: string = DEFAULT_WS_URL) {
    this.wsUrl = wsUrl;
    this.state = {
      isConnected: false,
      isRunning: false,
      lastHandData: null,
      lastFaceData: null,
      calib: null,
      gestureMapping: [],
      gestureSamples: {},
      error: null,
    };
  }

  getState(): PerceptionState {
    return { ...this.state };
  }

  subscribeState(listener: StateChangeListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  subscribeHandData(listener: HandDataListener): () => void {
    this.handListeners.add(listener);
    return () => this.handListeners.delete(listener);
  }

  subscribeFaceData(listener: FaceDataListener): () => void {
    this.faceListeners.add(listener);
    return () => this.faceListeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.ws?.readyState === WebSocket.CONNECTING) return;

    this.manualClose = false;
    // 手动重连时重置重连计数，允许在达到上限后再次尝试
    this.reconnectAttempts = 0;
    await this._connect();
  }

  private async _connect(): Promise<void> {
    try {
      log.info(`Connecting to ${this.wsUrl}`);
      const ws = new WebSocket(this.wsUrl);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        log.info('WebSocket connected');
        this.reconnectAttempts = 0;
        this._setState({
          isConnected: true,
          error: null,
        });
        this._startHeartbeat();
      };

      ws.onclose = (e) => {
        log.info(`WebSocket closed: code=${e.code}, reason=${e.reason}`);
        this._stopHeartbeat();
        this.ws = null;
        this._setState({
          isConnected: false,
          isRunning: false,
        });

        if (!this.manualClose) {
          this._scheduleReconnect();
        }
      };

      ws.onerror = (e) => {
        log.error('WebSocket error:', e);
        this._setState({
          error: 'WebSocket connection error',
        });
      };

      ws.onmessage = (e) => {
        // 任何来自服务端的消息都意味着连接存活，重置心跳计数
        this.missedPongs = 0;
        this._handleMessage(e.data);
      };

      this.ws = ws;
    } catch (err) {
      log.error('Failed to create WebSocket:', err);
      this._setState({ error: 'Failed to connect' });
      if (!this.manualClose) {
        this._scheduleReconnect();
      }
    }
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log.error(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`);
      this._setState({
        isConnected: false,
        isRunning: false,
        error: 'Perception service unavailable (max reconnect attempts reached)',
      });
      try {
        eventBus.emit('perception:disconnected', {
          reason: 'max_reconnect_attempts',
          attempts: MAX_RECONNECT_ATTEMPTS,
        });
      } catch (err) {
        log.error('Failed to emit perception:disconnected event:', err);
      }
      return;
    }

    const attempt = this.reconnectAttempts;
    this.reconnectAttempts++;
    const jitter = Math.floor(Math.random() * HEARTBEAT_JITTER_MAX);
    const delay = Math.min(RECONNECT_DELAY * Math.pow(2, attempt) + jitter, MAX_RECONNECT_DELAY);
    log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, delay);
  }

  disconnect(): void {
    this.manualClose = true;
    this._stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._setState({
      isConnected: false,
      isRunning: false,
    });
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this.missedPongs = 0;
    this.heartbeatTimer = setInterval(() => {
      this._sendPing();
      this.missedPongs++;
      if (this.missedPongs >= MAX_MISSED_PONGS) {
        log.warn(`No pong for ${this.missedPongs} consecutive heartbeats, forcing reconnect`);
        // 强制关闭以触发 onclose -> _scheduleReconnect 流程
        try {
          this.ws?.close();
        } catch (err) {
          log.error('Error closing stale WebSocket:', err);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.missedPongs = 0;
  }

  private _sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ type: 'ping' }));
    } catch (err) {
      log.warn('Failed to send ping:', err);
    }
  }

  sendCommand(cmd: PerceptionCommand): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('Cannot send command: not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(cmd));
      return true;
    } catch (err) {
      log.error('Failed to send command:', err);
      return false;
    }
  }

  calibrate(key: string, value: number): boolean {
    return this.sendCommand({ type: 'calibrate', key, value });
  }

  saveCalibration(): boolean {
    return this.sendCommand({ type: 'save_calib' });
  }

  recordGesture(gestureName: string): boolean {
    return this.sendCommand({ type: 'record_gesture', gesture: gestureName });
  }

  clearGestureSamples(gesture?: string): boolean {
    return this.sendCommand({ type: 'clear_gesture_samples', gesture });
  }

  resetFaceBaseline(): boolean {
    return this.sendCommand({ type: 'reset_face_baseline' });
  }

  saveGestureMapping(mapping: GestureMappingEntry[]): boolean {
    return this.sendCommand({ type: 'save_gesture_mapping', mapping });
  }

  private _handleMessage(data: string | ArrayBuffer): void {
    if (data instanceof ArrayBuffer) {
      return;
    }

    try {
      const msg = JSON.parse(data) as PerceptionWSMessage;

      switch (msg.type) {
        case 'hand_data':
          this._handleHandData(msg.hands as HandData[]);
          break;
        case 'face_data':
          this._handleFaceData(msg.face as FaceData | null);
          break;
        case 'calib_data':
          this._handleCalibData(msg.calib as CalibData);
          break;
        case 'gesture_mapping_data':
          this._handleGestureMapping(msg.mapping as GestureMappingEntry[]);
          break;
        case 'gesture_samples_data':
          this._handleGestureSamples(msg.counts as Record<string, number>);
          break;
        default:
          break;
      }
    } catch (err) {
      log.warn('Failed to parse message:', err);
    }
  }

  private _handleHandData(hands: HandData[]): void {
    this._setState({ lastHandData: hands, isRunning: true });
    this.handListeners.forEach((fn) => {
      try {
        fn(hands);
      } catch (err) {
        log.error('Hand data listener error:', err);
      }
    });
  }

  private _handleFaceData(face: FaceData | null): void {
    this._setState({ lastFaceData: face });
    this.faceListeners.forEach((fn) => {
      try {
        fn(face);
      } catch (err) {
        log.error('Face data listener error:', err);
      }
    });
  }

  private _handleCalibData(calib: CalibData): void {
    this._setState({ calib });
  }

  private _handleGestureMapping(mapping: GestureMappingEntry[]): void {
    this._setState({ gestureMapping: mapping });
  }

  private _handleGestureSamples(counts: Record<string, number>): void {
    this._setState({ gestureSamples: counts });
  }

  private _setState(partial: Partial<PerceptionState>): void {
    this.state = { ...this.state, ...partial };
    this.stateListeners.forEach((fn) => {
      try {
        fn(this.state);
      } catch (err) {
        log.error('State listener error:', err);
      }
    });
  }
}

export const perceptionService = new PerceptionService();
