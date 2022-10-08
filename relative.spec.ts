import { createThreadPool, WrapWorkerType } from './src'
import BasicWorker from './src/__tests__/workers/basic'

describe('Relative imports', () => {
  let worker: WrapWorkerType<typeof BasicWorker>

  beforeEach(async () => {
    worker = await createThreadPool<typeof BasicWorker>('./src/__tests__/workers/basic', {
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

  it('can import worker module from relative path', async () => {
    const value = await worker.fn('value')

    expect(value).toEqual('got value')
  })
})