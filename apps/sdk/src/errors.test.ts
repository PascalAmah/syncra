import { describe, it, expect } from 'vitest';
import { SyncError, classifyResponseError, isRetriableStatus, wrapError } from './errors';

describe('SyncError', () => {
  it('is an Error subclass', () => {
    const err = new SyncError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SyncError);
    expect(err.message).toBe('boom');
    expect(err.name).toBe('SyncError');
  });

  it('defaults retriable to true', () => {
    expect(new SyncError('boom').retriable).toBe(true);
  });

  it('respects an explicit retriable value', () => {
    expect(new SyncError('boom', false).retriable).toBe(false);
    expect(new SyncError('boom', true).retriable).toBe(true);
  });
});

describe('status-code classification', () => {
  it.each([
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [413, false],
    [422, false],
  ])('%i is non-retriable', (status, expected) => {
    expect(isRetriableStatus(status)).toBe(expected);
    expect(classifyResponseError(status).retriable).toBe(false);
  });

  it.each([
    [408, true],
    [429, true],
  ])('%i (transient) is retriable', status => {
    expect(isRetriableStatus(status)).toBe(true);
    expect(classifyResponseError(status).retriable).toBe(true);
  });

  it.each([
    [500, true],
    [503, true],
  ])('%i (server failure) is retriable', status => {
    expect(isRetriableStatus(status)).toBe(true);
    expect(classifyResponseError(status).retriable).toBe(true);
  });
});

describe('network error classification', () => {
  it('treats a TypeError (network failure) as retriable', () => {
    const err = wrapError(new TypeError('Failed to fetch'));
    expect(err).toBeInstanceOf(SyncError);
    expect(err.retriable).toBe(true);
    expect(err.message).toBe('Failed to fetch');
  });

  it('wraps a plain Error as retriable', () => {
    const err = wrapError(new Error('boom'));
    expect(err.retriable).toBe(true);
  });

  it('passes through an existing SyncError unchanged', () => {
    const syncErr = new SyncError('boom', false);
    expect(wrapError(syncErr)).toBe(syncErr);
  });
});
