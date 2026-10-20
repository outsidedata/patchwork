// terrain3d's mod for box3dvehicle: the mod hands on terrain3d's browser half's `ground` as the page
// has it.
import { expect, test } from 'vitest'
import type { Plugins } from '#engine/browser.ts'
import { land } from './terrain3d.box3dvehicle.ts'

test('the land is terrain3d\'s ground as the page has it, and undefined until its field has loaded', () => {
  const ground = { height: (x: number, z: number) => x + z }
  expect(land({ terrain3d: { ground } } as unknown as Plugins)).toBe(ground)
  expect(land({ terrain3d: { ground: undefined } } as unknown as Plugins)).toBeUndefined()
})
