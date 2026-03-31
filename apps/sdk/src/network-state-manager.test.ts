/**
 * Unit tests for NetworkStateManager (task 10.1)
 * Validates Requirements 10.1
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NetworkStateManager } from './network-state-manager';

function setupBrowserEnv(onLine: boolean) {
  const listeners: Record<string, Array<() => void>> = {};

  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine },
    writable: true,
    configurable: true,
  });

  Object.defineProperty(globalThis, 'window', {
    value: {
      addEventListener: vi.fn((event: string, handler: () => void) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: () => void) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((h) => h !== handler);
        }
      }),
    },
    writable: true,
    configurable: true,
  });

  return {
    triggerOnline: () => listeners['online']?.forEach((h) => h()),
    triggerOffline: () => listeners['offline']?.forEach((h) => h()),
  };
}

describe('NetworkStateManager — initial state', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reflects navigator.onLine = true on construction', () => {
    setupBrowserEnv(true);
    const mgr = new NetworkStateManager({ checkInterval: 0 });
    expect(mgr.isOnline).toBe(true);
    mgr.destroy();
  });

  it('reflects navigator.onLine = false on construction', () => {
    setupBrowserEnv(false);
    const mgr = new NetworkStateManager({ checkInterval: 0 });
    expect(mgr.isOnline).toBe(false);
    mgr.destroy();
  });

  it('defaults to true when navigator is unavailable (SSR)', () => {
    const origNavigator = globalThis.navigator;
    const origWindow = (globalThis as any).window;
    // @ts-ignore intentional
    delete globalThis.navigator;
    // @ts-ignore intentional
    delete (globalThis as any).window;

    const mgr = new NetworkStateManager({ checkInterval: 0 });
    expect(mgr.isOnline).toBe(true);
    mgr.destroy();

    Object.defineProperty(globalThis, 'navigator', { value: origNavigator, writable: true, configurable: true });
    Object.defineProperty(globalThis, 'window', { value: origWindow, writable: true, configurable: true });
  });
});

describe('NetworkStateManager — window event listeners', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('transitions to online when the "online" window event fires', () => {
    const { triggerOnline } = setupBrowserEnv(false);
    const mgr = new NetworkStateManager({ checkInterval: 0 });
    expect(mgr.isOnline).toBe(false);
    triggerOnline();
    expect(mgr.isOnline).toBe(true);
    mgr.destroy();
  });

  it('transitions to offline when the "offline" window event fires', () => {
    const { triggerOffline } = setupBrowserEnv(true);
    const mgr = new NetworkStateManager({ checkInterval: 0 });
    expect(mgr.isOnline).toBe(true);
    triggerOffline();
    expect(mgr.isOnline).toBe(false);
    mgr.destroy();
  });

  it('registers event listeners on window during construction', () => {
    setupBrowserEnv(true);
    const mgr = new NetworkStateManager({ checkInterval: 0 });
    expect(window.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
    expect(window.addEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
    mgr.destroy();
  });
});

describe('NetworkStateManager — subscribe / unsubscribe', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('notifies subscriber when state changes to online', () => {
    const { triggerOnline } = setupBrowserEnv(false);
    const mgr = new NetworkStateManager({ checkInterval: 0 });
    const calls: boolean[] = [];
    mgr.subscribe((online) => calls.push(online));
    triggerOnline();
    expect(calls).toEqual([true]);
    mgr.destroy();
  });

  it('notifies subscriber when state changes to offline', () => {
    const { triggerOffline } = setupBrowserEnv(true);
    const mgr = new NetworkStateManager({ checkInterval: 0 });
    const calls: boolean[] = [];
    mgr.subscribe((online) => calls.push(online));
    triggerOffline();
    expect(calls).toEqual([false]);
    mgr.destroy();
  });

  it('does NOT notify subscriber when state does not change', () => {
    const { triggerOnline } = setupBrowserEnv(true);
    const mgr = new NetworkStateManager({ checkInterval: 0 });
    const calls: boolean[] = [];
    mgr.subscribe((online) => calls.push(online));
    triggerOnline(); // already online — no-op
    expect(calls).toHaveLength(0);
    mgr.destroy();
  });

  it('unsubscribe function stops future notifications', () => {
    const { triggerOnline, triggerOffline } = setupBrowserEnv(false);
    const mgr = new NetworkStateManager({ checkInterval: 0 });
    const calls: boolean[] = [];
    const unsubscribe = mgr.subscribe((online) => calls.push(online));
    triggerOnline();
    unsubscribe();
    triggerOffline();
    expect(calls).toEqual([true]);
    mgr.destroy();
  });

  it('supports multiple subscribers', () => {
    const { triggerOnline } = setupBrowserEnv(false);
    const mgr = new NetworkStateManager({ checkInterval: 0 });
    const calls1: boolean[] = [];
    const calls2: boolean[] = [];
    mgr.subscribe((v) => calls1.push(v));
    mgr.subscribe((v) => calls2.push(v));
    triggerOnline();
    expect(calls1).toEqual([true]);
    expect(calls2).toEqual([true]);
    mgr.destroy();
  });
});

describe('NetworkStateManager — fallback connectivity check', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('performs a HEAD request to the health URL on each interval tick', async () => {
    setupBrowserEnv(true);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    const mgr = new NetworkStateManager({ healthCheckUrl: '/health', checkInterval: 10_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledWith('/health', { method: 'HEAD' });
    mgr.destroy();
  });

  it('sets online=false when the health check request throws', async () => {
    setupBrowserEnv(true);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const mgr = new NetworkStateManager({ healthCheckUrl: '/health', checkInterval: 10_000 });
    const calls: boolean[] = [];
    mgr.subscribe((v) => calls.push(v));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mgr.isOnline).toBe(false);
    expect(calls).toEqual([false]);
    mgr.destroy();
  });

  it('sets online=false when the health check returns a non-ok response', async () => {
    setupBrowserEnv(true);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
    const mgr = new NetworkStateManager({ healthCheckUrl: '/health', checkInterval: 10_000 });
    const calls: boolean[] = [];
    mgr.subscribe((v) => calls.push(v));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mgr.isOnline).toBe(false);
    expect(calls).toEqual([false]);
    mgr.destroy();
  });

  it('does not start a timer when checkInterval is 0', async () => {
    setupBrowserEnv(true);
    globalThis.fetch = vi.fn();
    const mgr = new NetworkStateManager({ checkInterval: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).not.toHaveBeenCalled();
    mgr.destroy();
  });

  it('uses a custom healthCheckUrl when provided', async () => {
    setupBrowserEnv(true);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    const mgr = new NetworkStateManager({ healthCheckUrl: '/api/ping', checkInterval: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetch).toHaveBeenCalledWith('/api/ping', { method: 'HEAD' });
    mgr.destroy();
  });
});

describe('NetworkStateManager — destroy()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes window event listeners on destroy', () => {
    setupBrowserEnv(true);
    const mgr = new NetworkStateManager({ checkInterval: 0 });
    mgr.destroy();
    expect(window.removeEventListener).toHaveBeenCalledWith('online', expect.any(Function));
    expect(window.removeEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
  });

  it('clears all subscribers on destroy so they no longer receive events', () => {
    const { triggerOnline } = setupBrowserEnv(false);
    const mgr = new NetworkStateManager({ checkInterval: 0 });
    const calls: boolean[] = [];
    mgr.subscribe((v) => calls.push(v));
    mgr.destroy();
    triggerOnline();
    expect(calls).toHaveLength(0);
  });
});
