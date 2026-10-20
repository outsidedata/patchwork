// terrain3d's mod for hitscan3d, given to hitscan3d by one key of a scene: `world.hitscan3d.mods.ground`
// is 'terrain3d'. The test writes a manager and one child, `hills`, which `load` boots as a game's
// would. Lines down, across and grazing the hills meet the ground where terrain3d's `ray` does, with
// the land's normal there as its `slope` reads it; a line that stays over the ground meets nothing,
// and one starting under it meets it at once. Its `probe` hands the test the child's `w`.
import { afterAll, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boot, type Scene, type W } from '#engine/engine.ts'
import { load, mod } from '#addons/scenemanager/scenemanager.addon.ts'
import { scenemanager } from '#plugins/scenemanager/scenemanager.sim.ts'
import { written } from '#plugins/loader/loader.sim.ts'
import { shoot } from '#plugins/hitscan3d/hitscan3d.sim.ts'
import { ground } from './terrain3d.hitscan3d.ts'
import { analyse, heightAt, normalAt, ray, type Field } from './terrain3d.sim.ts'

const DT = 1 / 60
const field: Field = {
  program: {
    world: 600, hscale: 30, sea: 0.5, flood: false, out: 'hills',
    nodes: [{ id: 'hills', op: 'noise', kind: 'simplex', freq: 12, seed: 3 }],
  },
  analysis: { slopeStep: 1.5, curveStep: 4, positionRadius: 18, occlusionRadius: 30, occlusionSteps: 5, cliffProbe: 12, cliffSlope: 0.5, cliffDrop: 7, flatAngle: 0.03, records: 50000 },
  bands: [{ colour: '#3e5722', amount: 1, rules: [] }],
  grain: { base: 0.84, range: 0.32 },
  detail: [],
  surfaces: {},
  layers: [],
}
const url = '/terrain3d-hitscan3d-test/hills.json'
written(url, JSON.stringify(field))

const top: Scene = {
  prefabs: { engine: { dt: DT }, scenemanager: { scenes: { hills: { file: 'hills.scene.json', suspend: false } }, dt: DT, entry: 'hills', port: 0 } },
  actors: [{ is: 'scenemanager' }],
  plugins: ['scenemanager'],
  seats: 1,
}
const hills = {
  world: {
    loader: { assets: { land: { type: 'json', url, preload: true } } },
    terrain3d: { field: 'land' },
    hitscan3d: { mods: { ground: 'terrain3d' }, kinds: {}, rewind: 1 },
  },
  prefabs: { engine: { dt: DT }, scenemanager: { out: {} }, loader: {}, probe: {} },
  actors: [{ is: 'scenemanager' }, { is: 'loader' }, { is: 'probe' }],
  plugins: ['scenemanager'],
}

const dir = mkdtempSync(join(tmpdir(), 'terrain3d-hitscan3d-'))
const path = (p: string) => JSON.stringify(new URL(p, import.meta.url).pathname)
writeFileSync(join(dir, 'hills.scene.json'), JSON.stringify(hills))
writeFileSync(join(dir, 'hills.sim.ts'), `
import { scenemanager } from ${path('../scenemanager/scenemanager.sim.ts')}
import { loader } from ${path('../loader/loader.sim.ts')}
import file from './hills.scene.json' with { type: 'json' }
export const sim = { scenemanager, loader, probe: { before(_me, _dt, w) { globalThis.terrain3dHitscan3d = w } } }
export const scene = file
`)
afterAll(() => rmSync(dir, { recursive: true }))

async function booted() {
  const child = (await load(boot(structuredClone(top), { scenemanager }), pathToFileURL(dir + '/').href)).get('hills')!
  child.step(DT)
  return { child, w: (globalThis as { terrain3dHitscan3d?: W }).terrain3dHitscan3d! }
}
const unit = (v: number[]) => v.map(c => c / Math.hypot(v[0], v[1], v[2]))

test('the scene\'s one key gives hitscan3d terrain3d\'s ground, loaded before the first step', async () => {
  const { child } = await booted()
  expect(mod(child.world, 'hitscan3d', 'ground')).toBe(ground)
})

test('a line meets the ground where terrain3d\'s ray does, t metres along it, with the land\'s normal there as its slope reads it', async () => {
  const { w } = await booted()
  const lines = [
    { from: [10, 80, -20], dir: [0, -1, 0] },
    { from: [-40, 60, 35], dir: unit([1, -0.4, 0.3]) },
    { from: [70, 50, 70], dir: unit([-0.8, -0.15, -0.5]) },
    { from: [0, heightAt(w, 0, 0) + 0.5, 0], dir: unit([1, -0.02, 0.2]) },
  ]
  for (const { from, dir } of lines) {
    const p = ray(w, from, dir, 400)!
    expect(p).toBeDefined()
    const got = ground(w, from, dir, 400)!
    expect(got.t).toBe(Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]))
    const at = from.map((c, i) => c + dir[i] * got.t)
    expect(at[1] - heightAt(w, at[0], at[2])).toBeLessThan(1e-4)
    expect(got.normal).toEqual(normalAt(w, p[0], p[2], field.analysis.slopeStep))
    expect(Math.hypot(got.normal[0], got.normal[1], got.normal[2])).toBeCloseTo(1, 12)
    expect(1 - got.normal[1]).toBe(analyse(w, p[0], p[2]).slope)
    // hitscan3d asks it through the scene's key, and its shot meets the ground there.
    const shot = shoot(w, from, dir, 400)!
    expect(shot.what).toBe('ground')
    expect(shot.t).toBe(got.t)
    expect(shot.normal).toEqual(got.normal)
  }
})

test('a line that stays over the ground for far metres meets nothing; one starting under it meets it at once', async () => {
  const { w } = await booted()
  expect(ground(w, [5, 90, 5], [0, 1, 0], 400)).toBeUndefined()
  const h = heightAt(w, 5, 5)
  expect(ground(w, [5, h + 20, 5], [0, -1, 0], 19)).toBeUndefined()
  expect(ground(w, [5, h + 20, 5], [0, -1, 0], 21)!.t).toBeCloseTo(20, 5)
  const under = ground(w, [5, h - 1, 5], [1, 0, 0], 50)!
  expect(under.t).toBe(0)
  expect(under.normal).toEqual(normalAt(w, 5, 5, field.analysis.slopeStep))
})
