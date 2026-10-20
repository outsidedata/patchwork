// terrain3d's mod for box3d, given to box3d by one key of a scene: `world.box3d.mods.ground` is
// 'terrain3d'. The test writes a manager and one child, `hills`, which `load` boots as a game's
// would. The child's `box3d` row lists the four chunks round the origin, 64 m each, so box3d asks
// the mod for them on its first step; crates dropped on the hills land on terrain3d's height. Its
// `probe` hands the test the child's `w`.
import { afterAll, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boot, type Scene, type Truth } from '#engine/engine.ts'
import { load, mod } from '#addons/scenemanager/scenemanager.addon.ts'
import { scenemanager } from '#plugins/scenemanager/scenemanager.sim.ts'
import { written } from '#plugins/loader/loader.sim.ts'
import { castRayClosest } from '#plugins/box3d/box3d.sim.ts'
import { ground } from './terrain3d.box3d.ts'
import { heightAt, landOf, type Field } from './terrain3d.sim.ts'

const DT = 1 / 60
const field: Field = {
  program: {
    world: 600, hscale: 3, sea: 0.5, flood: false, out: 'hills',
    nodes: [{ id: 'hills', op: 'noise', kind: 'simplex', freq: 12, seed: 3 }],
  },
  analysis: { slopeStep: 1.5, curveStep: 4, positionRadius: 18, occlusionRadius: 30, occlusionSteps: 5, cliffProbe: 12, cliffSlope: 0.5, cliffDrop: 7, flatAngle: 0.03, records: 50000 },
  bands: [{ colour: '#3e5722', amount: 1, rules: [] }],
  grain: { base: 0.84, range: 0.32 },
  detail: [],
  surfaces: {},
  layers: [],
}
const url = '/terrain3d-box3d-test/hills.json'
written(url, JSON.stringify(field))

const top: Scene = {
  prefabs: { engine: { dt: DT }, scenemanager: { scenes: { hills: { file: 'hills.scene.json', suspend: false } }, dt: DT, entry: 'hills', port: 0 } },
  actors: [{ is: 'scenemanager' }],
  plugins: ['scenemanager'],
  seats: 1,
}
const drops = [[12.3, -20.7], [-20.5, 18.1], [25.2, 5.5]]
const at = (pos: number[]) => ({ pos, rot: [0, 0, 0, 1], vel: [0, 0, 0], spin: [0, 0, 0], awake: true })
const hills = {
  world: {
    loader: { assets: { land: { type: 'json', url, preload: true } } },
    terrain3d: { field: 'land' },
    box3d: {
      gravity: [0, -10, 0], subStepCount: 4, static: [],
      kinds: { crate: { type: 'dynamic', shapes: [{ box: [0.5, 0.5, 0.5] }] } },
      mods: { ground: 'terrain3d' },
      chunk: { count: 33, cell: 2 },
    },
  },
  prefabs: { engine: { dt: DT, width: 320, height: 200 }, scenemanager: { out: {} }, loader: {}, box3d: { ground: [[-1, -1], [-1, 0], [0, -1], [0, 0]] }, crate: at([0, 0, 0]), probe: {} },
  actors: [
    { is: 'scenemanager' }, { is: 'loader' }, { is: 'box3d' },
    ...drops.map(([x, z]) => ({ is: 'crate', pos: [x, landOf(field).height(x, z) + 2, z] })), { is: 'probe' },
  ],
  plugins: ['scenemanager'],
}

const dir = mkdtempSync(join(tmpdir(), 'terrain3d-box3d-'))
const path = (p: string) => JSON.stringify(new URL(p, import.meta.url).pathname)
writeFileSync(join(dir, 'hills.scene.json'), JSON.stringify(hills))
writeFileSync(join(dir, 'hills.sim.ts'), `
import { scenemanager } from ${path('../scenemanager/scenemanager.sim.ts')}
import { loader } from ${path('../loader/loader.sim.ts')}
import { box3d } from ${path('../box3d/box3d.sim.ts')}
import file from './hills.scene.json' with { type: 'json' }
export const sim = {
  scenemanager, loader, box3d, crate: {},
  probe: { after(_me, _dt, w) { globalThis.hills = w } },
}
export const scene = file
`)
afterAll(() => rmSync(dir, { recursive: true }))

const run = (t: Truth, k: number) => { for (let i = 0; i < k; i++) t.step(DT) }

test('the scene\'s one key gives box3d terrain3d\'s ground, loaded before the first step', async () => {
  const child = (await load(boot(structuredClone(top), { scenemanager }), pathToFileURL(dir + '/').href)).get('hills')!
  expect(mod(child.world, 'box3d', 'ground')).toBe(ground)
})

test('crates dropped on the hills rest on terrain3d\'s height, and a ray down meets the ground there', async () => {
  const child = (await load(boot(structuredClone(top), { scenemanager }), pathToFileURL(dir + '/').href)).get('hills')!
  run(child, 300)
  const w = (globalThis as any).hills
  for (const c of child.rows.filter(r => r.kind === 'crate')) {
    const [x, y, z] = c.data.pos
    expect(c.data.awake).toBe(false)
    expect(y - heightAt(w, x, z)).toBeGreaterThan(0.45)
    expect(y - heightAt(w, x, z)).toBeLessThan(0.6)
  }
  for (const [x, z] of [[0, 0], [-30, -30], [30, 30], [10, -16]]) {
    const hit = castRayClosest(w, [x, 200, z], [0, -400, 0])!
    expect(hit.id).toBe(0)
    expect(hit.point[1]).toBeCloseTo(heightAt(w, x, z), 3)
  }
})

test('chunk [i, j]\'s heights are terrain3d\'s heightAt at its samples, and neighbours share their edge', async () => {
  const child = (await load(boot(structuredClone(top), { scenemanager }), pathToFileURL(dir + '/').href)).get('hills')!
  run(child, 1)
  const w = (globalThis as any).hills
  const heights = (i: number, j: number) => (ground(w, [i, j]).shapes[0] as { heightField: { heights: number[] } }).heightField.heights
  const n = 33, cell = 2, span = (n - 1) * cell
  for (const [i, j] of [[0, 0], [-1, 2], [3, -4]]) {
    const h = heights(i, j)
    for (const [a, b] of [[0, 0], [5, 17], [32, 32], [32, 0]]) expect(h[b * n + a]).toBe(heightAt(w, i * span + a * cell, j * span + b * cell))
    const east = heights(i + 1, j), south = heights(i, j + 1)
    for (let k = 0; k < n; k++) {
      expect(h[k * n + n - 1]).toBe(east[k * n])
      expect(h[(n - 1) * n + k]).toBe(south[k])
    }
  }
})
