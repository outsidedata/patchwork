// terrain3d's mod for walker (`addons/scenemanager`'s mods). A scene with
// `world.walker.mods: { height: 'terrain3d', depth: 'terrain3d' }` stands walker's bodies on the land.
//
// `height(w, x, z)` is the ground a foot stands on, `rawAt`: under water too, so a body wades on the
// bed and walker's `depth` says how deep it is. `depth(w, x, z)` is `depthAt`, the water over it, 0 on
// a land with no flood.
import type { W } from '#engine/engine.ts'
import { depthAt, rawAt } from './terrain3d.sim.ts'

export const height = (w: W, x: number, z: number) => rawAt(w, x, z)
export const depth = (w: W, x: number, z: number) => depthAt(w, x, z)
