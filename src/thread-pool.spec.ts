/* eslint-env jest */
import path from 'path'
import { createThreadPool } from './index'
import debug from 'debug'
import majorVersion from './utils/major-node-version'
import { ValidWorker } from './__tests__/workers/valid'
import { ValidWorkerClass } from './__tests__/workers/class'
import { WorkerWithCallback } from './__tests__/workers/callback'
import { WorkerWithEmitter } from './__tests__/workers/eventemitter'
import { ChainWorkerClass } from './__tests__/workers/this'
import { isThreadFreeFunctionMessage, ThreadMessageAction } from './types/messages'

debug.enabled('puddle')

const basicWorkerPath = './__tests__/workers/basic.js'
const startupFailWorkerPath = './__tests__/workers/startup-fail.js'
const noObjectWorkerPath = './__tests__/workers/no-object.js'
const invalidTsWorkerPath = './__tests__/workers/invalid-ts.ts'
const validTsWorkerPath = './__tests__/workers/valid.ts'
const classTsWorkerPath = './__tests__/workers/class.ts'

const countBy = (list: string[]) => list.reduce((acc: Record<string, number>, key: string) => {
  acc[key] = (acc[key] ?? 0) + 1
  return acc
}, {})

describe('Basic Features', () => {
  let worker: any

  beforeEach(async () => {
    worker = await createThreadPool<any>('./__tests__/workers/basic.js', {
      size: 2,
      workerOptions: {
        workerData: {
          test: 'test worker data'
        }
      }
    })
  })

  afterEach(() => {
    worker.pool.terminate()
    expect(worker.pool.isTerminated).toEqual(true)
  })

  it('can expose methods from worker module', async () => {
    const value = await worker.fn('value')

    expect(value).toEqual('got value')
  })

  it('can expose async methods from worker module', async () => {
    const value = await worker.asyncFn('value')

    expect(value).toEqual('got async value')
  })

  it('hands down workerData with workerOptions for worker', async () => {
    const data = await worker.getWorkerData()

    expect(data).toEqual(expect.objectContaining({
      test: 'test worker data'
    }))
  })

  it('throws error if method is not available on worker', async () => {
    try {
      await worker.notWorkerMethod()
      expect(false).toBe(true)
    } catch (err) {
      expect(err).toHaveProperty('message', '"notWorkerMethod" is not a function in this worker thread')
    }
  })

  it('calls methods round robin on workers', async () => {
    const value1 = await worker.fnWorkerNum('value')
    const value2 = await worker.fnWorkerNum('value')
    const value3 = await worker.fnWorkerNum('value')
    const value4 = await worker.fnWorkerNum('value')

    const counts = countBy([value1, value2, value3, value4])
    expect(counts).toEqual({
      'got value 9': 2,
      'got value 10': 2
    })
  })

  it('always only calls one method per worker', async () => {
    await Promise.all([
      worker.throwIfCalledAtTheSameTime(10),
      worker.throwIfCalledAtTheSameTime(10),
      worker.throwIfCalledAtTheSameTime(10),
      worker.throwIfCalledAtTheSameTime(10),
      worker.throwIfCalledAtTheSameTime(10),
      worker.throwIfCalledAtTheSameTime(10)
    ])
  })

  it('can call a method on all workers', async () => {
    const [value1, value2] = await worker.all.fnWorkerNum('value')

    expect([value1, value2]).toEqual([
      'got value 13',
      'got value 14'
    ])
  })

  it('waits for other calls to be resolved before calling on all', async () => {
    const results = await Promise.all([
      worker.asyncFn('one', 25),
      worker.asyncFn('two', 25),
      worker.all.fnWorkerNum('value')
    ])

    expect(results).toEqual([
      'got async one',
      'got async two',
      [
        'got value 15',
        'got value 16'
      ]
    ])
  })

  it('exposes the pool size as readonly', () => {
    expect(worker.pool.size).toEqual(2)
    expect(() => {
      worker.pool.size = 4
    }).toThrowError('Cannot set property size of [object Object] which has only a getter')
    // TODO: Why [object Object]?
    expect(worker.pool.size).toEqual(2)
  })

  it('emits an exit event when a worker exits', async () => {
    const fn = jest.fn()
    worker.pool.on('exit', fn)
    await worker.triggerExit()
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0]).toEqual(0)
    expect(fn.mock.calls[0][1]).toEqual(expect.any(Number))
  })

  it('terminates the pool if all workers exited and did not error', async () => {
    await worker.triggerExit()
    await worker.triggerExit()
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(worker.pool).toHaveProperty('isTerminated', true)
  })

  it.todo('allows to call methods on the parent thread')
  it.todo('can call a method on a specific worker directly')
  it.todo('warns if call queue becomes too large')
})

