// worker.ts
export interface IMyWorker {
  say(): void
}

export default {
  say: () => console.log('Hello!')
}