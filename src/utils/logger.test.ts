import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLogger, setLogLevel, getLogLevel } from './logger';

// Mock fetch for sendToBackendLog
(globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(() =>
  Promise.resolve(new Response(null, { status: 200 })),
);

beforeEach(() => {
  setLogLevel('info');
  vi.clearAllMocks();
});

describe('createLogger', () => {
  it('creates a logger with a name prefix', () => {
    const logger = createLogger('Test');
    expect(logger).toBeDefined();
    expect(logger.debug).toBeInstanceOf(Function);
    expect(logger.info).toBeInstanceOf(Function);
    expect(logger.warn).toBeInstanceOf(Function);
    expect(logger.error).toBeInstanceOf(Function);
  });

  it('respects log level - info suppresses debug', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const logger = createLogger('Test');
    logger.debug('should not log');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('allows debug when level is debug', () => {
    setLogLevel('debug');
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const logger = createLogger('Test');
    logger.debug('should log');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('suppresses all output at silent level', () => {
    setLogLevel('silent');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = createLogger('Test');
    logger.debug('x');
    logger.warn('y');
    expect(debugSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    debugSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('warn level includes error but not info', () => {
    setLogLevel('warn');
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('Test');
    logger.info('x');
    logger.warn('y');
    logger.error('z');
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('verbose level sends info logs to backend', () => {
    setLogLevel('verbose');
    const logger = createLogger('Test');
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    logger.info('test message');
    expect((globalThis as unknown as { fetch: typeof fetch }).fetch).toHaveBeenCalledWith(
      '/api/log',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});

describe('setLogLevel / getLogLevel', () => {
  it('returns current log level', () => {
    setLogLevel('error');
    expect(getLogLevel()).toBe('error');
    setLogLevel('debug');
    expect(getLogLevel()).toBe('debug');
  });

  it('default level is info', () => {
    setLogLevel('info');
    expect(getLogLevel()).toBe('info');
  });
});
