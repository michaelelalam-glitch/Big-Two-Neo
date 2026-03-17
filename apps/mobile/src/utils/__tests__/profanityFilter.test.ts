import { containsProfanity, filterMessage } from '../../utils/profanityFilter';

// Helper to decode test words stored in reversed form, matching the source encoding
// convention in profanityFilter.ts. Avoids explicit offensive words as plaintext
// in test source (Copilot PR-150 r2949966880).
const w = (rev: string) => rev.split('').reverse().join('');
const TW = {
  f: w('kcuf'),
  s: w('tihs'),
  d: w('nmaD'),
} as const;

describe('profanityFilter', () => {
  describe('containsProfanity', () => {
    it('detects blocked words', () => {
      expect(containsProfanity(`what the ${TW.f}`)).toBe(true);
      expect(containsProfanity(`${TW.s.toUpperCase()} happens`)).toBe(true);
    });

    it('ignores clean text', () => {
      expect(containsProfanity('hello world')).toBe(false);
      expect(containsProfanity('good game!')).toBe(false);
      expect(containsProfanity('class assignment')).toBe(false); // "ass" inside "class" should NOT match
    });

    it('detects l33tspeak substitutions', () => {
      expect(containsProfanity('sh1t')).toBe(true);
      expect(containsProfanity('f4ck')).toBe(false); // 'u' is not leet-mapped, so this won't match "fuck"
    });
  });

  describe('filterMessage', () => {
    it('replaces blocked words with ***', () => {
      expect(filterMessage(`what the ${TW.f}`)).toBe('what the ***');
      expect(filterMessage(`${TW.s} happens`)).toBe('*** happens');
    });

    it('returns clean text unchanged', () => {
      expect(filterMessage('good game!')).toBe('good game!');
      expect(filterMessage('nice play')).toBe('nice play');
    });

    it('replaces multiple blocked words', () => {
      const result = filterMessage(`${TW.d} this ${TW.s}`);
      expect(result).toBe('*** this ***');
    });

    it('is case-insensitive', () => {
      expect(filterMessage(TW.f.toUpperCase())).toBe('***');
      expect(filterMessage(TW.s[0].toUpperCase() + TW.s.slice(1))).toBe('***');
    });
  });
});