if (majorVersion >= 13) {
  describe('ES6 Modules', () => {
    let worker: any

    afterEach(() => {
      worker.pool.terminate()
    })

    it.todo('make them work again')
  
    it.skip('can expose methods from worker module', async () => {
      worker = await createThreadPool(path.resolve(__dirname, './__tests__/workers/es6-module.mjs'), {
        size: 2
      })

      const value = await worker.fn('value')

      expect(value).toEqual('got value')
    })

    it.skip('treats only default export as worker module', async () => {
      worker = await createThreadPool(path.resolve(__dirname, './__tests__/workers/es6-default.mjs'), {
        size: 2
      })

      const value = await worker.fn2('value')

      expect(value).toEqual('default value')
    })
  })
}

describe('Nested Threads', () => {
  let worker: any

  beforeEach(async () => {
    worker = await createThreadPool(path.resolve(__dirname, './__tests__/workers/nest.js'))
    await worker.setup()
  })

  afterEach(() => {
    worker.pool.terminate()
  })

  it('allows to nest worker threads', async () => {
    const result = await worker.callNested('value')

    expect(result).toEqual('nested value')
  })
})

describe('Error Handling', () => {
  let worker: any

  beforeEach(async () => {
    worker = await createThreadPool(basicWorkerPath, {
      size: 2
    })
  })

  afterEach(() => {
    worker.pool.terminate()
  })

  it('forwards worker method errors with worker stack trace', async () => {
    try {
      await worker.fnError('worker triggered this error message')
      expect(false).toBe(true)
    } catch (err) {
      expect(err).toHaveProperty('message', 'worker triggered this error message')
      expect(err).toHaveProperty('stack', expect.stringContaining('workers/basic.js'))
    }
  })

  it('forwards worker process errors within method', async () => {
    try {
      await worker.triggerProcessError()
      expect(false).toBe(true)
    } catch (err) {
      expect(err).toHaveProperty('message', 'Worker failure')
      expect(err).toHaveProperty('stack', expect.stringContaining('workers/basic.js'))
    }
  })

  it('respawns worker afer uncaught exceptions', async () => {
    await worker.triggerUncaughtException()
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(worker.pool).toHaveProperty('size', 2)
  })

  it('rejects open method calls when a worker crashes', async () => {
    const result = await Promise.all([
      worker.waitForUncaughtException(10).catch((err: Error) => err),
      worker.waitForUncaughtException(10).catch((err: Error) => err),
      worker.waitForUncaughtException(10).catch((err: Error) => err),
      worker.waitForUncaughtException(10).catch((err: Error) => err)
    ])
    result.map(err => expect(err).toHaveProperty('message', 'Worker failure'))
  })

  it('rejects open method calls when worker exits', async () => {
    const result = await Promise.all([
      worker.exitWorker(10).catch((err: Error) => err),
      worker.exitWorker(10).catch((err: Error) => err)
    ])
    result.map(err => expect(err).toHaveProperty('message', 'Worker thread exited before resolving'))
  })

  it('rejects waiting method calls when all workers exited', async () => {
    const [one, two, three, four] = await Promise.all([
      worker.exitWorker(10).catch((err: Error) => err),
      worker.exitWorker(10).catch((err: Error) => err),
      worker.exitWorker(10).catch((err: Error) => err),
      worker.exitWorker(10).catch((err: Error) => err)
    ])

    expect(one).toHaveProperty('message', 'Worker thread exited before resolving')
    expect(two).toHaveProperty('message', 'Worker thread exited before resolving')
    expect(three).toHaveProperty('message', 'All workers exited before resolving (use an error event handler or DEBUG=puddle:*)')
    expect(four).toHaveProperty('message', 'All workers exited before resolving (use an error event handler or DEBUG=puddle:*)')
  })

  it('emits an error event when a worker errors', async () => {
    const fn = jest.fn()
    worker.pool.on('error', fn)

    await worker.triggerUncaughtException()
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0]).toHaveProperty('message', 'Worker failure')
    expect(fn.mock.calls[0][0]).toHaveProperty('stack', expect.stringContaining('workers/basic.js'))
  })

  it.todo('[Proposal] allows to manually respawn workers after error')
  it.todo('[Proposal] allows to manually respawn workers after exit')
  it.todo('[Proposal] calling respawn only spawns a worker once again, ignores all other calls')
})

describe('ts-bridge', () => {
  it('actually spawns ts worker threads', async () => {
    const worker = await createThreadPool<ValidWorker>(validTsWorkerPath, {
      size: 2
    })
    const result = await worker.someMethod()

    expect(result).toBe('hello ts')
    worker.pool.terminate()
  })

  it('actually spawns ts class worker threads', async () => {
    const worker = await createThreadPool<ValidWorkerClass>(classTsWorkerPath, {
      size: 2
    })
    const result = await worker.someMethod()

    expect(result).toBe('hello ts class')
    worker.pool.terminate()
  })

  it('forwards ts errors to main thread', async () => {
    const startupError = await createThreadPool(invalidTsWorkerPath, {
      size: 2,
      typecheck: true
    }).catch(err => err)

    expect(startupError).toBeInstanceOf(Error)
    expect(startupError).toHaveProperty('message', '⨯ Unable to compile TypeScript:\nsrc/__tests__/workers/invalid-ts.ts(3,36): error TS2365: Operator \'+\' cannot be applied to types \'object\' and \'number\'.\n')
  })
})

