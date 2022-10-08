import { FilterAndWrap } from "../.."
import { createThreadPool } from '../../'
import NestedWorker from './nested'

let nestedWorker: FilterAndWrap<typeof NestedWorker> | null = null

export default {
  setup: async () => {
    const worker = await createThreadPool<typeof NestedWorker>('./nested')
    nestedWorker = worker
  },
  callNested: (val) => nestedWorker?.getNestedValue(val)
}
