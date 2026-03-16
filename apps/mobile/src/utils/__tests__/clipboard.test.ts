/**
 * Tests for tryCopyTextWithShareFallback (utils/clipboard.ts)
 *
 * Three return paths:
 *   'copied'  — Clipboard.setStringAsync succeeded
 *   'shared'  — clipboard failed; Share sheet was presented (sharedAction or dismissedAction)
 *   'failed'  — both clipboard and Share threw (e.g. no sharing capabilities)
 */

import { tryCopyTextWithShareFallback } from '../clipboard';
import { setStringAsync } from 'expo-clipboard';
import { Share } from 'react-native';

const mockSetStringAsync = setStringAsync as jest.Mock;
const mockShareShare = Share.share as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // Happy-path defaults — individual tests override as needed
  mockSetStringAsync.mockResolvedValue(undefined);
  mockShareShare.mockResolvedValue({ action: Share.sharedAction });
});

describe('tryCopyTextWithShareFallback', () => {
  it('returns "copied" when clipboard write succeeds', async () => {
    const result = await tryCopyTextWithShareFallback('ROOM42');

    expect(result).toBe('copied');
    expect(mockSetStringAsync).toHaveBeenCalledWith('ROOM42');
    expect(mockShareShare).not.toHaveBeenCalled();
  });

  it('passes shareTitle to Share.share when clipboard throws', async () => {
    mockSetStringAsync.mockRejectedValueOnce(new Error('unavailable'));

    await tryCopyTextWithShareFallback('ROOM42', 'Join the game');

    expect(mockShareShare).toHaveBeenCalledWith({
      message: 'ROOM42',
      title: 'Join the game',
    });
  });

  it('returns "shared" when Share resolves with sharedAction', async () => {
    mockSetStringAsync.mockRejectedValueOnce(new Error('unavailable'));
    mockShareShare.mockResolvedValueOnce({ action: Share.sharedAction });

    const result = await tryCopyTextWithShareFallback('ROOM42');

    expect(result).toBe('shared');
  });

  it('returns "shared" when Share resolves with dismissedAction (user cancelled)', async () => {
    mockSetStringAsync.mockRejectedValueOnce(new Error('unavailable'));
    mockShareShare.mockResolvedValueOnce({ action: Share.dismissedAction });

    const result = await tryCopyTextWithShareFallback('ROOM42');

    expect(result).toBe('shared');
  });

  it('returns "failed" when both clipboard and Share throw', async () => {
    mockSetStringAsync.mockRejectedValueOnce(new Error('clipboard unavailable'));
    mockShareShare.mockRejectedValueOnce(new Error('sharing not available'));

    const result = await tryCopyTextWithShareFallback('ROOM42');

    expect(result).toBe('failed');
  });
});
