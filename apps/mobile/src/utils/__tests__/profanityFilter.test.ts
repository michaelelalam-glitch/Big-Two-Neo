import { containsProfanity, filterMessage } from '../../utils/profanityFilter';

describe('profanityFilter', () => {
  describe('containsProfanity', () => {
    it('detects blocked words', () => {
      expect(containsProfanity('what the fuck')).toBe(true);
      expect(containsProfanity('SHIT happens')).toBe(true);
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
      expect(filterMessage('what the fuck')).toBe('what the ***');
      expect(filterMessage('shit happens')).toBe('*** happens');
    });

    it('returns clean text unchanged', () => {
      expect(filterMessage('good game!')).toBe('good game!');
      expect(filterMessage('nice play')).toBe('nice play');
    });

    it('replaces multiple blocked words', () => {
      const result = filterMessage('damn this shit');
      expect(result).toBe('*** this ***');
    });

    it('is case-insensitive', () => {
      expect(filterMessage('FUCK')).toBe('***');
      expect(filterMessage('Shit')).toBe('***');
    });
  });
});
