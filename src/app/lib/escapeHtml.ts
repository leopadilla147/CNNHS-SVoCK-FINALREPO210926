/**
 * Escape a string for safe interpolation into HTML text and quoted
 * attribute contexts. Covers the five XML/HTML metacharacters that can
 * break out of text nodes or attribute values when user-controlled data
 * is serialized into HTML strings (e.g. `document.write` print windows).
 *
 * Ampersand is replaced first so that entity escapes produced here are
 * never double-encoded by a later pass over the same characters.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}