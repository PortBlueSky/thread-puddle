export interface ValidWorker {
  someMethod(): string;
  moreMethod(): number;
}

export default {
  someMethod: () => 'hello ts',
  moreMethod: () => 1
} as ValidWorker