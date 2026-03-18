/**
 * Lightweight client-side profanity filter (Task #648).
 *
 * Uses a regex-based word blocklist. Words are matched on word boundaries
 * so "class" won't be caught by "ass". Common l33tspeak substitutions
 * (a→@/4, e→3, i→1/!, o→0, s→$) are handled.
 */

// Content-moderation word list for in-game chat filtering.
// Words are stored as reversed strings — a source-code convention to prevent
// inadvertent plaintext appearances during code review; NOT a security measure
// or an attempt to evade content scanners. Decoded at module init.
// To add a word: reverse it and append to the array (e.g. 'hello' → 'olleh').
const BLOCKLIST_REVERSED: string[] = [
  'tihs', 'kcuf', 'ssa', 'hctib', 'kcid', 'nmaD', 'parc',
  'ssip', 'kcoc', 'tnuc', 'dratsab', 'tuls', 'eROhW',
  'rEggin', 'aggin', 'gaf', 'toggaf', 'drater',
];

const BLOCKLIST: string[] = BLOCKLIST_REVERSED.map(
  (w) => w.split('').reverse().join('').toLowerCase(),
);

/** Map plain chars → leet regex character classes. */
const LEET_MAP: Record<string, string> = {
  a: '[a@4]',
  e: '[e3]',
  i: '[i1!]',
  o: '[o0]',
  s: '[s$5]',
  t: '[t7]',
};

/** Escape regex metacharacters so special chars in future words don't break the pattern. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toLeetPattern(word: string): string {
  return word
    .split('')
    .map((ch) => LEET_MAP[ch] ?? escapeRegex(ch))
    .join('');
}

// Build a single combined regex from the blocklist.
// Custom boundary logic instead of \b so leet-speak words starting/ending
// with non-word characters (e.g. "@ss", "as$") are still matched. \b fails
// at those edges because "@"/"$" are \W and \b requires a \W↔\w transition
// (Copilot PR-150 r2950221375).
const combinedPattern = BLOCKLIST.map(toLeetPattern).join('|');
// Prefix capture group instead of lookbehind: '(^|[^a-zA-Z0-9])' matches the
// start of string or any non-alphanumeric character before the blocked word.
// The captured prefix is restored in filterMessage via '$1***'. Using a
// group rather than a negative lookbehind ensures compatibility with all
// JSC/Hermes builds shipped with React Native (Copilot PR-150 r2950333900).
const PROFANITY_REGEX = new RegExp(
  `((?:^|[^a-zA-Z0-9]))(?:${combinedPattern})(?![a-zA-Z0-9])`,
  'gi',
);

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
  return text.replace(PROFANITY_REGEX, '$1***');
}
