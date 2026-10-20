// walker's mod for hitscan3d (`addons/scenemanager`'s mods). A scene with
// `world.hitscan3d.mods: { bodies: 'walker' }` has a shot meet walker's bodies: every row of a kind
// `world.walker.kinds` lists, at its `pos`, its feet, with its kind's `radius` and `height`.
import type { W } from '#engine/engine.ts'
import type { Numbers } from './walker.sim.ts'

export function bodies(w: W) {
  const kinds = w.world.walker.kinds as Record<string, Numbers>
  return Object.entries(kinds).flatMap(([kind, k]) =>
    w.all(kind).map(r => ({ id: r.id, kind, pos: r.data.pos as number[], radius: k.radius, height: k.height })))
}
