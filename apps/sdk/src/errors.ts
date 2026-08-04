/**
 * Explicit retriable vs non-retriable error categorization.
 *
 * The SDK uses `SyncError` (with a readonly `retriable` flag) instead of the
 * previous ad-hoc `(err as any).nonRetriable = true` convention so the sync
 * engine can decide whether to retry an operation (transient failure) or
 * permanently fail it (e.g. validation errors that will never succeed).
 */

export class SyncError extends Error {
  /** Whether the underlying failure may succeed on a later attempt. */
  readonly retriable: boolean;

  constructor(message: string, retriable = true) {
    super(message);
    this.name = 'SyncError';
    this.retriable = retriable;
  }
}

/**
 * Returns whether an HTTP status should be retried by the sync engine.
 * - 5xx are transient server failures → retriable
 * - 408 (timeout) and 429 (rate-limit) are transient → retriable
 * - all other 4xx are client errors that will not succeed on retry → non-retriable
 */
export function isRetriableStatus(status: number): boolean {
  if (status >= 500) return true;
  if (status === 408 || status === 429) return true;
  return false;
}

/**
 * Classifies a fetch Response status into a SyncError.
 */
export function classifyResponseError(
  status: number,
  message = `Request failed with status ${status}`
): SyncError {
  return new SyncError(message, isRetriableStatus(status));
}

/**
 * Wraps an arbitrary thrown value (e.g. from a rejected `fetch`) into a
 * SyncError. Network failures surface as `TypeError` and are retriable, as are
 * any unknown errors (defaulting to `retriable: true` to avoid permanently
 * losing operations on ambiguous failures).
 */
export function wrapError(error: unknown): SyncError {
  if (error instanceof SyncError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SyncError(message);
}
