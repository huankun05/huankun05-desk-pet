/**
 * Service Watchdog — monitors critical backend services and triggers restarts.
 *
 * Watches Core API (9877) and Perception (8765). When a service is down,
 * emits events for restart attempts and tracks recovery state.
 */

import { createLogger } from '../../utils/logger';
import { eventBus } from '../eventBus';
import { settingsStorage } from '../storage/settingsStorage';

const log = createLogger('ServiceWatchdog');

export interface ServiceHealth {
  name: string;
  port: number;
  healthy: boolean;
  lastChecked: number;
  failureCount: number;
  maxFailures: number;
  cooldownMs: number;
  lastCooldown: number;
}

export interface WatchdogState {
  services: Map<string, ServiceHealth>;
  isRunning: boolean;
  checkIntervalMs: number;
}

export function isWatchdogEnabled(): boolean {
  try {
    return settingsStorage.get().watchdogEnabled !== false;
  } catch {
    return true;
  }
}

export function isOfflineModeEnabled(): boolean {
  try {
    return settingsStorage.get().offlineMode === true;
  } catch {
    return false;
  }
}

export const WATCHDOG_STATE: WatchdogState = {
  services: new Map(),
  isRunning: false,
  checkIntervalMs: 30_000,
};

let watchdogTimer: ReturnType<typeof setInterval> | null = null;

const DEFAULT_MAX_FAILURES = 3;
const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Register a service to watch.
 */
export function registerService(
  name: string,
  port: number,
  options?: {
    maxFailures?: number;
    cooldownMs?: number;
  },
): void {
  WATCHDOG_STATE.services.set(name, {
    name,
    port,
    healthy: true,
    lastChecked: 0,
    failureCount: 0,
    maxFailures: options?.maxFailures ?? DEFAULT_MAX_FAILURES,
    cooldownMs: options?.cooldownMs ?? DEFAULT_COOLDOWN_MS,
    lastCooldown: 0,
  });
  log.info('Service registered for watch', { name, port });
}

/**
 * Remove a service from watch.
 */
export function unregisterService(name: string): void {
  WATCHDOG_STATE.services.delete(name);
}

/**
 * Check a single service health via HTTP health endpoint.
 */
export async function checkServiceHealth(name: string): Promise<boolean> {
  const service = WATCHDOG_STATE.services.get(name);
  if (!service) return false;

  service.lastChecked = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://127.0.0.1:${service.port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    const isHealthy = res.ok;
    service.healthy = isHealthy;

    if (isHealthy) {
      if (service.failureCount > 0) {
        log.info('Service recovered', { name, port: service.port });
        eventBus.emit('service:recovered', { name, port: service.port });
      }
      service.failureCount = 0;
      return true;
    }

    service.failureCount++;
    log.warn('Service unhealthy', {
      name,
      port: service.port,
      status: res.status,
      failureCount: service.failureCount,
    });

    return false;
  } catch (err) {
    service.healthy = false;
    service.failureCount++;
    log.warn('Service check failed', {
      name,
      port: service.port,
      error: String(err),
      failureCount: service.failureCount,
    });

    return false;
  }
}

/**
 * Attempt to restart a service via Tauri invoke or eventBus.
 */
export async function restartService(name: string): Promise<boolean> {
  const service = WATCHDOG_STATE.services.get(name);
  if (!service) return false;

  // Cooldown check
  const now = Date.now();
  if (now - service.lastCooldown < service.cooldownMs) {
    log.debug('Restart in cooldown', {
      name,
      cooldownRemaining: service.cooldownMs - (now - service.lastCooldown),
    });
    return false;
  }

  service.lastCooldown = now;
  log.info('Requesting service restart', { name, port: service.port });

  try {
    // Emit event for UI/Rust to handle restart
    eventBus.emit('service:restart:request', { name, port: service.port });

    // Wait a bit for restart to take effect
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify restart
    const healthy = await checkServiceHealth(name);
    if (healthy) {
      log.info('Service restart succeeded', { name });
      eventBus.emit('service:restarted', { name, port: service.port });
    } else {
      log.warn('Service restart failed', { name });
    }

    return healthy;
  } catch (err) {
    log.error('Service restart error', { name, error: String(err) });
    return false;
  }
}

/**
 * Start the watchdog loop.
 */
export function startWatchdog(checkIntervalMs = WATCHDOG_STATE.checkIntervalMs): () => void {
  if (WATCHDOG_STATE.isRunning) {
    log.warn('Watchdog already running');
    return () => {};
  }

  WATCHDOG_STATE.isRunning = true;
  WATCHDOG_STATE.checkIntervalMs = checkIntervalMs;

  log.info('Watchdog started', { intervalMs: checkIntervalMs });

  watchdogTimer = setInterval(async () => {
    for (const [name, service] of WATCHDOG_STATE.services.entries()) {
      const healthy = await checkServiceHealth(name);

      if (!healthy && service.failureCount >= service.maxFailures) {
        log.warn('Max failures reached, attempting restart', {
          name,
          port: service.port,
          failureCount: service.failureCount,
        });
        eventBus.emit('service:unhealthy', {
          name,
          port: service.port,
          failureCount: service.failureCount,
        });
        void restartService(name);
      }
    }
  }, checkIntervalMs);

  return () => {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
    WATCHDOG_STATE.isRunning = false;
    log.info('Watchdog stopped');
  };
}

/**
 * Stop the watchdog.
 */
export function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  WATCHDOG_STATE.isRunning = false;
  log.info('Watchdog stopped');
}

/**
 * Get health status of all watched services.
 */
export function getWatchdogStatus(): Record<string, ServiceHealth> {
  const result: Record<string, ServiceHealth> = {};
  for (const [name, service] of WATCHDOG_STATE.services.entries()) {
    result[name] = { ...service };
  }
  return result;
}
