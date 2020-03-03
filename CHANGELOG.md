# Changelog

## Version 0.2.0

- Puddle internal thread id is exposed to worker via `const { threadId } = require('thread-puddle')`.
- The module now exports `createThreadPool` as a pool constructor.
- Loads ECMAScript Modules (ES6 Modules) as workers for node version >= 13.
