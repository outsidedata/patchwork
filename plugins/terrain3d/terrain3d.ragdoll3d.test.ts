// terrain3d's mod for ragdoll3d, given to ragdoll3d by one key of a scene: `world.ragdoll3d.mods.land`
// is 'terrain3d'. It hands on terrain3d's browser half's `ground` as the page has it.
import { expect, test } from 'vitest'
import type { Plugins } from '#engine/browser.ts'
import { land } from './terrain3d.ragdoll3d.ts'

test('the land is terrain3d\'s ground as the page has it, and undefined until its field has loaded', () => {
  const ground = { height: (x: number, z: number) => x + z }
  expect(land({ terrain3d: { ground } } as unknown as Plugins)).toBe(ground)
  expect(land({ terrain3d: { ground: undefined } } as unknown as Plugins)).toBeUndefined()
})
