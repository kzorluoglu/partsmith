/** Promise based client for the JSCAD worker. */
import JscadWorker from './jscad.worker.js?worker'

let worker = null
let seq = 0
const pending = new Map()

const ensureWorker = () => {
  if (worker) return worker
  worker = new JscadWorker()
  worker.onmessage = (event) => {
    const { id, ok, result, error } = event.data
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    if (ok) entry.resolve(result)
    else {
      const err = new Error(error.message)
      err.stack = error.stack
      entry.reject(err)
    }
  }
  worker.onerror = (event) => {
    for (const [, entry] of pending) entry.reject(new Error(event.message || 'worker crashed'))
    pending.clear()
  }
  return worker
}

const send = (type, payload) => new Promise((resolve, reject) => {
  const id = ++seq
  pending.set(id, { resolve, reject })
  ensureWorker().postMessage({ id, type, payload })
})

/**
 * Parameter values arrive as a Gea proxy, which structured clone refuses to
 * send to a worker. Values are always plain scalars, so a JSON round trip is
 * both sufficient and cheap.
 */
const plain = (value) => {
  try {
    return JSON.parse(JSON.stringify(value ?? {}))
  } catch {
    return {}
  }
}

/**
 * A script stuck in an endless loop would block the worker forever, so every
 * run gets a hard deadline and a fresh worker if it blows past it.
 */
export const runScript = (code, params, { timeout = 20000, autoPlace = true, features = [] } = {}) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker?.terminate()
      worker = null
      pending.clear()
      reject(new Error(`the script did not finish within ${timeout / 1000}s and was aborted`))
    }, timeout)

    send('run', { code: String(code), params: plain(params), autoPlace, features: plain(features) })
      .then(resolve, reject)
      .finally(() => clearTimeout(timer))
  })

export const exportModel = (format, separate = false) => send('export', { format, separate })
