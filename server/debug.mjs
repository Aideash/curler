/**
 * Verbose server logging, off unless CURLER_DEBUG is set. Normal runs should
 * print a couple of startup lines and then stay silent, so anything that does
 * appear is worth reading.
 */
export const debugEnabled = process.env.CURLER_DEBUG === '1'

export function debugLog(...args) {
  if (debugEnabled) console.log('[debug]', ...args)
}
