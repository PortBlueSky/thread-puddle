<p align="center">
  <img width="320" height="167" src="https://github.com/PortBlueSky/thread-puddle/blob/master/assets/tp-logo.png?raw=true">
</p>

# thread-puddle

## Turn any module into a worker thread

[![Build Status](https://travis-ci.com/PortBlueSky/thread-puddle.svg?branch=master)](https://travis-ci.com/PortBlueSky/thread-puddle) [![npm version](https://badge.fury.io/js/thread-puddle.svg)](https://badge.fury.io/js/thread-puddle) [![Coverage Status](https://coveralls.io/repos/github/PortBlueSky/thread-puddle/badge.svg?branch=master)](https://coveralls.io/github/PortBlueSky/thread-puddle?branch=master)

A small library to pool Node.js [worker threads](https://nodejs.org/dist/latest-v13.x/docs/api/worker_threads.html), automatically exposing exported module methods using [Proxy Objects](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy).

__+ Full TypeScript Support__ (using [ts-node](https://github.com/TypeStrong/ts-node))

### Installation

```bash
npm install thread-puddle
```

_Note_: You can use worker threads since __Node.js 12+__ without flag. For __Node.js 10.5+__ you need the `--experimental-worker` flag.

### Usage Example

```ts
// worker.ts
export interface IMyWorker {
  say(): string;
}

module.exports = {
  say: () => 'Hello!'
} as IMyWorker
```

```ts
// main.ts
import { createThreadPool } from '../../lib'
import { IMyWorker } from './worker'

const worker = await createThreadPool<IMyWorker>('./worker', {
  size: 2
})

const result = await worker.say()

console.log(result) // -> "Hello!"

worker.pool.terminate()
```

This and more examples in plain JS can be found in the `examples` directory.

## Typing

`createThreadPool` uses TypeScript [generics](https://www.typescriptlang.org/docs/handbook/generics.html) and [other](https://www.typescriptlang.org/docs/handbook/utility-types.html#picktk) [advanced](https://www.typescriptlang.org/docs/handbook/utility-types.html#parameterst) [features](https://www.typescriptlang.org/docs/handbook/utility-types.html#returntypet) to give you the type of how your worker module will actually be exposed to the main thread.

__TL;DR__: The captured type for your thread will be modified to only return async methods and be extended with the pool interface.

Example:

```ts
interface Calculations {
  crunchNumbers(data: number[]): number;
}

// Using as worker type:
const worker = createThreadPool<Calculations>('./calc-worker')

// Will basically become:
interface Calculations {
  crunchNumbers(data: number[]): Promise<number>;
  pool: PoolInterface
}

// Expressed as:
const worker: WrapReturnType<Pick<ValidWorker, "crunchNumbers">> & BaseWorkerType

```


## API

### `async createThreadPool<T>(workerPath, [options])`

Creates a pool of workers and waits until all workers are ready to call methods on, then returns a Proxy Object which will forward method calls to the worker.

Arguments:

- `workerPath` - an absolute path to a module.
- `options` - optional settings:
  - `size`- the number of worker threads to be created in the pool for the given module. Defaults to `1`.
  - `workerOptions` - will be used as options for the [worker thread constructor](https://nodejs.org/dist/latest-v12.x/docs/api/worker_threads.html#worker_threads_new_worker_filename_options). Defaults to `{}`.
  - `startupTimeout` - if a worker thread cannot be started within this timout in milliseconds, the pool creation will fail and reject with a timout error. Defaults to `30000`.

If the pool size is `> 1`, method calls will be forwarded to the next available worker. If all workers are busy, the method calls will be queued. A worker will handle one method call at any time only.

### `async worker.[method]([arguments])`

On the Proxy Object returned from `createThreadPool`, you can call any method which is exported from the `workerPath` module. **All method calls are async and return a Promise**, no matter if the module method is async or not. The promise will be resolved with the return value of the method in the worker module. If the method call fails in the worker thread, the Promise will be rejected with that error and the original stack trace. If a method is not available on the worker, the Promise will be rejected with an error.

- `method` - Must match a method name exported from the worker module.
- `arguments` - Arbitrary number of arguments forwarded to the method call in the worker thread.

`Arguments` are transferred to the worker thread via [`postMessage`](https://nodejs.org/dist/latest-v12.x/docs/api/worker_threads.html#worker_threads_port_postmessage_value_transferlist), compatible with the [HTML structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm). If you want to move arguments of type `ArrayBuffer` or `MessageChannel` instead of copying them, you can use the `withTransfer` helper.

### `async worker.all.[method]([arguments])`

Will call the given `method` on all workers, as soon as they become available. Returns a list of the results from all workers, like `Promise.all`. Otherwise behaves the same as `worker.[method]([arguments])`.

### `worker.pool.terminate()`

Terminates the pool and all worker threads in it. Trying to call methods in the pool afterwards, will result in an rejection.

### `worker.pool.size`

The number of worker threads in the pool.

### `worker.pool.isTerminated`

Wether or not the pool was terminated. 

### `withTransfer(value, [transferList])`

This helper can be used **bi-directional**, to transfer values to a worker thread as method call argument(s), or to transfer values from a worker thread method.

Arguments:

- `value` - Any value which contains transferrables (`ArrayBuffer` or `MessageChannel`).
- `transferList` - If `value` itself is not a [typed array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Typed_arrays), the list may specify any transferrable contained in `value`.

Example method arguments:

```js
// Main thread
const buf = Buffer.from('my main buffer value')
const value = {
  buf,
  anotherValue: true
}

worker.customMethod(withTransfer(value, [buf])) // <--
```

Example return value:

```js
// Worker thread
module.exports = {
  customMethod() {
    const buf = Buffer.from('my thread buffer value')
    const value = {
      buf,
      anotherValue: true
    }
    return withTransfer(value, [buf]) // <--
  }
}
```

### Pool Events

#### `error`

Forwards errors that are emitted for a specific worker in the pool. When a worker thread errors, it is terminated. The pool will spawn another worker, unless it is terminated.

#### `exit`

Forwards exit events that are emitted for a specific worker in the pool, addind the `threadId` as second argument.

## Debug

Thread Puddle has only one dependency: [`debug`](https://www.npmjs.com/package/debug)

Namespaces:

- `puddle:*` - all debug logs for the module
- `puddle:master` - only logs from the pool controller
- `puddle:thread:*` - logs for all threads only
- `puddle:thread:[id]` - logs for a specific thread

Nested Namespaces:

- `puddle:parent:[id]:master`
- `puddle:parent:[id]:thread:[id]`

The debug method with the correct namespace is exported from the `thread-puddle` entry point.

---
&copy; 2020 Sebastian Herrlinger

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
