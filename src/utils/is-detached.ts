import util from 'util'

/**
 * Checks if given ArrayBuffer is detached
 */
export function isDetached(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength === 0) {
    const formatted = util.format(buffer)
    return formatted.includes('detached')
  }
  return false
}