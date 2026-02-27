/**
 * Tests for invokeWithRetry utility
 */

// Mock supabase before importing the module under test
jest.mock('../../services/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

jest.mock('../../utils/logger', () => ({
  networkLogger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

import { invokeWithRetry } from '../../utils/edgeFunctionRetry';
import { supabase } from '../../services/supabase';

const mockInvoke = supabase.functions.invoke as jest.Mock;

describe('invokeWithRetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should succeed on first attempt when no error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { success: true }, error: null });

    const result = await invokeWithRetry('play-cards', { body: { room_code: 'ABC123' } });

    expect(result.data).toEqual({ success: true });
    expect(result.error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('should return non-retryable errors immediately without retrying', async () => {
    const httpError = { name: 'FunctionsHttpError', message: 'Not your turn', context: { status: 400 } };
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError });

    const result = await invokeWithRetry('play-cards', { body: { room_code: 'ABC123' } });

    expect(result.error).toBe(httpError);
    expect(mockInvoke).toHaveBeenCalledTimes(1); // No retry for HTTP errors
  });

  it('should retry on FunctionsFetchError and succeed on second attempt', async () => {
    const fetchError = { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: {} };
    mockInvoke
      .mockResolvedValueOnce({ data: null, error: fetchError })
      .mockResolvedValueOnce({ data: { success: true }, error: null });

    // Use fake timers and advance through the retry backoff delay
    const resultPromise = invokeWithRetry('play-cards', { body: { room_code: 'ABC123' } });
    await jest.advanceTimersByTimeAsync(1000); // Advance past 500ms backoff

    const result = await resultPromise;

    expect(result.data).toEqual({ success: true });
    expect(result.error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('should exhaust retries and return last error', async () => {
    const fetchError = { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: {} };
    mockInvoke
      .mockResolvedValueOnce({ data: null, error: fetchError })
      .mockResolvedValueOnce({ data: null, error: fetchError })
      .mockResolvedValueOnce({ data: null, error: fetchError });

    // Use fake timers and advance through both retry backoff delays
    const resultPromise = invokeWithRetry('play-cards', { body: { room_code: 'ABC123' } });
    await jest.advanceTimersByTimeAsync(2000); // Advance past 500ms + 1000ms backoffs

    const result = await resultPromise;

    expect(result.data).toBeNull();
    expect(result.error).toBe(fetchError);
    expect(mockInvoke).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('should handle thrown exceptions that are retryable', async () => {
    const fetchError = new Error('Failed to send a request to the Edge Function');
    (fetchError as any).name = 'FunctionsFetchError';
    
    mockInvoke
      .mockRejectedValueOnce(fetchError)
      .mockResolvedValueOnce({ data: { success: true }, error: null });

    // Use fake timers and advance through the retry backoff delay
    const resultPromise = invokeWithRetry('play-cards', { body: { room_code: 'ABC123' } });
    await jest.advanceTimersByTimeAsync(1000); // Advance past 500ms backoff

    const result = await resultPromise;

    expect(result.data).toEqual({ success: true });
    expect(result.error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('should not retry non-retryable thrown exceptions', async () => {
    const error = new Error('Some other error');

    mockInvoke.mockRejectedValueOnce(error);

    const result = await invokeWithRetry('play-cards', { body: { room_code: 'ABC123' } });

    expect(result.data).toBeNull();
    expect(result.error).toBe(error);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});
