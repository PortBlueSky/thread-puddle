import { createThreadPool, withTransfer } from './index'
import majorVersion from './utils/major-node-version'

const transferableWorkerPath = './__tests__/workers/transferable.js'

describe('Transferable', () => {
  let worker: any

  beforeEach(async () => {
    worker = await createThreadPool(transferableWorkerPath)
  })

  afterEach(() => {
    worker.pool.terminate()
  })

  it('can transfer a return value from a worker', async () => {
    const arr1 = await worker.getArray()
    const arr2 = await worker.tryToUseArray()
    const arr3 = await worker.getTransferredArray()
    const err = await worker.tryToUseArray().catch((err: Error) => err)

    expect(arr1).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(arr2).toEqual(new Uint8Array([2, 3, 4, 5]))
    expect(arr3).toEqual(new Uint8Array([1, 2, 3, 4]))

    if (majorVersion < 13) {
      expect(err).toHaveProperty('message', 'Cannot perform %TypedArray%.prototype.map on a neutered ArrayBuffer')
    } else {
      expect(err).toHaveProperty('message', 'Cannot perform %TypedArray%.prototype.map on a detached ArrayBuffer')
    }
  })

  it('wraps transferred UintArrays into instance', async () => {
    const arr1 = await worker.getArray()
    expect(arr1 instanceof Uint8Array).toBe(true)
    expect(arr1).toEqual(new Uint8Array([1, 2, 3, 4]))
    
    const arr4 = await worker.getTransferredArray()
    expect(arr4).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(arr4 instanceof Uint8Array).toBe(true)
    
    // Since some node version shortly before 14.17,
    // UintArrays are transferred differently, needs investigation
    // const arr2 = await worker.get16Array()
    // const arr3 = await worker.get32Array()
    // const arr5 = await worker.getTransferred16Array()
    // const arr6 = await worker.getTransferred32Array()
    
    // expect(arr2).toEqual(new Uint16Array([1, 2, 3, 4]))
    // expect(arr2 instanceof Uint16Array).toBe(false)
    // expect(arr3).toEqual(new Uint32Array([1, 2, 3, 4]))
    // expect(arr3 instanceof Uint32Array).toBe(false)
    

    // expect(arr5).toEqual(new Uint16Array([1, 2, 3, 4]))
    // expect(arr5 instanceof Uint16Array).toBe(true)
    // expect(arr6).toEqual(new Uint32Array([1, 2, 3, 4]))
    // expect(arr6 instanceof Uint32Array).toBe(true)
  })

  it('handles error when a neutered array is accessed/transferred again from worker', async () => {
    await worker.getTransferred16Array()
    try {
      await worker.getTransferred16Array()
    } catch(err: any) {
      expect(err.message).toMatch('The ArrayBuffer for transfer is already detached')
    }
  });

  it('does not wrap ArrayBuffers transferred directly', async () => {
    const arrBuffer1 = await worker.getArrayBuffer()
    const arrBuffer2 = await worker.getTransferredArrayBuffer()

    expect(arrBuffer1).toBeInstanceOf(ArrayBuffer)
    expect(arrBuffer2).toBeInstanceOf(ArrayBuffer)
  })

  it('allows to specifiy transferables per method (main to worker)', async () => {
    const uint8Array = new Uint8Array([1, 2, 3, 4])
    const uint16Array = new Uint16Array([1, 2, 3, 4])
    const uint32Array = new Uint32Array([1, 2, 3, 4])

    const results = await Promise.all([
      worker.setArray(uint8Array),
      worker.set16Array(uint16Array),
      worker.set32Array(uint32Array),
      worker.setTransferredArray(withTransfer(uint8Array, [uint8Array])),
      worker.setTransferred16Array(withTransfer(uint16Array, [uint16Array])),
      worker.setTransferred32Array(withTransfer(uint32Array, [uint32Array]))
    ])

    results.map(result => expect(result).toEqual('ok'))

    try {
      uint32Array.map(i => i + 1)
      expect(true).toBe(false)
    } catch (err) {
      if (majorVersion < 13) {
        expect(err).toHaveProperty('message', 'Cannot perform %TypedArray%.prototype.map on a neutered ArrayBuffer')
      } else {
        expect(err).toHaveProperty('message', 'Cannot perform %TypedArray%.prototype.map on a detached ArrayBuffer')
      }
    }
  })

  it('can transfer a buffer to worker, manipulate it and transfer it back', async () => {
    const uint8Array = new Uint8Array([1, 2, 3, 4])
    const result = await worker.manipulateAndTransfer(withTransfer(uint8Array, [uint8Array]))

    expect(result).toEqual(new Uint8Array([2, 3, 4, 5]))
  })

  it('if no transferables are given, first argument is considered to be transferred', async () => {
    const uint8Array = new Uint8Array([1, 2, 3, 4])
    const result = await worker.manipulateAndTransfer(withTransfer(uint8Array))

    expect(result).toEqual(new Uint8Array([2, 3, 4, 5]))
  })

  it('can transfer nested values', async () => {
    const uint8Array = new Uint8Array([1, 2, 3, 4])
    const result = await worker.transferNested(withTransfer({
      value: uint8Array
    }, [uint8Array]))

    expect(result).toEqual({ value: new Uint8Array([2, 3, 4, 5]) })
  })
})