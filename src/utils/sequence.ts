export type SequenceOptions = {
  start?: number
}

export class CountSequence {
  private pos: number = 0

  constructor({ start = 0 }: SequenceOptions = {}) {
    this.pos = start
  }

  next() {
    this.pos += 1
    return this.pos
  }
}

export function createSequence(args?: SequenceOptions): CountSequence {
  return new CountSequence(args)
}
