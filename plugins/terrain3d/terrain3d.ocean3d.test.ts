// terrain3d's mod for ocean3d, given to ocean3d by one key of a scene: `world.ocean3d.mods.land` is
// 'terrain3d'. The test writes a manager and one child, `shore`, which `load` boots as a game's
// would; the land it hands on is terrain3d's browser half's `ground` as the page has it.
import { afterAll, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boot, type Scene } from '#engine/engine.ts'
import type { Plugins } from '#engine/browser.ts'
import { load, mod } from '#addons/scenemanager/scenemanager.addon.ts'
import { scenemanager } from '#plugins/scenemanager/scenemanager.sim.ts'
import { land } from './terrain3d.ocean3d.ts'

const DT = 1 / 60
const top: Scene = {
  prefabs: { engine: { dt: DT }, scenemanager: { scenes: { shore: { file: 'shore.scene.json', suspend: false } }, dt: DT, entry: 'shore', port: 0 } },
  actors: [{ is: 'scenemanager' }],
  plugins: ['scenemanager'],
  seats: 1,
}
const dir = mkdtempSync(join(tmpdir(), 'terrain3d-ocean3d-'))
writeFileSync(join(dir, 'shore.scene.json'), JSON.stringify({ world: { ocean3d: { mods: { land: 'terrain3d' } } }, prefabs: {}, actors: [] }))
writeFileSync(join(dir, 'shore.sim.ts'), `
import file from './shore.scene.json' with { type: 'json' }
export const sim = {}
export const scene = file
`)
afterAll(() => rmSync(dir, { recursive: true }))

test('the scene\'s one key gives ocean3d this land, loaded before the first step', async () => {
  const child = (await load(boot(structuredClone(top), { scenemanager }), pathToFileURL(dir + '/').href)).get('shore')!
  expect(mod(child.world, 'ocean3d', 'land')).toBe(land)
})

test('the land is terrain3d\'s ground as the page has it, its depth and its edits, and undefined until its field has loaded', () => {
  const edits = () => ({ land: {}, layers: [{ version: 3, rect: [0, 0, 10, 10] }] })
  const ground = { depth: (x: number, z: number) => x - z, edits }
  const got = land({ terrain3d: { ground } } as unknown as Plugins)
  expect(got).toBe(ground)
  expect(got!.depth(5, 2)).toBe(3)
  expect(got!.edits()).toEqual(edits())
  expect(land({ terrain3d: { ground: undefined } } as unknown as Plugins)).toBeUndefined()
})
