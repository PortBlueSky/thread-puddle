export interface ValidWorker {
  someMethod(): Promise<string>
}

export default {
  someMethod: () => Promise.resolve('hello ts')
} as ValidWorker