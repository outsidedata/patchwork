// The Effects 3D panel's fields, with no game booted: one for every field of an emitter particle3d
// reads, in its order, in metres, an emitter with no dir of its own aimed straight up, and a spawn's
// to a vector of the world from the point it is fired at.
import { expect, test } from 'vitest'
import { specs } from '#plugins/particle2d/particle2d.extension.tsx'
import { FIELDS } from './particle3d.plugin.ts'
import { SPACE } from './particle3d.extension.tsx'

test('the panel has a field for every field of an emitter particle3d reads, in its order, in metres', () => {
  const fields = specs(SPACE)
  expect(fields.map(s => s.key)).toEqual([...FIELDS])
  expect(fields.find(s => s.key === 'g')!.label).toBe('g (m/s²)')
  const ctx = { sheets: [], clips: undefined, dir: SPACE.dir(SPACE.spawn) }
  expect(fields.find(s => s.key === 'dir')!.absent({}, ctx)).toEqual([0, 1, 0])
  expect(SPACE.to([1, 2, 3], SPACE.spawn)).toEqual([4, 2, 3])
})
