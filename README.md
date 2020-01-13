<p align="center">
  <img width="320" height="167" src="https://github.com/kommander/thread-puddle/blob/master/assets/tp-logo.png?raw=true">
</p>

# thread-puddle
## Turn any module into a worker thread

A small library to pool Node.js [worker threads](https://nodejs.org/dist/latest-v13.x/docs/api/worker_threads.html), automatically exposing exported module methods using [Proxy Objects](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy).

### Installation
```
npm install thread-puddle
```

### Usage Example

```js
// worker.js
module.exports = {
  say: () => 'Hello!'
}
```

```js
// main.js
const { createPuddle } = require('thread-puddle')

const worker = await createPuddle('/path/to/worker.js', {
  size: 2
})

const result = await worker.say()

console.log(result) // -> "Hello!"
```
