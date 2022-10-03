export function createSequence({ start = 0 } = {}) {
  let pos = start

  return {
    next() {
      pos += 1
      return pos
    }
  }
}
