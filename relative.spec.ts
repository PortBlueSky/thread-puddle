import { createThreadPool } from './src'

describe('Relative imports', () => {
  let worker: any

  beforeEach(async () => {
    worker = await createThreadPool<any>('./src/__tests__/workers/basic.js', {
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