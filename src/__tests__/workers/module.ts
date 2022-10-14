export interface ValidWorkerModule {
  someMethod(): string;
  moreMethod(): number;
}

export function someMethod() { return 'hello module' }
export function moreMethod() { return 1 }
