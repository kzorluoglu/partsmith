/**
 * Direct browser client for the OpenRouter chat API.
 *
 * There is no backend in this app, so the key is encrypted locally and every
 * request goes straight from the page to openrouter.ai, which allows CORS.
 */

const BASE = 'https://openrouter.ai/api/v1'
const LEGACY_KEY_STORAGE = 'partsmith.openrouter.key'
const DB_NAME = 'partsmith.secrets'
const DB_VERSION = 1
const STORE_NAME = 'keys'
const CRYPTO_KEY = 'encryption-key'
const API_KEY = 'openrouter-api-key'
const MAX_TOKENS = 8192

const openDb = () => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) return reject(new Error('IndexedDB is unavailable'))
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error || new Error('Could not open secure browser storage'))
})

const dbGet = async (key) => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const dbPut = async (key, value) => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

const dbDelete = async (key) => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

const encode = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0))

const getCryptoKey = async () => {
  let key = await dbGet(CRYPTO_KEY)
  if (key) return key
  key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await dbPut(CRYPTO_KEY, key)
  return key
}

const encrypt = async (value) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getCryptoKey(), new TextEncoder().encode(value))
  return { iv: encode(iv), data: encode(data) }
}

const decrypt = async (record) => {
  if (!record?.iv || !record?.data) return ''
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(record.iv) }, await dbGet(CRYPTO_KEY), decode(record.data))
  return new TextDecoder().decode(data)
}

/** Loads the encrypted key and migrates the old plaintext localStorage value once. */
export const getApiKey = async () => {
  try {
    const stored = await dbGet(API_KEY)
    if (stored) return await decrypt(stored)
    const legacy = localStorage.getItem(LEGACY_KEY_STORAGE) || ''
    if (legacy) {
      await dbPut(API_KEY, await encrypt(legacy))
      localStorage.removeItem(LEGACY_KEY_STORAGE)
    }
    return legacy
  } catch {
    return ''
  }
}

export const setApiKey = async (key) => {
  try {
    if (key) await dbPut(API_KEY, await encrypt(key))
    else await dbDelete(API_KEY)
    localStorage.removeItem(LEGACY_KEY_STORAGE)
  } catch {
    /* private mode or an unsupported browser: keep the key in memory only */
  }
}

const headers = (key) => ({
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': location.origin,
  'X-Title': 'PartSmith'
})

const readError = async (response) => {
  let detail = ''
  try {
    const body = await response.json()
    detail = body?.error?.message || body?.message || ''
  } catch {
    detail = await response.text().catch(() => '')
  }
  if (response.status === 401) return 'OpenRouter rejected the key (401). Check it in settings.'
  if (response.status === 402) return `OpenRouter needs more credit for this request (402). ${detail}`.trim()
  if (response.status === 429) return 'Rate limited by OpenRouter (429). Wait a moment or pick another model.'
  return `OpenRouter request failed (${response.status}) ${detail}`.trim()
}

/** Fetches the model catalog. Works without a key, so it can populate the picker early. */
export const listModels = async () => {
  const response = await fetch(`${BASE}/models`)
  if (!response.ok) throw new Error(await readError(response))
  const body = await response.json()
  return (body.data || [])
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
      context: model.context_length || 0,
      promptPrice: Number(model.pricing?.prompt || 0),
      completionPrice: Number(model.pricing?.completion || 0),
      free: Number(model.pricing?.prompt || 0) === 0 && Number(model.pricing?.completion || 0) === 0
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Remaining credit for the configured key, or null when it cannot be read. */
export const fetchCredits = async (key) => {
  const response = await fetch(`${BASE}/credits`, { headers: headers(key) })
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  const data = body?.data
  if (!data) return null
  return { usage: data.total_usage ?? 0, limit: data.total_credits ?? null }
}

/**
 * Streams a completion. `onDelta` receives text chunks as they arrive and the
 * returned promise resolves with the full text.
 */
export const streamCompletion = async ({ key, model, messages, signal, onDelta, temperature = 0.2 }) => {
  if (!key) throw new Error('No OpenRouter API key set. Open settings and paste one.')

  const response = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: headers(key),
    signal,
    // Without max_tokens OpenRouter reserves credit for the model's full
    // output limit (64k tokens on Sonnet, roughly a dollar) and answers 402
    // on a small balance, although a script costs a few cents. 8k tokens is
    // several times the longest script the prompt allows.
    body: JSON.stringify({ model, messages, temperature, stream: true, max_tokens: MAX_TOKENS })
  })

  if (!response.ok) throw new Error(await readError(response))
  if (!response.body) throw new Error('OpenRouter returned an empty response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by a blank line.
    let cut
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut).trim()
      buffer = buffer.slice(cut + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const chunk = JSON.parse(data)
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          onDelta?.(delta, full)
        }
      } catch {
        /* keepalive comments and partial frames are expected */
      }
    }
  }
  return full
}
