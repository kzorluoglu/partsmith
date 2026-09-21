/**
 * Tiny event bus for payloads that must not go into a reactive store.
 * Mesh buffers are megabytes of Float32Array, proxying them would be wasteful
 * and pointless, so the viewer gets them through here instead.
 */
const listeners = new Map()

export const on = (event, handler) => {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event).add(handler)
  return () => listeners.get(event)?.delete(handler)
}

export const emit = (event, payload) => {
  for (const handler of listeners.get(event) || []) handler(payload)
}
