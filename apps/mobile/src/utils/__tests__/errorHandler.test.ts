/**
 * errorHandler Tests — Task #576
 *
 * Covers extractErrorMessage() for all input types and handleError() for all
 * branching paths (silent, custom userMessage, default logger, custom logger).
 */

// ─── Mocks ─────────────────────────────────────────────────────────────────── //
// jest.mock() calls are hoisted above all imports by babel-jest/ts-jest, so
// these factories are applied before any module in this file (including
// ../errorHandler and its dependencies) is evaluated.

// Mock showError so tests don't need React Native's Alert
jest.mock('../alerts', () => ({
  showError: jest.fn(),
}));

// Mock gameLogger to capture log calls
jest.mock('../logger', () => ({
  gameLogger: {
    error: jest.fn(),
  },
}));

// Mock Sentry and analytics services (added by task #272) — keep existing tests isolated
jest.mock('../../services/sentry', () => ({
  sentryCapture: {
    exception: jest.fn(),
    message: jest.fn(),
    breadcrumb: jest.fn(),
  },
}));

jest.mock('../../services/analytics', () => ({
  trackError: jest.fn(),
}));

import { extractErrorMessage, handleError } from '../errorHandler';
import { showError } from '../alerts';
import { gameLogger } from '../logger';
import { sentryCapture } from '../../services/sentry';
import { trackError } from '../../services/analytics';

const mockShowError = showError as jest.Mock;
const mockLoggerError = (gameLogger as { error: jest.Mock }).error;
const mockSentryException = (sentryCapture as { exception: jest.Mock }).exception;
const mockTrackError = trackError as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// extractErrorMessage
// ─────────────────────────────────────────────────────────────────────────────

describe('extractErrorMessage', () => {
  it('returns message from Error instance', () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns fallback for Error with empty message', () => {
    expect(extractErrorMessage(new Error(''))).toBe('An unknown error occurred');
  });

  it('returns fallback for Error with whitespace-only message', () => {
    expect(extractErrorMessage(new Error('   '))).toBe('An unknown error occurred');
  });

  it('falls back when throw is an empty string', () => {
    expect(extractErrorMessage('')).toBe('An unknown error occurred');
  });

  it('falls back for whitespace-only string', () => {
    expect(extractErrorMessage('   ')).toBe('An unknown error occurred');
  });

  it('returns the string for a non-empty string', () => {
    expect(extractErrorMessage('network error')).toBe('network error');
  });

  it('returns message from plain object with .message', () => {
    expect(extractErrorMessage({ message: 'db error' })).toBe('db error');
  });

  it('returns error from plain object with .error', () => {
    expect(extractErrorMessage({ error: 'auth failed' })).toBe('auth failed');
  });

  it('prefers .message over .error when both present', () => {
    expect(extractErrorMessage({ message: 'msg', error: 'err' })).toBe('msg');
  });

  it('skips empty .message and falls back to .error', () => {
    expect(extractErrorMessage({ message: '', error: 'fallback-error' })).toBe('fallback-error');
  });

  it('returns fallback for null', () => {
    expect(extractErrorMessage(null)).toBe('An unknown error occurred');
  });

  it('returns fallback for undefined', () => {
    expect(extractErrorMessage(undefined)).toBe('An unknown error occurred');
  });

  it('converts numbers to string', () => {
    expect(extractErrorMessage(42)).toBe('42');
  });

  it('handles object with whitespace-only .message', () => {
    expect(extractErrorMessage({ message: '  ' })).toBe('An unknown error occurred');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleError
// ─────────────────────────────────────────────────────────────────────────────

describe('handleError', () => {
  it('logs with context prefix and shows alert by default', () => {
    const error = new Error('fail');
    const result = handleError(error, { context: 'Test' });
    expect(mockLoggerError).toHaveBeenCalledWith('[Test] fail');
    expect(mockShowError).toHaveBeenCalledWith('fail');
    expect(result).toBe('fail');
    // Sentry captures for non-silent errors (no explicit level — defaults to 'error')
    expect(mockSentryException).toHaveBeenCalledWith(error, { context: 'Test' });
    // Analytics receives fixed constant (not raw error message)
    expect(mockTrackError).toHaveBeenCalledWith('Test', 'UNEXPECTED_ERROR', false);
  });

  it('does NOT show alert when silent: true', () => {
    handleError(new Error('bg error'), { context: 'BgSync', silent: true });
    expect(mockLoggerError).toHaveBeenCalledWith('[BgSync] bg error');
    expect(mockShowError).not.toHaveBeenCalled();
    // Silent errors are log-only — Sentry must NOT be called
    expect(mockSentryException).not.toHaveBeenCalled();
    // Analytics NOT called for silent errors
    expect(mockTrackError).not.toHaveBeenCalled();
  });

  it('shows custom userMessage instead of raw error', () => {
    handleError(new Error('raw'), {
      context: 'JoinRoom',
      userMessage: 'Could not join the room. Please try again.',
    });
    expect(mockShowError).toHaveBeenCalledWith('Could not join the room. Please try again.');
  });

  it('still shows alert with custom userMessage even when error is empty', () => {
    handleError(new Error(''), {
      context: 'Test',
      userMessage: 'Something went wrong.',
    });
    expect(mockShowError).toHaveBeenCalledWith('Something went wrong.');
  });

  it('uses custom logger when provided', () => {
    const customLogger = { error: jest.fn() };
    handleError(new Error('oops'), { context: 'CustomCtx', logger: customLogger });
    expect(customLogger.error).toHaveBeenCalledWith('[CustomCtx] oops');
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('defaults context to Unknown when not provided', () => {
    handleError(new Error('x'));
    expect(mockLoggerError).toHaveBeenCalledWith('[Unknown] x');
  });

  it('returns the extracted message string', () => {
    const msg = handleError({ message: 'db error' }, { silent: true });
    expect(msg).toBe('db error');
  });

  it('handles thrown strings', () => {
    handleError('string error', { context: 'Ctx', silent: true });
    expect(mockLoggerError).toHaveBeenCalledWith('[Ctx] string error');
  });

  it('normalises empty thrown string to fallback', () => {
    handleError('', { context: 'Empty', silent: true });
    expect(mockLoggerError).toHaveBeenCalledWith('[Empty] An unknown error occurred');
  });
});
