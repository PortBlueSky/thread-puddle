/* eslint-env jest */
import path from 'path'
import { createThreadPool } from './index'
import debug from 'debug'
import { WorkerWithCallback } from './__tests__/workers/callback'
import { isThreadFreeFunctionMessage, ThreadMessageAction } from './types/messages'

debug.enabled('puddle')

describe('Garbage Collections', () => {
  // Note: This might be flaky, as the garbage collection and the finalizer cannot be triggered reliably
  it('cleans up main thread function when garbage collected on thread', async () => {
    const worker = await createThreadPool<WorkerWithCallback>('./__tests__/workers/callback')
    // Need to create a lot of callbacks to trigger the garbage collection
    const callTimes = 50000
    const msgHandler = jest.fn()

    worker.pool.on('thread:message', (msg) => {
      if(isThreadFreeFunctionMessage(msg)) {
        msgHandler(msg)
      }
    })

    const callback = jest.fn()
    for (let i = 0; i < callTimes; i++) {
      if (i % 1000 === 0) {
        // Give garbage collection some time to kick in
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 100))
      }
      await worker.withCallback(1, 2, callback)
    }
    
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 3000))
    worker.pool.terminate()

    expect(callback.mock.calls.length).toBeGreaterThan(10000)
    expect(callback).toHaveBeenCalledWith(3)
    expect(msgHandler).toHaveBeenCalledWith({
      action: ThreadMessageAction.FREE_FUNCTION,
      functionId: expect.any(Number),
      key: expect.any(String)
    })
    const numberOfStoredMethods = worker.pool.callbacks.get('withCallback')?.size
    expect(numberOfStoredMethods).toBeLessThan(callTimes / 2)
  }, 20000)
})
