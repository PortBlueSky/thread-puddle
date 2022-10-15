# Changelog

## Version 0.4.0
  - Basic Callback Functions #21
    - Workers can now implement EventEmitter behaviour
  - Worker paths can now be relative
  - ts-node is now `transpile-only` per default #21
  - Allows chaining (resolves to the proxy when the worker returns itself)
  - Upgrade all dev dependencies
  - Improved typing
  - Max Queue Size #29
    - Subsequent calls will be rejected when max queue size is reached,
    until the queue is emptied below max again.

## Version 0.3.2
  - Stricter and fixed types #16

## Version 0.3.1
  - Make ts-node optional #7 (@spmiller)
  - Bump some dev dependency versions

## Version 0.3.0

- TypeScript support :tada:
  Building a TypeScript worker on-the-fly with ts-node,
  generic `createThreadPool<OwnType>` pool creation
  with generated type from a custom worker type (promise wrapped methods).

## Version 0.2.1, 0.2.2

- Bump dev dependency versions for security update

## Version 0.2.0

- Puddle internal thread id is exposed to worker via `const { threadId } = require('thread-puddle')`.
- The module now exports `createThreadPool` as a pool constructor.
- Loads ECMAScript Modules (ES6 Modules) as workers for node version >= 13.
- Has now only one way to access the pool interface: `workerProxy.pool`
- Emits worker events on the `workerProxy.pool` interface
- Emits an `exit` event when a worker exits, `code` and `threadId`
