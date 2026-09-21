/**
 * Shared word-count utilities for candidacy paragraph validation (VALID-01).
 *
 * The canonical paragraph minimum is 50 words — the agreed fixed threshold
 * recorded in the 04-07 Task 1 decision (requirement and code aligned).
 */

/** Canonical paragraph-word minimum (locked for phase 04 — see 04-PLAN 04-07). */
export const MIN_WORDS = 50;

/**
 * Count words in a string using whitespace-boundary splitting.
 * Collapses all internal whitespace runs before splitting.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Return a validation-error string if `text` contains fewer than `MIN_WORDS`
 * words, or null if the count meets the minimum.
 */
export function wordCountError(text: string, label: string): string | null {
  const count = countWords(text);
  if (count < MIN_WORDS) {
    return `${label} must be at least ${MIN_WORDS} words (${count}/${MIN_WORDS}).`;
  }
  return null;
}
