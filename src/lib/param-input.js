/**
 * Input behaviour for numeric parameters, kept out of the templates because
 * it is stateful: debounced typing, arrow key stepping, and scrubbing a value
 * by dragging its label left or right, the way CAD and design tools do it.
 */
import model from '../stores/model-store.js'

const timers = new Map()

/** "Wall thickness (mm)" → { label: "Wall thickness", unit: "mm" } */
export const splitCaption = (def) => {
  const caption = def.caption || def.name
  const m = caption.match(/^(.*?)\s*\(([^)]{1,6})\)\s*$/)
  return m ? { label: m[1], unit: m[2] } : { label: caption, unit: '' }
}

export const bounds = (def, value) => {
  const min = def.min ?? 0
  const max = def.max ?? Math.max(100, Number(value) * 2 || 100)
  const step = def.step ?? (def.type === 'int' ? 1 : 0.1)
  return { min, max, step }
}

const decimals = (step) => {
  const s = String(step)
  return s.includes('.') ? s.split('.')[1].length : 0
}

export const format = (def, value) => {
  const { step } = bounds(def, value)
  const n = Number(value ?? 0)
  return n.toFixed(Math.min(3, decimals(step)))
}

const clamp = (def, n) => {
  const { min, max, step } = bounds(def, n)
  const q = Math.round(n / step) * step
  const v = Math.min(max, Math.max(min, q))
  return Number(v.toFixed(Math.min(6, decimals(step) + 1)))
}

export const setNow = (def, raw) => {
  const n = Number(String(raw).replace(',', '.'))
  if (!Number.isFinite(n)) return false
  clearTimeout(timers.get(def.name))
  model.setParam(def.name, def.type === 'int' ? Math.round(clamp(def, n)) : clamp(def, n))
  return true
}

/** Typing rebuilds after a short pause instead of on every keystroke. */
export const setSoon = (def, raw) => {
  clearTimeout(timers.get(def.name))
  timers.set(def.name, setTimeout(() => setNow(def, raw), 380))
}

/** ArrowUp / ArrowDown step, Shift ×10, Alt ×0.1; Enter applies at once. */
export const onKeydown = (event, def, value) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    setNow(def, event.target.value)
    event.target.blur()
    return
  }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  const { step } = bounds(def, value)
  const factor = event.shiftKey ? 10 : event.altKey ? 0.1 : 1
  const current = Number(String(event.target.value).replace(',', '.')) || Number(value) || 0
  const next = clamp(def, current + (event.key === 'ArrowUp' ? 1 : -1) * step * factor)
  event.target.value = format(def, next)
  setNow(def, next)
}

/**
 * Drag the label sideways to scrub the value. One step per 3 px, Shift for
 * coarse, Alt for fine. Rebuilds are throttled to one per animation frame.
 */
export const startScrub = (event, def, value) => {
  if (event.button !== 0) return
  event.preventDefault()
  const { step } = bounds(def, value)
  const startX = event.clientX
  const start = Number(value) || 0
  let frame = 0
  let pending = null
  document.body.classList.add('scrubbing')

  const move = (e) => {
    const factor = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    pending = clamp(def, start + Math.round((e.clientX - startX) / 3) * step * factor)
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0
        if (pending != null) model.setParam(def.name, pending)
      })
    }
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.classList.remove('scrubbing')
    if (pending != null) model.setParam(def.name, pending)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
