// terrain3d's mod for scatter3d, given to scatter3d's two halves by two keys of a scene:
// `world.scatter3d.mods.ground` and `world.scatter3d.mods.land` are 'terrain3d'. The test writes a
// manager and one child, `wood`, which `load` boots as a game's would: hills with a road painted
// across them, and a pack of trees kept below a treeline. The ground the mod hands the server half
// answers terrain3d's own queries over the truth's land, so the instances it places on the server are
// the ones a ground written from those queries places: none on the road or over the treeline, and gone
// from a place a stroke paints road over. The land it hands the browser half is terrain3d's browser
// half's `ground` as the page has it. Its `probe` hands the test the child's `w`.
import { afterAll, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boot, type Scene, type W } from '#engine/engine.ts'
import { load, mod } from '#addons/scenemanager/scenemanager.addon.ts'
import { scenemanager } from '#plugins/scenemanager/scenemanager.sim.ts'
import { written } from '#plugins/loader/loader.sim.ts'
import { place, placed, solids, type Ground, type Pack, type Scatter } from '#plugins/scatter3d/scatter3d.sim.ts'
import type { Plugins } from '#engine/browser.ts'
import { ground, land } from './terrain3d.scatter3d.ts'
import { edits, heightAt, paintAt, ramp, rules, type Field, type Rule, type Stroke } from './terrain3d.sim.ts'

const DT = 1 / 60
const road: Stroke = { verb: 'surface', radius: 12, hardness: 1, strength: 0, level: 0, surface: 'road', path: [[-80, -40], [80, -40]] }
const field: Field = {
  program: {
    world: 600, hscale: 60, sea: 0.5, flood: false, out: 'hills',
    nodes: [{ id: 'hills', op: 'noise', kind: 'simplex', freq: 4, seed: 21 }],
  },
  analysis: { slopeStep: 1.5, curveStep: 4, positionRadius: 18, occlusionRadius: 30, occlusionSteps: 5, cliffProbe: 12, cliffSlope: 0.5, cliffDrop: 7, flatAngle: 0.03, records: 50000 },
  bands: [{ colour: '#3e5722', amount: 1, rules: [] }],
  grain: { base: 1, range: 0 },
  detail: [],
  surfaces: { road: { colour: '#6d6459', cover: 0 } },
  layers: [{ at: [0, -40], size: 200, px: 100, strokes: [road] }, { at: [60, 60], size: 40, px: 40, strokes: [] }],
}
const url = '/terrain3d-scatter3d-test/wood.json'
written(url, JSON.stringify(field))

const TREELINE: Rule = { q: 'height', lo: 36, hi: 30 }
const trees: Pack = {
  asset: 'firs', rows: { fir: { weight: 1, solid: 0.3, tall: 6 } },
  cell: 5, reach: 60, seed: 91, lods: [20, 40], shadow: 30, leaf: 0.5, density: 1, rules: [TREELINE],
  clearing: 0, size: [0.8, 0.6], vary: 0.2,
}
const scatter: Scatter = {
  cutout: 0.45, coverage: 0.25, budget: 1e9, remember: 100000, packs: { trees }, mods: { ground: 'terrain3d', land: 'terrain3d' },
}

const top: Scene = {
  prefabs: { engine: { dt: DT }, scenemanager: { scenes: { wood: { file: 'wood.scene.json', suspend: false } }, dt: DT, entry: 'wood', port: 0 } },
  actors: [{ is: 'scenemanager' }],
  plugins: ['scenemanager'],
  seats: 1,
}
const wood = {
  world: {
    loader: { assets: { land: { type: 'json', url, preload: true } } },
    terrain3d: { field: 'land' },
    scatter3d: scatter,
  },
  prefabs: { engine: { dt: DT }, scenemanager: { out: {} }, loader: {}, probe: {} },
  actors: [{ is: 'scenemanager' }, { is: 'loader' }, { is: 'probe' }],
  plugins: ['scenemanager'],
}

const dir = mkdtempSync(join(tmpdir(), 'terrain3d-scatter3d-'))
const path = (p: string) => JSON.stringify(new URL(p, import.meta.url).pathname)
writeFileSync(join(dir, 'wood.scene.json'), JSON.stringify(wood))
writeFileSync(join(dir, 'wood.sim.ts'), `
import { scenemanager } from ${path('../scenemanager/scenemanager.sim.ts')}
import { loader } from ${path('../loader/loader.sim.ts')}
import file from './wood.scene.json' with { type: 'json' }
export const sim = { scenemanager, loader, probe: { before(_me, _dt, w) { globalThis.terrain3dScatter3d = w } } }
export const scene = file
`)
afterAll(() => rmSync(dir, { recursive: true }))

