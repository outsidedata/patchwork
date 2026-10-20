// anim's mod for ragdoll3d, given to ragdoll3d by two keys of a scene: `world.ragdoll3d.mods.model`
// and `.pose` are 'anim'. They hand on anim's browser half's `model` and `pose` as the page has them.
import { expect, test } from 'vitest'
import type { Plugins } from '#engine/browser.ts'
import { model, pose } from './anim.ragdoll3d.ts'

test('the model is anim\'s model of the row, undefined before it is built, and the pose anim\'s pose of it in one clip at its time', () => {
  const root = { name: 'model' }, posed = { name: 'posed' }
  const asked: unknown[][] = []
  const plugins = {
    anim: {
      model: (id: number) => (id === 3 ? root : undefined),
      pose: (...args: unknown[]) => { asked.push(args); return posed },
    },
  } as unknown as Plugins
  expect(model(plugins, 3)).toBe(root)
  expect(model(plugins, 4)).toBeUndefined()
  expect(pose(plugins, 3, 'kneel', 0.3)).toBe(posed)
  expect(asked).toEqual([[3, 'kneel', 0.3]])
})
