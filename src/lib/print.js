/** Printer profiles and the derived numbers shown next to the model. */

export const PRINTERS = [
  { id: 'bambu-a1', name: 'Bambu Lab A1 / P1S', volume: [256, 256, 256] },
  { id: 'prusa-mk4', name: 'Prusa MK4', volume: [250, 210, 220] },
  { id: 'ender-3', name: 'Creality Ender 3', volume: [220, 220, 250] },
  { id: 'mini', name: 'Prusa Mini', volume: [180, 180, 180] },
  { id: 'large', name: 'Large format 350', volume: [350, 350, 400] }
]

export const MATERIALS = [
  { id: 'pla', name: 'PLA', density: 1.24, pricePerKg: 20 },
  { id: 'petg', name: 'PETG', density: 1.27, pricePerKg: 22 },
  { id: 'abs', name: 'ABS', density: 1.04, pricePerKg: 21 },
  { id: 'tpu', name: 'TPU', density: 1.21, pricePerKg: 30 },
  { id: 'asa', name: 'ASA', density: 1.07, pricePerKg: 28 }
]

const FILAMENT_AREA_MM2 = Math.PI * (1.75 / 2) ** 2

/**
 * Rough material estimate. A solid model is never printed solid, so the infill
 * ratio scales the interior while the shell is treated as always present.
 */
export const estimateMaterial = (volumeMm3, { density, infill = 0.2, shell = 0.35 }) => {
  const effective = volumeMm3 * (shell + (1 - shell) * infill)
  const grams = (effective / 1000) * density
  const meters = effective / FILAMENT_AREA_MM2 / 1000
  return { grams, meters, effective }
}

export const fitsBuildVolume = (size, volume) =>
  size[0] <= volume[0] && size[1] <= volume[1] && size[2] <= volume[2]

/** Collects the warnings worth showing before someone wastes an hour of print time. */
export const printWarnings = (stats, printer) => {
  const warnings = []
  if (!stats) return warnings
  if (!stats.manifold) {
    warnings.push({
      level: 'error',
      text: 'Surface is not closed, so the solid has a hole in it. A slicer will either patch it badly or refuse the file.'
    })
  }
  if (stats.inverted) {
    warnings.push({
      level: 'warn',
      text: 'Normals point inward. Most slicers cope, but the model was probably built inside out.'
    })
  }
  if (!fitsBuildVolume(stats.size, printer.volume)) {
    warnings.push({
      level: 'error',
      text: `Model is larger than the ${printer.name} build volume (${printer.volume.join(' x ')} mm). Scale it down or split it.`
    })
  }
  if (stats.overhangArea > 50) {
    warnings.push({
      level: 'warn',
      text: `About ${Math.round(stats.overhangArea)} mm2 of steep overhang. Supports will likely be needed.`
    })
  }
  const thinnest = Math.min(...stats.size)
  if (thinnest > 0 && thinnest < 0.8) {
    warnings.push({ level: 'warn', text: `Smallest dimension is ${thinnest.toFixed(2)} mm, below two perimeter widths.` })
  }
  if (stats.triangles > 400000) {
    warnings.push({ level: 'warn', text: `${stats.triangles.toLocaleString()} triangles. Lower the segment counts to keep files small.` })
  }
  return warnings
}
