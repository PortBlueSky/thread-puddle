export interface ValidWorker {
  someMethod(): string
}

export default {
  someMethod: () => 'hello ts'
} as ValidWorker