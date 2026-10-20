// scatter3d's mod for ragdoll3d, given to ragdoll3d by one key of a scene:
// `world.ragdoll3d.mods.solids` is 'scatter3d'. They are scatter3d's browser half's `solids` as the
// page has them.
import { expect, test } from 'vitest'
import type { Plugins } from '#engine/browser.ts'
import type { Solid } from './scatter3d.sim.ts'
import { solids } from './scatter3d.ragdoll3d.ts'

test('the solids are what scatter3d\'s browser half hands for the same circle, asked once', () => {
  const trunks: Solid[] = [{ x: 1, z: 2, radius: 0.3, tall: 6 }, { x: -4, z: 0.5, radius: 0.2 }]
  const asked: number[][] = []
  const plugins = { scatter3d: { solids: (x: number, z: number, r: number) => { asked.push([x, z, r]); return trunks } } } as unknown as Plugins
  expect(solids(plugins, 0.5, -1, 7)).toBe(trunks)
  expect(asked).toEqual([[0.5, -1, 7]])
})
