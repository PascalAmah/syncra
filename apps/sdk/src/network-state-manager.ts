/**
 * NetworkStateManager — monitors network connectivity for the Syncra SDK.
 *
 * Uses navigator.onLine + online/offline window events as the primary signal,
 * with an optional periodic HEAD request to a health endpoint as a fallback.
 *
 * Requirements: 10.1
 */

export interface NetworkStateManagerOptions {
  /** URL to HEAD for fallback connectivity check. Defaults to '/health'. */
  healthCheckUrl?: string;
  /**
   * Interval in milliseconds between fallback connectivity checks.
   * Set to 0 to disable the periodic check. Defaults to 10000 (10 s).
   */
  checkInterval?: number;
}

export class NetworkStateManager {
  private _isOnline: boolean;
  private readonly listeners: Set<(online: boolean) => void> = new Set();
  private readonly healthCheckUrl: string;
  private readonly checkInterval: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  // Bound handlers so we can remove them in destroy()
  private readonly onOnline: () => void;
  private readonly onOffline: () => void;

  constructor(options: NetworkStateManagerOptions = {}) {
    this.healthCheckUrl = options.healthCheckUrl ?? '/health';
    this.checkInterval = options.checkInterval ?? 10_000;

    // SSR safety: default to true when navigator is unavailable
    this._isOnline =
      typeof navigator !== 'undefined' ? navigator.onLine : true;

    this.onOnline = () => this.setOnline(true);
    this.onOffline = () => this.setOnline(false);

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }

    if (this.checkInterval > 0) {
      this.intervalId = setInterval(
        () => this.checkConnectivity(),
        this.checkInterval,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Current network state. */
  get isOnline(): boolean {
    return this._isOnline;
  }

  /**
   * Subscribe to network state changes.
   * @returns An unsubscribe function.
   */
  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Clean up event listeners and the periodic timer.
   * Call this when the SDK is torn down to avoid memory leaks.
   */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Performs a HEAD request to the health endpoint to verify connectivity. */
  private async checkConnectivity(): Promise<void> {
    try {
      const response = await fetch(this.healthCheckUrl, { method: 'HEAD' });
      this.setOnline(response.ok);
    } catch {
      this.setOnline(false);
    }
  }

  /** Updates the online state and notifies listeners only when it changes. */
  private setOnline(online: boolean): void {
    if (this._isOnline !== online) {
      this._isOnline = online;
      this.listeners.forEach((listener) => listener(online));
    }
  }
}
