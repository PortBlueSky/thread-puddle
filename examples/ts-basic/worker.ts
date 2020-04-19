// worker.ts
export interface IMyWorker {
  say(): string;
}

module.exports = {
  say: () => 'Hello!'
} as IMyWorker