/**
 * Shared word-count utilities for candidacy paragraph validation (VALID-01).
 *
 * The canonical paragraph minimum is 50 words — the agreed fixed threshold
 * recorded in the 04-07 Task 1 decision (requirement and code aligned).
 * Leadership Capsule (EAF Part IV) project descriptions use a lighter
 * 25-word floor.
 */

/** Canonical paragraph-word minimum (locked for phase 04 — see 04-PLAN 04-07). */
export const MIN_WORDS = 50;

/** Minimum for each Leadership Capsule project/program description. */
export const MIN_CAPSULE_DESCRIPTION_WORDS = 25;

/**
 * True when the token carries real content — at least one letter or digit.
 * Punctuation runs ("."), symbol spam ("!!!"), and lone dashes are noise, not
 * words: counting them would let ". . ." typed 50 times pass the 50-word gate.
 */
function isRealWord(token: string): boolean {
  return /[\p{L}\p{N}]/u.test(token);
}

/**
 * Count words in a string using whitespace-boundary splitting.
 * Collapses all internal whitespace runs before splitting, and only tokens
 * containing a letter or digit count — punctuation-only "words" are ignored.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(isRealWord).length;
}

/**
 * True when `text` contains at least one letter or digit.  An answer made up
 * only of punctuation and/or whitespace (".", ". . .", "???", "   ") carries
 * no content, no matter how its whitespace-split token count looks.
 */
export function hasMeaningfulText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * Return a validation-error string when `text` is empty ("required") or is
 * only punctuation and/or whitespace — the "typed '.' and spaces" case — or
 * null when the text carries actual words.
 */
export function meaningfulTextError(text: string, label: string): string | null {
  if (!text.trim()) {
    return `${label} is required.`;
  }
  if (!hasMeaningfulText(text)) {
    return `${label} must contain actual words — punctuation and spaces alone are not allowed.`;
  }
  return null;
}

/**
 * Return a validation-error string if `text` contains fewer than `min` words,
 * or null if the count meets the minimum.
 */
export function minWordCountError(text: string, label: string, min: number): string | null {
  const count = countWords(text);
  if (count < min) {
    return `${label} must be at least ${min} words (${count}/${min}).`;
  }
  return null;
}

/**
 * Return a validation-error string if `text` contains fewer than `MIN_WORDS`
 * words, or null if the count meets the minimum.
 */
export function wordCountError(text: string, label: string): string | null {
  return minWordCountError(text, label, MIN_WORDS);
}
