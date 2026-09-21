/**
 * Direct browser client for the OpenRouter chat API.
 *
 * There is no backend in this app, so the key lives in localStorage and every
 * request goes straight from the page to openrouter.ai, which allows CORS.
 */

const BASE = 'https://openrouter.ai/api/v1'
const KEY_STORAGE = 'partsmith.openrouter.key'

export const getApiKey = () => {
  try {
    return localStorage.getItem(KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

export const setApiKey = (key) => {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key)
    else localStorage.removeItem(KEY_STORAGE)
  } catch {
    /* private mode, the key simply does not persist */
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
  if (response.status === 402) return 'OpenRouter reports no credit left (402).'
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
    body: JSON.stringify({ model, messages, temperature, stream: true })
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
