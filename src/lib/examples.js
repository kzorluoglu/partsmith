/** Scripts to start from, also used as the few shot the viewer boots with. */

export const STARTER = `// Cable clip for a 6 mm cable, screws to a desk edge.
const { primitives, booleans, transforms, utils } = jscad

const getParameterDefinitions = () => [
  { name: 'cableDiameter', type: 'float', initial: 6, min: 2, max: 20, step: 0.5, caption: 'Cable diameter (mm)' },
  { name: 'wall', type: 'float', initial: 2.4, min: 1.2, max: 5, step: 0.2, caption: 'Wall thickness (mm)' },
  { name: 'width', type: 'float', initial: 12, min: 6, max: 30, step: 1, caption: 'Clip width (mm)' },
  { name: 'gap', type: 'float', initial: 0.7, min: 0.4, max: 1, step: 0.05, caption: 'Opening ratio' },
  { name: 'screwHole', type: 'checkbox', initial: true, caption: 'Screw hole' }
]

const main = ({ cableDiameter, wall, width, gap, screwHole }) => {
  const inner = cableDiameter / 2 + 0.3
  const outer = inner + wall

  const ring = booleans.subtract(
    primitives.cylinder({ radius: outer, height: width, segments: 64 }),
    primitives.cylinder({ radius: inner, height: width + 0.4, segments: 64 })
  )

  // Slot the cable pushes through, sized as a fraction of the bore.
  const mouth = transforms.translateY(outer,
    primitives.cuboid({ size: [cableDiameter * gap, outer * 2, width + 0.4] })
  )

  const tab = transforms.translate([0, -outer - 3, 0],
    primitives.roundedCuboid({ size: [outer * 2, 10, wall], roundRadius: 0.8, segments: 16 })
  )

  let body = booleans.union(booleans.subtract(ring, mouth), tab)

  if (screwHole) {
    body = booleans.subtract(body, transforms.translate([0, -outer - 4, 0],
      primitives.cylinder({ radius: 1.7, height: wall + 1, segments: 32 })
    ))
  }

  // Lay the bore horizontally so the tab prints flat on the bed.
  return transforms.rotateX(utils.degToRad(90), body)
}
`

export const PROMPT_IDEAS = [
  'A honeycomb pen holder, 80 mm tall, 70 mm across, 2 mm walls',
  'A wall bracket for a 25 mm broom handle with two countersunk screw holes',
  'A stackable parts tray, 100 x 60 x 25 mm, with a 15 degree front lip',
  'A phone stand for a 7.5 mm thick phone at a 60 degree angle',
  'A knurled thumb screw, M4 thread clearance, 20 mm head',
  'A hinged box lid, 60 mm cube, printed in place with 0.3 mm clearance'
]