async function booted() {
  const child = (await load(boot(structuredClone(top), { scenemanager }), pathToFileURL(dir + '/').href)).get('wood')!
  child.step(DT)
  return { child, w: (globalThis as { terrain3dScatter3d?: W }).terrain3dScatter3d! }
}
// A ground written from terrain3d's server queries over `w`, as a game's actor once wrote it by hand.
const byHand = (w: W): Ground => ({
  height: (x, z) => heightAt(w, x, z), cover: (x, z) => paintAt(w, x, z).cover, ramp: (rule, x, z) => ramp(w, rule, x, z), rules, edits: () => edits(w),
})
const points = Array.from({ length: 41 * 41 }, (_, k) => [(k % 41) * 5 - 100, Math.floor(k / 41) * 5 - 100])
const sorted = <T extends { x: number; z: number }>(s: T[]) => [...s].sort((a, b) => a.x - b.x || a.z - b.z)

test('the scene\'s ground key gives scatter3d\'s server half terrain3d\'s ground, loaded before the first step, and placed makes it over the truth', async () => {
  const { child, w } = await booted()
  expect(mod(child.world, 'scatter3d', 'ground')).toBe(ground)
  const g = placed(w)
  expect(g.rules).toBe(rules)
  expect(g.edits()).toEqual(edits(w))
  expect(g.edits().land).toBe(edits(w).land)
})

test('the scene\'s land key gives scatter3d\'s browser half terrain3d\'s land, loaded before the first step', async () => {
  const { child } = await booted()
  expect(mod(child.world, 'scatter3d', 'land')).toBe(land)
})

test('the land is terrain3d\'s browser half\'s ground as the page has it, and undefined until its field has loaded', async () => {
  const { w } = await booted()
  const page = byHand(w)
  // Typed as scatter3d's browser half asks it: terrain3d's browser ground is a scatter3d Ground.
  const got: Ground | undefined = land({ terrain3d: { ground: page } } as unknown as Plugins)
  expect(got).toBe(page)
  expect(land({ terrain3d: { ground: undefined } } as unknown as Plugins)).toBeUndefined()
})

test('the ground answers terrain3d\'s heightAt, its paint\'s cover, a rule\'s ramp over its land record, and its rule check', async () => {
  const { w } = await booted()
  const g = ground(w)
  let onRoad = 0
  for (const [x, z] of points) {
    expect(g.height(x, z)).toBe(heightAt(w, x, z))
    expect(g.cover(x, z)).toBe(paintAt(w, x, z).cover)
    expect(g.ramp(TREELINE, x, z)).toBe(ramp(w, TREELINE, x, z))
    if (g.cover(x, z) === 0) onRoad++
  }
  expect(onRoad).toBeGreaterThan(20)
  expect(() => g.rules([{ q: 'steepness', lo: 0, hi: 1 }], 'scatter3d pack trees')).toThrow('scatter3d pack trees rule 0 reads steepness')
})

test('the instances placed on it are the ones a ground written from terrain3d\'s queries places: none on the road, none over the treeline', async () => {
  const { w } = await booted()
  const g = ground(w), hand = byHand(w)
  let kept = 0
  for (let j = -20; j <= 20; j++) for (let i = -20; i <= 20; i++) {
    const c = place(trees, i, j, g)
    expect(c).toEqual(place(trees, i, j, hand))
    if (!c) continue
    kept++
    expect(paintAt(w, c.x, c.z).cover).toBeGreaterThan(0)
    expect(heightAt(w, c.x, c.z)).toBeLessThan(TREELINE.lo)
  }
  expect(kept).toBeGreaterThan(100)
  // The square reaches over the treeline, so the rule refused somewhere.
  expect(points.filter(([x, z]) => heightAt(w, x, z) > TREELINE.lo).length).toBeGreaterThan(20)
  const got = solids(w, 0, 0, 90, placed(w))
  expect(got.length).toBeGreaterThan(50)
  expect(sorted(got)).toEqual(sorted(solids(w, 0, 0, 90, hand)))
})

test('a road stroked over the land takes the trees there away on the next question, and leaves the rest', async () => {
  const { w } = await booted()
  const there = () => solids(w, 60, 60, 12, placed(w))
  const far = () => solids(w, -60, 60, 20, placed(w))
  expect(there().length).toBeGreaterThan(0)
  const before = far()
  edits(w).land.stroke(1, { verb: 'surface', radius: 30, hardness: 1, strength: 0, level: 0, surface: 'road', path: [[60, 60]] })
  expect(there()).toEqual([])
  expect(far()).toEqual(before)
})
