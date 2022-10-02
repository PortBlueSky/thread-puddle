// worker.ts
export interface IMyWorker {
  say(): string;
}

export default {
  say: () => console.log('Hello!')
}