describe('Startup', () => {
  it('terminates puddle when workers fail in startup phase', async () => {
    const startupError = await createThreadPool(startupFailWorkerPath, {
      size: 2
    }).catch(err => err)
    
    expect(startupError).toBeInstanceOf(Error)
    expect(startupError).toHaveProperty('message', 'Failing before even exporting any method')
  })

  it('rejects modules not exporting an object', async () => {
    const startupError = await createThreadPool(noObjectWorkerPath, {
      size: 2
    }).catch(err => err)

    expect(startupError).toBeInstanceOf(Error)
    expect(startupError).toHaveProperty('message', 'Worker should export an object, got null')
  })
})

describe('Termination', () => {
  let worker: any

  afterEach(() => {
    worker.pool.terminate()
  })

  it('terminates all workers', async () => {
    worker = await createThreadPool(basicWorkerPath, {
      size: 2
    })

    const value = worker.asyncFn('value', 100)

    worker.pool.terminate()

    const err = await value.catch((err: Error) => err)

    expect(worker.pool).toHaveProperty('isTerminated', true)
    expect(err).toHaveProperty('message', 'Worker thread exited before resolving')
  })

  it('cannot call another method after termination', async () => {
    worker = await createThreadPool(basicWorkerPath, {
      size: 2
    })

    worker.pool.terminate()

    const err = await worker.asyncFn('value', 100).catch((err: Error) => err)

    expect(err).toHaveProperty('message', 'Worker pool already terminated.')
  })
})

describe('Chaining', () => {
  it('returns the proxy when a worker object returns itself', async () => {
    const worker = await createThreadPool<ChainWorkerClass>('./__tests__/workers/this')

    const result = await (await worker.chain()).follow()
    worker.pool.terminate()

    expect(result).toEqual('works')
  })
})

describe('Callbacks', () => {
  it('can call a callback function on the main thread', async () => {
    const worker = await createThreadPool<WorkerWithCallback>('./__tests__/workers/callback')

    const callback = jest.fn()
    await worker.withCallback(1, 2, callback)
    worker.pool.terminate()

    await new Promise<void>((resolve) => setTimeout(() => resolve(), 1000))

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(3)
  })

  it('can call a callback function from all threads', async () => {
    const worker = await createThreadPool<WorkerWithCallback>('./__tests__/workers/callback', {
      size: 2
    })

    const callback = jest.fn()
    await worker.all.withCallback(1, 2, callback)
    worker.pool.terminate()

    await new Promise<void>((resolve) => setTimeout(() => resolve(), 1000))

    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenCalledWith(3)
  })

  it('calls the correct function on main if multiple are given', async () => {
    const worker = await createThreadPool<WorkerWithCallback>('./__tests__/workers/callback')

    const callback1 = jest.fn()
    const callback2 = jest.fn()
    worker.withDelayedCallback(1, 2, 100, callback1)
    worker.withDelayedCallback(2, 2, 10, callback2)
    
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 1000))
    worker.pool.terminate()
    
    expect(callback1).toHaveBeenCalledTimes(1)
    expect(callback1).toHaveBeenCalledWith(3)
    expect(callback2).toHaveBeenCalledTimes(1)
    expect(callback2).toHaveBeenCalledWith(4)
  })

  it('handles an exposed event emitter', async () => {
    const worker = await createThreadPool<WorkerWithEmitter>('./__tests__/workers/eventemitter')

    const callback = jest.fn()
    await worker.on('some:event', callback)
    await worker.triggerSomething(10, 20)
    
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 1000))
    worker.pool.terminate()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(30)
  })

  it.todo('transfers result of the callback back to the thread')
})

describe('Single Method Modules', () => {
  let worker: any

  beforeEach(async () => {
    worker = await createThreadPool(basicWorkerPath, {
      size: 2
    })
  })

  afterEach(() => {
    worker.pool.terminate()
  })

  it.todo('can call an exported method')
  it.todo('can call a default exported method (es6 modules)')
})

describe('Alias', () => {
  let worker: any

  beforeEach(async () => {
    worker = await createThreadPool(basicWorkerPath, {
      size: 2
    })
  })

  afterEach(() => {
    worker.pool.terminate()
  })

  it('has a createThreadPool method to create a worker thread pool', async () => {
    const value = await worker.fn('value')

    expect(value).toEqual('got value')
  })
})
