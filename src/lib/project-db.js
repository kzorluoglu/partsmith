/**
 * Saved models in IndexedDB. localStorage would fill up fast: every assistant
 * turn in a conversation carries a whole script, plus a thumbnail per model.
 *
 * A record is { id, name, code, features, params, messages, thumb,
 * createdAt, updatedAt }. Values must be plain data, callers pass copies of
 * their reactive state, structured clone refuses proxies.
 */
const DB_NAME = 'partsmith'
const STORE = 'projects'

let dbPromise = null

const open = () => {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('this browser has no IndexedDB, models cannot be saved'))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('could not open the model storage'))
  })
  // A failed open must not stick, the next call tries again.
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

const run = async (mode, work) => {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = work(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(request?.result)
    tx.onerror = () => reject(tx.error || new Error('model storage failed'))
    tx.onabort = () => reject(tx.error || new Error('model storage was aborted, the disk may be full'))
  })
}

/** Every saved model, newest first. */
export const listProjects = async () => {
  const all = await run('readonly', (store) => store.getAll())
  return (all || []).sort((a, b) => b.updatedAt - a.updatedAt)
}

export const getProject = (id) => run('readonly', (store) => store.get(id))

export const putProject = (record) => run('readwrite', (store) => store.put(record))

export const deleteProject = (id) => run('readwrite', (store) => store.delete(id))
