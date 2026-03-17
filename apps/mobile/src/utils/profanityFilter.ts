/**
 * Lightweight client-side profanity filter (Task #648).
 *
 * Uses a regex-based word blocklist. Words are matched on word boundaries
 * so "class" won't be caught by "ass". Common l33tspeak substitutions
 * (a→@/4, e→3, i→1/!, o→0, s→$) are handled.
 */

// Blocklist — add words in lowercase. Each entry is escaped and expanded
// into a regex that covers basic leet substitutions.
const BLOCKLIST: string[] = [
  'shit', 'fuck', 'ass', 'bitch', 'dick', 'damn', 'crap',
  'piss', 'cock', 'cunt', 'bastard', 'slut', 'whore',
  'nigger', 'nigga', 'fag', 'faggot', 'retard',
];

/** Map plain chars → leet regex character classes. */
const LEET_MAP: Record<string, string> = {
  a: '[a@4]',
  e: '[e3]',
  i: '[i1!]',
  o: '[o0]',
  s: '[s$5]',
  t: '[t7]',
};

function toLeetPattern(word: string): string {
  return word
    .split('')
    .map((ch) => LEET_MAP[ch] ?? ch)
    .join('');
}

// Build a single combined regex from the blocklist.
const combinedPattern = BLOCKLIST.map(toLeetPattern).join('|');
const PROFANITY_REGEX = new RegExp(`\\b(?:${combinedPattern})\\b`, 'gi');

/**
 * Returns `true` if the text contains a blocked word.
 */
export function containsProfanity(text: string): boolean {
  PROFANITY_REGEX.lastIndex = 0;
  return PROFANITY_REGEX.test(text);
}

/**
 * Replaces blocked words with `***`.
 */
export function filterMessage(text: string): string {
  PROFANITY_REGEX.lastIndex = 0;
  return text.replace(PROFANITY_REGEX, '***');
}
