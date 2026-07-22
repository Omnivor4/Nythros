/**
 * Safely extract a readable error message from any thrown value.
 *
 * Error objects  → e.message (only if it's a string)
 * Strings        → the string itself
 * null/undefined → 'null' / 'undefined'
 * Everything else → String(e) or 'unknown error'
 *
 * The `typeof e.message === 'string'` guard is critical: it prevents crashes
 * when calling .includes() on the result, and handles edge cases where
 * someone throws an object with a non-string `message` property.
 *
 * Never throws, never produces "... is undefined". Use in EVERY catch block that
 * formats a user-facing error message or calls .includes() on the result.
 *
 * @param {unknown} e — anything that was thrown
 * @returns {string} a safe, readable error representation
 */
export function safeError(e) {
  return (e && typeof e.message === 'string' ? e.message : String(e)) || 'unknown error';
}
