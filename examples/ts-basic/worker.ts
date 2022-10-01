// worker.ts
export interface IMyWorker {
  say(): string;
}

export default {
  say: () => 'Hello!'
}