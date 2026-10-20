// hitscan3d's mod for volley3d (`addons/scenemanager`'s mods). A scene with
// `world.volley3d.mods: { shoot: 'hitscan3d', bodies: 'hitscan3d' }` has volley3d's rounds meet what
// hitscan3d's shots meet: the ground, the solids and the bodies that `world.hitscan3d` and its own
// mods name.
//
// `shoot(w, from, dir, far, { skip, bodies, grow })` is hitscan3d's `shoot` (`hitscan3d.sim.ts`) asked
// of the step as it is now: a round flies in the server's present, where a hitscan shot is aimed at
// what its page saw, so no step is rewound to. `bodies(w)` is every body a shot can hit now,
// `{ id, kind, pos, radius, height }` (`hittable`): of a kind `world.hitscan3d.kinds` lists, none lying
// `off`, each as tall as its row's `tall` field when it carries one.
import type { W } from '#engine/engine.ts'
import { hittable, shoot as line } from './hitscan3d.sim.ts'

export function shoot(w: W, from: number[], dir: number[], far: number, opts: { skip?: number[]; bodies?: boolean; grow?: number }) {
  return line(w, from, dir, far, { skip: opts.skip, bodies: opts.bodies, grow: opts.grow })
}

export function bodies(w: W) {
  return hittable(w)
}
