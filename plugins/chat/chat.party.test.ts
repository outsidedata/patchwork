// chat's mod for party, given to party by one key of a scene: `world.party.mods.whisper` is 'chat'.
// The test writes a manager and one child, `town`, which `load` boots as a game's would, so the
// scenemanager loads the mod before the first step; and it hands chat's own page half the account
// and name a tap on a member's name gives it.
import { afterAll, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boot, type Scene } from '#engine/engine.ts'
import type { Plugins } from '#engine/browser.ts'
import { load, mod } from '#addons/scenemanager/scenemanager.addon.ts'
import { scenemanager } from '#plugins/scenemanager/scenemanager.sim.ts'
import { chat } from './chat.plugin.ts'
import { whisper } from './chat.party.ts'

const DT = 1 / 60
const top: Scene = {
  prefabs: { engine: { dt: DT }, scenemanager: { scenes: { town: { file: 'town.scene.json', suspend: false } }, dt: DT, entry: 'town', port: 0 } },
  actors: [{ is: 'scenemanager' }],
  plugins: ['scenemanager'],
  seats: 1,
}
const town = {
  world: { party: { mods: { whisper: 'chat' } } },
  prefabs: { engine: { dt: DT }, scenemanager: { out: {} } },
  actors: [{ is: 'scenemanager' }],
  plugins: ['scenemanager', 'party', 'chat', 'ui'],
}

const dir = mkdtempSync(join(tmpdir(), 'chat-party-'))
writeFileSync(join(dir, 'town.scene.json'), JSON.stringify(town))
writeFileSync(join(dir, 'town.sim.ts'), `
import { scenemanager } from ${JSON.stringify(new URL('../scenemanager/scenemanager.sim.ts', import.meta.url).pathname)}
import file from './town.scene.json' with { type: 'json' }
export const sim = { scenemanager }
export const scene = file
`)
afterAll(() => rmSync(dir, { recursive: true }))

test('the scene\'s one key gives party chat\'s whisper, loaded before the first step', async () => {
  const child = (await load(boot(structuredClone(top), { scenemanager }), pathToFileURL(dir + '/').href)).get('town')!
  expect(mod(child.world, 'party', 'whisper')).toBe(whisper)
})

test('a whisper opens chat\'s whisper channel to the member\'s account and name, and hands back nothing', () => {
  const page = chat()
  const opened = vi.spyOn(page, 'whisper')
  const plugins = { chat: page } as unknown as Plugins
  expect(whisper(plugins, 'c', 'Cy')).toBeUndefined()
  whisper(plugins, 'b', 'Bob')
  expect(opened.mock.calls).toEqual([['c', 'Cy'], ['b', 'Bob']])
})
